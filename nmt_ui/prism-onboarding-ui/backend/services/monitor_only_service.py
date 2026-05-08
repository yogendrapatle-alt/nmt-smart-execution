"""
Monitor-Only Service
====================

Standalone Prometheus rule-watcher for a testbed — *no* smart workload
execution, no resource generation, no PID controller. Just polls a list of
``MonitoringRule``s on a fixed interval and persists violations as alerts.

Reuses the rule resolver from ``SmartExecutionController`` so behaviour and
shape of stored alerts stay 100% in sync with the smart-execution engine.

Lifecycle:
- ``start_monitor(testbed_id, name, monitoring_rules, options)`` → ``monitor_id``
- ``stop_monitor(monitor_id)``
- ``list_monitors(testbed_id=None, status=None)``
- ``get_monitor(monitor_id)``
- ``get_violations(monitor_id, limit=200)``

Each running monitor lives in a daemon thread and writes to ``monitor_sessions``
+ ``alert_summaries`` exactly the way an AI execution would.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

from database import SessionLocal
from models.monitor_session import MonitorSession
from models.testbed import Testbed
from services.smart_execution_service import SmartExecutionController

logger = logging.getLogger(__name__)

# In-memory registry of running monitors so we can stop / introspect them.
_RUNNING_MONITORS: Dict[str, "_MonitorRuntime"] = {}
_LOCK = threading.RLock()

DEFAULT_POLL_INTERVAL_S = 30
MIN_POLL_INTERVAL_S = 10
MAX_POLL_INTERVAL_S = 600

# Phase-2 timeseries capture
MAX_SAMPLES_PER_SERIES = 720          # ~6h at 30s polling; ~12h at 60s
RULE_HEALTH_KEEP_LAST = 200           # last-N value array per rule

# Cluster-aggregate PromQL probes captured on every poll. Kept tiny so they
# don't slow down the eval loop. None on Prometheus error → series skipped.
CLUSTER_PROBES = {
    'cluster_cpu':      'avg(100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100))',
    'cluster_max_cpu':  'max(100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100))',
    'cluster_mem':      'avg((node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100)',
    'cluster_max_mem':  'max((node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100)',
}


def _downsample(arr: list, keep: int) -> list:
    """Keep the array bounded by sub-sampling (keeps newest, decimates old)."""
    if len(arr) <= keep:
        return arr
    # Keep last ``keep//2`` raw + decimate the older portion
    head_keep = keep // 2
    head, tail = arr[:-head_keep], arr[-head_keep:]
    step = max(1, len(head) // (keep - head_keep))
    return head[::step] + tail


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _gen_monitor_id() -> str:
    return f"MON-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:8]}"


def _testbed_meta(testbed_id: str) -> Optional[Dict[str, Any]]:
    """Return ``{prometheus_url, label, slack_channel, pc_ip, …}`` for a testbed
    or ``None`` if not found / no Prometheus configured.
    """
    session = SessionLocal()
    try:
        tb = session.query(Testbed).filter(Testbed.unique_testbed_id == testbed_id).first()
        if not tb:
            return None
        raw = tb.testbed_json or {}
        if isinstance(raw, str):
            import json as _json
            try:
                raw = _json.loads(raw)
            except (ValueError, TypeError):
                raw = {}
        prom_url = raw.get('prometheus_url') or raw.get('prometheus_endpoint')
        return {
            'unique_testbed_id': testbed_id,
            'label': tb.testbed_label,
            'prometheus_url': prom_url,
            'pc_ip': raw.get('pc_ip'),
            'ncm_ip': raw.get('ncm_ip'),
            'raw': raw,
        }
    finally:
        session.close()


# ─────────────────────────────────────────────────────────────────────────────
# Runtime
# ─────────────────────────────────────────────────────────────────────────────

class _MonitorRuntime:
    """One running monitor — owns a thread + an async event loop.

    We construct a *minimal* SmartExecutionController stub and manually wire
    the bits the rule evaluator touches (``prometheus_url``, ``testbed_info``,
    ``monitoring_rules``, ``_rule_cooldowns``…) so we get the full Phase-2/3
    rule resolution + Slack + alert-persistence behaviour for free.
    """

    def __init__(self, monitor_id: str, testbed_meta: Dict[str, Any],
                 monitoring_rules: List[Dict[str, Any]], poll_interval_s: int,
                 duration_hours: Optional[float], session_name: str):
        self.monitor_id = monitor_id
        self.testbed_meta = testbed_meta
        self.monitoring_rules = monitoring_rules
        self.poll_interval_s = poll_interval_s
        self.duration_hours = duration_hours
        self.session_name = session_name

        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._started_at = _now_utc()

        # Phase-2: in-memory metric capture (flushed to DB every N polls)
        self._metric_samples: Dict[str, list] = {k: [] for k in CLUSTER_PROBES}
        self._rule_health: Dict[str, Dict[str, Any]] = {}
        self._last_violation_count = 0
        self._flush_every_polls = 5    # how often to write metric_samples to DB

        # Build a minimal SmartExecutionController-shaped object that the
        # rule evaluator can use unchanged. We don't actually run an
        # execution — we only call its rule-evaluation helpers.
        self._eval = self._build_evaluator()

    def _build_evaluator(self) -> SmartExecutionController:
        """Construct a SmartExecutionController without invoking its full
        ``__init__`` (which expects entities/thresholds/etc.). We poke just
        the fields the rule evaluator and Slack/alert-persistence touch.
        """
        ctrl = SmartExecutionController.__new__(SmartExecutionController)
        ctrl.execution_id = self.monitor_id  # alerts get tagged with this id
        ctrl.prometheus_url = self.testbed_meta['prometheus_url']
        ctrl.testbed_info = {
            'unique_testbed_id': self.testbed_meta['unique_testbed_id'],
            'label': self.testbed_meta.get('label'),
            'pc_ip': self.testbed_meta.get('pc_ip'),
            'ncm_ip': self.testbed_meta.get('ncm_ip'),
        }
        ctrl.monitoring_rules = self.monitoring_rules
        ctrl.monitoring_rule_violations = []
        ctrl._rule_cooldowns = {}
        # Fields the helpers reference but we don't really use here:
        ctrl.execution_logs = []
        ctrl.events = []
        ctrl.start_time = self._started_at
        return ctrl

    # ── Public ───────────────────────────────────────────────────────
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(
            target=self._run, name=f"monitor-only-{self.monitor_id}", daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def is_running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    # ── Internal ─────────────────────────────────────────────────────
    def _run(self) -> None:
        try:
            self._update_status('RUNNING')
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            self._loop.run_until_complete(self._poll_loop())
        except Exception as e:
            logger.exception(f"[{self.monitor_id}] crashed: {e}")
            self._update_status('FAILED', last_error=str(e), stopped=True)
        finally:
            try:
                if self._loop and not self._loop.is_closed():
                    self._loop.close()
            except Exception:
                pass
            with _LOCK:
                _RUNNING_MONITORS.pop(self.monitor_id, None)

    async def _poll_loop(self) -> None:
        deadline_ts = (
            time.time() + self.duration_hours * 3600
            if self.duration_hours and self.duration_hours > 0 else None
        )
        iteration = 0
        while not self._stop_event.is_set():
            iteration += 1
            try:
                await self._eval._evaluate_monitoring_rules(iteration)
            except Exception as e:
                logger.warning(f"[{self.monitor_id}] iter {iteration} eval error: {e}")
            # Phase-2: capture cluster aggregates + per-rule health each poll
            try:
                await self._capture_metric_samples(iteration)
            except Exception as e:
                logger.debug(f"[{self.monitor_id}] sample capture error: {e}")
            self._record_poll(iteration)

            if deadline_ts and time.time() >= deadline_ts:
                logger.info(f"[{self.monitor_id}] duration elapsed ({self.duration_hours}h) — stopping")
                break

            # Sleep in small slices so stop is responsive
            slept = 0
            while slept < self.poll_interval_s and not self._stop_event.is_set():
                await asyncio.sleep(min(2, self.poll_interval_s - slept))
                slept += 2

        # Final flush of metric samples on stop so the report has the last poll
        try:
            self._persist_metric_samples()
        except Exception as e:
            logger.debug(f"[{self.monitor_id}] final flush error: {e}")
        self._update_status('STOPPED', stopped=True)
        logger.info(f"[{self.monitor_id}] stopped (polls={iteration})")

    # ── Phase-2: per-poll cluster timeseries capture ─────────────────
    async def _capture_metric_samples(self, iteration: int) -> None:
        """Query the four cluster aggregates and append to in-memory series.
        Also updates per-rule health stats based on the latest evaluator state.
        """
        ts_iso = datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'
        for key, query in CLUSTER_PROBES.items():
            try:
                v = await self._eval._query_prometheus(query)
            except Exception:
                v = None
            if v is None:
                continue
            self._metric_samples[key].append([ts_iso, round(float(v), 4)])
            self._metric_samples[key] = _downsample(self._metric_samples[key], MAX_SAMPLES_PER_SERIES)

        # Per-rule health: walk the most recent slice of evaluator violations
        # captured during this iteration. We can't easily count "evaluations
        # without violation" for each rule from outside, so we treat poll-count
        # as the denominator and look at the violation list to detect fires.
        violations = list(self._eval.monitoring_rule_violations)
        new_violations = violations[self._last_violation_count:]
        self._last_violation_count = len(violations)
        for rule in self.monitoring_rules:
            rid = rule.get('id', 'unknown')
            health = self._rule_health.setdefault(rid, {
                'rule_id': rid, 'rule_name': rule.get('name'),
                'severity': rule.get('severity'), 'polls': 0,
                'fired': 0, 'last_value': None, 'last_violation_ts': None,
            })
            health['polls'] += 1
            for v in new_violations:
                if v.get('rule_id') == rid:
                    health['fired'] += 1
                    health['last_value'] = v.get('actual_value')
                    health['last_violation_ts'] = v.get('timestamp')

        # Phase-4: schedule log-collection bundles for any new violations whose
        # rule has collectLogs=True. We dedupe by (rule_id, iteration) so a
        # single composite-rule fire doesn't kick off N collections.
        rule_by_id = {r.get('id', ''): r for r in self.monitoring_rules}
        already_scheduled = set()
        for v in new_violations:
            rid = v.get('rule_id')
            if not rid or rid in already_scheduled:
                continue
            rule = rule_by_id.get(rid) or {}
            if not (rule.get('collectLogs') or rule.get('collect_logs')):
                continue
            already_scheduled.add(rid)
            try:
                from services import log_collection_service as lc_svc
                lc_svc.schedule_collection(
                    testbed_id=self.testbed_meta['unique_testbed_id'],
                    alert_id=None,  # we don't have the persisted alert id here
                    monitor_id=self.monitor_id,
                    execution_id=None,
                    rule=rule,
                    severity=v.get('severity'),
                )
                logger.info(f"📦 [{self.monitor_id}] log collection scheduled for rule '{rule.get('name')}'")
            except Exception as e:
                logger.warning(f"[{self.monitor_id}] failed to schedule log collection: {e}")

        # Flush to DB every N polls (cheap-but-not-free JSON write)
        if iteration % self._flush_every_polls == 0:
            self._persist_metric_samples()

    def _persist_metric_samples(self) -> None:
        """Write the current ``metric_samples`` snapshot to the DB row."""
        session = SessionLocal()
        try:
            row = session.query(MonitorSession).filter_by(monitor_id=self.monitor_id).first()
            if not row:
                return
            row.metric_samples = {
                **{k: v for k, v in self._metric_samples.items()},
                'rule_health': self._rule_health,
            }
            session.commit()
        except Exception as e:
            session.rollback()
            logger.debug(f"[{self.monitor_id}] persist samples failed: {e}")
        finally:
            session.close()

    def _record_poll(self, iteration: int) -> None:
        session = SessionLocal()
        try:
            row = session.query(MonitorSession).filter_by(monitor_id=self.monitor_id).first()
            if not row:
                return
            row.last_poll_at = _now_utc()
            row.total_polls = iteration
            # The eval pushes new violations onto self._eval.monitoring_rule_violations
            row.total_violations = len(self._eval.monitoring_rule_violations)
            session.commit()
        except Exception as e:
            session.rollback()
            logger.warning(f"[{self.monitor_id}] failed to update poll counters: {e}")
        finally:
            session.close()

    def _update_status(self, status: str, last_error: Optional[str] = None, stopped: bool = False) -> None:
        session = SessionLocal()
        try:
            row = session.query(MonitorSession).filter_by(monitor_id=self.monitor_id).first()
            if not row:
                return
            row.status = status
            if last_error is not None:
                row.last_error = last_error
            if stopped and not row.stopped_at:
                row.stopped_at = _now_utc()
            session.commit()
        except Exception as e:
            session.rollback()
            logger.warning(f"[{self.monitor_id}] failed to update status: {e}")
        finally:
            session.close()


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def start_monitor(*, testbed_id: str, monitoring_rules: List[Dict[str, Any]],
                  name: Optional[str] = None, description: Optional[str] = None,
                  poll_interval_s: int = DEFAULT_POLL_INTERVAL_S,
                  duration_hours: Optional[float] = None,
                  settings: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Start a new monitor-only session. Returns the persisted row's dict."""
    if not testbed_id:
        return {'success': False, 'error': 'testbed_id required'}
    if not monitoring_rules:
        return {'success': False, 'error': 'At least one monitoring rule is required'}

    poll_interval_s = max(MIN_POLL_INTERVAL_S, min(MAX_POLL_INTERVAL_S, int(poll_interval_s or DEFAULT_POLL_INTERVAL_S)))

    meta = _testbed_meta(testbed_id)
    if not meta:
        return {'success': False, 'error': f'Testbed {testbed_id} not found'}
    if not meta.get('prometheus_url'):
        return {'success': False, 'error': 'Selected testbed has no Prometheus URL configured'}

    # Best-effort connectivity probe — don't block start if Prometheus blips
    try:
        r = requests.get(f"{meta['prometheus_url']}/api/v1/status/buildinfo", timeout=5, verify=False)
        prom_ok = r.status_code == 200
    except Exception:
        prom_ok = False

    monitor_id = _gen_monitor_id()
    session = SessionLocal()
    try:
        row = MonitorSession(
            monitor_id=monitor_id,
            testbed_id=testbed_id,
            name=name or f"Monitor {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}",
            description=description,
            status='STARTING',
            poll_interval_s=poll_interval_s,
            duration_hours=duration_hours,
            rule_config={'monitoring_rules': monitoring_rules},
            settings=settings or {},
            total_polls=0,
            total_violations=0,
        )
        session.add(row)
        session.commit()
        result = row.to_dict()
    except Exception as e:
        session.rollback()
        logger.exception("Failed to persist monitor session")
        return {'success': False, 'error': f'DB error: {e}'}
    finally:
        session.close()

    runtime = _MonitorRuntime(
        monitor_id=monitor_id,
        testbed_meta=meta,
        monitoring_rules=monitoring_rules,
        poll_interval_s=poll_interval_s,
        duration_hours=duration_hours,
        session_name=name or '',
    )
    with _LOCK:
        _RUNNING_MONITORS[monitor_id] = runtime
    runtime.start()

    logger.info(f"🎯 Started monitor-only session {monitor_id} on testbed {testbed_id} "
                f"(rules={len(monitoring_rules)}, interval={poll_interval_s}s, "
                f"duration={duration_hours or 'unlimited'}h, prom_ok={prom_ok})")

    return {
        'success': True,
        'monitor': result,
        'prometheus_reachable': prom_ok,
    }


def reload_monitor_rules(monitor_id: str, monitoring_rules: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Hot-swap a running monitor's rule list. The next poll will use the new
    set; in-flight evaluations finish with the old set. Cooldowns reset for
    rules whose IDs change so newly-added rules can fire immediately.

    Returns ``{ok, replaced_count, dropped_cooldowns}``.
    """
    if not isinstance(monitoring_rules, list) or not monitoring_rules:
        return {'success': False, 'error': 'monitoring_rules must be a non-empty list'}
    with _LOCK:
        runtime = _RUNNING_MONITORS.get(monitor_id)
    if not runtime:
        return {'success': False, 'error': 'Monitor not running'}

    old_ids = {r.get('id') for r in runtime.monitoring_rules}
    new_ids = {r.get('id') for r in monitoring_rules}
    runtime.monitoring_rules = monitoring_rules
    runtime._eval.monitoring_rules = monitoring_rules
    # Reset cooldowns for rules that disappeared so new rules fire fresh
    dropped = 0
    for rid in list(runtime._eval._rule_cooldowns.keys()):
        if rid not in new_ids:
            runtime._eval._rule_cooldowns.pop(rid, None)
            dropped += 1
    # Persist the new rule_config so a reload of the page shows the new set
    session = SessionLocal()
    try:
        row = session.query(MonitorSession).filter_by(monitor_id=monitor_id).first()
        if row:
            row.rule_config = {'monitoring_rules': monitoring_rules}
            session.commit()
    except Exception as e:
        session.rollback()
        logger.warning(f"reload_monitor_rules: failed to persist new config: {e}")
    finally:
        session.close()
    return {
        'success': True,
        'replaced_count': len(new_ids - old_ids),
        'dropped_cooldowns': dropped,
        'total_rules': len(monitoring_rules),
    }


def stop_monitor(monitor_id: str) -> Dict[str, Any]:
    with _LOCK:
        runtime = _RUNNING_MONITORS.get(monitor_id)
    if runtime:
        runtime.stop()
        return {'success': True, 'monitor_id': monitor_id, 'message': 'Stop signal sent'}
    # If not in registry, just mark the row as stopped so the UI is consistent
    session = SessionLocal()
    try:
        row = session.query(MonitorSession).filter_by(monitor_id=monitor_id).first()
        if not row:
            return {'success': False, 'error': 'Monitor not found'}
        if row.status not in ('STOPPED', 'FAILED'):
            row.status = 'STOPPED'
            row.stopped_at = _now_utc()
            session.commit()
        return {'success': True, 'monitor_id': monitor_id, 'message': 'Marked as stopped'}
    finally:
        session.close()


def list_monitors(testbed_id: Optional[str] = None, status: Optional[str] = None,
                  limit: int = 100) -> List[Dict[str, Any]]:
    session = SessionLocal()
    try:
        q = session.query(MonitorSession)
        if testbed_id:
            q = q.filter(MonitorSession.testbed_id == testbed_id)
        if status:
            q = q.filter(MonitorSession.status == status)
        q = q.order_by(MonitorSession.started_at.desc()).limit(limit)
        return [r.to_dict() for r in q.all()]
    finally:
        session.close()


def get_monitor(monitor_id: str) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        row = session.query(MonitorSession).filter_by(monitor_id=monitor_id).first()
        if not row:
            return None
        d = row.to_dict()
        d['is_running'] = monitor_id in _RUNNING_MONITORS
        # Pull live in-memory violation count if running
        runtime = _RUNNING_MONITORS.get(monitor_id)
        if runtime:
            d['live_violations'] = len(runtime._eval.monitoring_rule_violations)
        return d
    finally:
        session.close()


def get_violations(monitor_id: str, limit: int = 200) -> List[Dict[str, Any]]:
    """Return persisted alert_summaries rows originating from this monitor.

    Smart-execution's rule violations land in ``alert_summaries`` with
    ``diagnostic_context.execution_id == monitor_id``; the in-memory runtime
    additionally exposes the raw violation list for live tailing.
    """
    out: List[Dict[str, Any]] = []
    runtime = _RUNNING_MONITORS.get(monitor_id)
    if runtime:
        # Live in-memory tail (most recent first)
        for v in reversed(runtime._eval.monitoring_rule_violations[-limit:]):
            out.append({
                'source': 'live',
                'rule_name': v.get('rule_name'),
                'severity': v.get('severity'),
                'value': v.get('actual_value'),
                'threshold': v.get('threshold'),
                'operator': v.get('operator'),
                'is_composite': v.get('is_composite', False),
                'logical_operator': v.get('logical_operator'),
                'conditions_evaluated': v.get('conditions_evaluated'),
                'iteration': v.get('iteration'),
                'timestamp': v.get('timestamp'),
            })
    if out:
        return out

    # Fall back to persisted rows
    import psycopg2
    import json as _json
    from urllib.parse import urlparse
    db_url = (__import__('os').environ.get('DATABASE_URL')
              or 'postgresql://alertuser:alertpass@127.0.0.1:5432/alerts')
    parsed = urlparse(db_url)
    try:
        conn = psycopg2.connect(
            host=parsed.hostname or '127.0.0.1',
            port=parsed.port or 5432,
            dbname=parsed.path.lstrip('/') or 'alerts',
            user=parsed.username or 'alertuser',
            password=parsed.password or 'alertpass',
        )
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, alert_type, severity, status, message,
                   metric_value, threshold_value, created_at, diagnostic_context
            FROM alert_summaries
            WHERE diagnostic_context::text LIKE %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (f'%"execution_id": "{monitor_id}"%', limit),
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
    except Exception as e:
        logger.warning(f"get_violations DB query failed for {monitor_id}: {e}")
        return []

    for r in rows:
        diag = r[8]
        if isinstance(diag, str):
            try:
                diag = _json.loads(diag)
            except (ValueError, TypeError):
                diag = {}
        out.append({
            'source': 'persisted',
            'id': r[0],
            'alert_type': r[1],
            'severity': r[2],
            'status': r[3],
            'message': r[4],
            'value': r[5],
            'threshold': r[6],
            'created_at': r[7].isoformat() if r[7] else None,
            'diagnostic_context': diag,
        })
    return out
