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
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import requests

from database import SessionLocal
from models.monitor_session import MonitorSession
from models.testbed import Testbed
from services.prometheus_url import resolve_working_prometheus_url
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

# Phase-1 enhanced-report parity:
#   * Capture a one-shot full cluster_health snapshot at monitor start so the
#     report can show "Restarts: 12 -> 38 (+26 during window)" deltas.
#   * Re-snapshot the full cluster_health every N polls so the report has
#     rich per-pod / per-container data even after the monitor process is
#     restarted. ~5 minutes at 30s polling matches the smart-execution cadence.
#   * Flip status -> DEGRADED after this many consecutive Prometheus probe
#     failures so the UI can warn testers without killing the session.
CLUSTER_HEALTH_SNAPSHOT_EVERY_POLLS = 10   # ~5 min at 30s, ~10 min at 60s
DEGRADED_FAILED_POLL_THRESHOLD = 5

# Layer-2 materialised report (2026-06-04): rebuild the bounded, view-ready
# report snapshot at the same cadence as the cluster_health snapshot it
# depends on, plus once on stop. Reads then serve the stored snapshot in
# <100ms instead of recomputing from raw observations on every page load.
REPORT_SNAPSHOT_EVERY_POLLS = CLUSTER_HEALTH_SNAPSHOT_EVERY_POLLS

# Cluster-aggregate PromQL probes captured on every poll. Kept tiny so they
# don't slow down the eval loop. None on Prometheus error → series skipped.
CLUSTER_PROBES = {
    'cluster_cpu':      'avg(100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100))',
    'cluster_max_cpu':  'max(100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100))',
    'cluster_mem':      'avg((node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100)',
    'cluster_max_mem':  'max((node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100)',
}

# Per-node (physical host) PromQL probes. Unlike CLUSTER_PROBES these are NOT
# wrapped in avg()/max() so Prometheus returns one series per host (keyed by
# the ``instance`` label). Captured via _query_prometheus_multi so the report's
# "Physical Host Metrics" charts have real per-host CPU/Mem — monitor-only
# previously collected only cluster aggregates and so that section was empty.
PER_NODE_PROBES = {
    'cpu_percent':    '100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)',
    'memory_percent': '(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100',
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


# 2026-06-04: per-process TTL cache for _testbed_meta() results.
#
# The report builder calls _testbed_meta() twice per request (once for the
# overview header, once for the fast-probe gate). It's also racy with the
# poller and any concurrent admin actions. A 30-second cache:
#
#   * collapses duplicate calls within a single build_report
#   * absorbs the burst of UI auto-refresh hits while a tab is open
#   * still picks up admin "refresh Prometheus URL" actions quickly
#     (those invalidate the cache via _invalidate_testbed_meta_cache)
#
# Keyed on (testbed_id, fast_path) so the slow/full-resolution variant used
# at monitor start time never serves a stale fast-path result.
import threading as _threading
import time as _time
_testbed_meta_cache: Dict[Any, Any] = {}
_testbed_meta_lock = _threading.Lock()
_TESTBED_META_TTL_S = 30.0


def _invalidate_testbed_meta_cache(testbed_id: Optional[str] = None) -> None:
    """Drop cached _testbed_meta entries. Pass None to clear all."""
    with _testbed_meta_lock:
        if testbed_id is None:
            _testbed_meta_cache.clear()
        else:
            for key in list(_testbed_meta_cache.keys()):
                if isinstance(key, tuple) and key and key[0] == testbed_id:
                    _testbed_meta_cache.pop(key, None)


def _testbed_meta(testbed_id: str, *, fast_path: bool = False) -> Optional[Dict[str, Any]]:
    """Return ``{prometheus_url, label, slack_channel, pc_ip, …}`` for a testbed
    or ``None`` if not found / no Prometheus configured.

    Parameters
    ----------
    fast_path
        When ``False`` (default), the returned ``prometheus_url`` is run through
        ``resolve_working_prometheus_url`` with ``allow_kubectl=True`` so
        HTTP/HTTPS scheme mismatches and stale NodePorts are auto-corrected.
        This path can take 30s-4min when the PC IP is slow or unreachable
        (SSH + kubectl roundtrip), which is acceptable at monitor-start /
        snapshot time but catastrophic on the report rebuild hot path.

        When ``True``, the resolver is skipped entirely and the stored URL is
        returned as-is. The caller is responsible for handling unreachable
        Prometheus (typically via ``is_prometheus_reachable_fast`` upstream).
        Use this from report rebuilds and any other UI request path where the
        wall-clock budget is under 10 seconds.

    Falls back to building a URL from ``pc_ip`` / ``ncm_ip`` when no explicit
    URL is stored on the testbed.
    """
    cache_key = (testbed_id, bool(fast_path))
    now = _time.time()
    with _testbed_meta_lock:
        cached = _testbed_meta_cache.get(cache_key)
        if cached is not None:
            expires_at, value = cached
            if expires_at > now:
                return value

    session = SessionLocal()
    try:
        tb = session.query(Testbed).filter(Testbed.unique_testbed_id == testbed_id).first()
        if not tb:
            with _testbed_meta_lock:
                _testbed_meta_cache[cache_key] = (now + _TESTBED_META_TTL_S, None)
            return None
        raw = tb.testbed_json or {}
        if isinstance(raw, str):
            import json as _json
            try:
                raw = _json.loads(raw)
            except (ValueError, TypeError):
                raw = {}
        pc_ip = raw.get('pc_ip') or tb.pc_ip
        ncm_ip = raw.get('ncm_ip') or tb.ncm_ip
        # Fallback chain mirrors smart-execution: stored URL > pc_ip > ncm_ip
        prom_url = (
            raw.get('prometheus_url')
            or raw.get('prometheus_endpoint')
            or (f'https://{pc_ip}:30546' if pc_ip else None)
            or (f'https://{ncm_ip}:30546' if ncm_ip else None)
        )
        # Pass full testbed context so the resolver can do kubectl-based
        # NodePort rediscovery (Layer A) if the stored URL is stale and we
        # have credentials. Persist=True so a freshly-discovered URL is
        # written back to the testbed row — every subsequent monitor or
        # smart-execution start short-circuits on the cached value instead
        # of re-running the kubectl path.
        #
        # ``fast_path=True`` callers (report rebuilds, UI hot paths) skip
        # this entire block — the resolver can SSH + kubectl-get for
        # 30s-4min when the PC is slow/unreachable, and that latency in a
        # report request is what wedged the UI at "Loading monitor
        # report…" before this fast path existed.
        if prom_url and not fast_path:
            try:
                testbed_ctx = {
                    'unique_testbed_id': testbed_id,
                    'testbed_json': raw,
                    'pc_ip': pc_ip,
                    'ncm_ip': ncm_ip,
                    'username': tb.username,
                    'password': tb.password,
                }
                resolved = resolve_working_prometheus_url(
                    prom_url,
                    testbed=testbed_ctx,
                    allow_kubectl=True,
                    persist=True,
                )
                if resolved:
                    prom_url = resolved
            except Exception as e:  # noqa: BLE001 — keep best-effort URL
                logger.debug(f"resolve_working_prometheus_url failed for {prom_url}: {e}")
        value = {
            'unique_testbed_id': testbed_id,
            'label': tb.testbed_label,
            'prometheus_url': prom_url,
            'pc_ip': pc_ip,
            'ncm_ip': ncm_ip,
            'username': tb.username,
            'password': tb.password,
            'raw': raw,
        }
        with _testbed_meta_lock:
            _testbed_meta_cache[cache_key] = (now + _TESTBED_META_TTL_S, value)
        return value
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
        # Per-node (physical host) CPU/Mem timeline. One entry per poll:
        #   {'timestamp': iso, 'per_node': [{node_id, name, cluster_name,
        #    cluster_ip, cpu_percent, memory_percent}, …]}
        # Powers the report's "Physical Host Metrics" charts.
        self._per_node_samples: List[Dict[str, Any]] = []
        self._rule_health: Dict[str, Dict[str, Any]] = {}
        self._last_violation_count = 0
        self._flush_every_polls = 5    # how often to write metric_samples to DB

        # Phase-1 enhanced-report parity:
        #   * _consecutive_failed_polls — bumped each time the rule evaluator
        #     can't reach Prometheus. Flips DB status to DEGRADED above
        #     ``DEGRADED_FAILED_POLL_THRESHOLD`` and back to RUNNING once a
        #     successful poll lands.
        #   * _last_prom_error — most recent failure reason surfaced on the
        #     Live page so testers know *why* the monitor is degraded without
        #     digging through logs.
        #   * _cluster_health_snapshot — last full cluster_health snapshot
        #     (in-memory mirror of the DB column). Captured every
        #     ``CLUSTER_HEALTH_SNAPSHOT_EVERY_POLLS`` so the report has rich
        #     per-pod data even if Prometheus blips on report-render time.
        self._consecutive_failed_polls = 0
        self._last_prom_error: Optional[str] = None
        self._cluster_health_snapshot: Dict[str, Any] = {}

        # Build a minimal SmartExecutionController-shaped object that the
        # rule evaluator can use unchanged. We don't actually run an
        # execution — we only call its rule-evaluation helpers.
        self._eval = self._build_evaluator()

    def _build_evaluator(self) -> SmartExecutionController:
        """Construct a SmartExecutionController without invoking its full
        ``__init__`` (which expects entities/thresholds/etc.). We poke just
        the fields the rule evaluator and Slack/alert-persistence touch.

        Phase-3: when a ``slack_channel_override`` (webhook URL) is stored on
        the monitor session OR ``settings.notify_email`` is set, we wrap
        ``_send_rule_violation_slack`` to (a) honour the override webhook
        instead of the testbed default and (b) optionally dispatch an
        email-on-violation. Wrapping (rather than copying the implementation)
        keeps the shared smart-execution Slack logic as the single source of
        truth.
        """
        ctrl = SmartExecutionController.__new__(SmartExecutionController)
        ctrl.execution_id = self.monitor_id  # alerts get tagged with this id
        ctrl.prometheus_url = self.testbed_meta['prometheus_url']
        # ``__init__`` would also set ``prometheus_url_https`` (a flipped
        # http<->https fallback URL) and ``_prometheus_dead`` (a one-shot
        # "give up after first total failure" flag). We intentionally bypass
        # __init__ here, so set these explicitly. Without them
        # _query_prometheus / _query_prometheus_multi raise AttributeError
        # for every cluster-aggregate sample call, which left
        # metric_samples (cluster_cpu/mem/max_cpu/max_mem) empty for the
        # entire monitor run.
        ctrl.prometheus_url_https = None
        ctrl._prometheus_dead = False
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
        # ── Phase-1 fix: Slack throttle + log/event buffer attrs ──────────
        # ``_slack_should_fire`` (called from ``_eval_rule_per_series`` for
        # every fired violation) reads ``self._slack_fire_then_silent`` and
        # ``self._slack_alert_state``. Without these, AttributeError
        # propagated out of the per-series loop *before* the
        # ``_persist_rule_violation_alert`` call could run, so the entire
        # monitor's violations were collected in-memory but NEVER landed in
        # ``alert_summaries``. Result: report's violations array empty, the
        # global Alerts page never showed monitor alerts, and verdict said
        # CLEAN even when 500+ violations fired.
        ctrl._slack_alert_state = {}
        ctrl._slack_fire_then_silent = True
        # ``_log_event`` appends to live_logs and trims by max_log_entries.
        ctrl.live_logs = []
        ctrl.max_log_entries = 500
        # ``_emit_event`` appends to events; already initialized above but
        # be explicit so future reorderings don't break it.
        # ``_persist_rule_violation_alert`` walks ``self.testbed_info`` (set
        # above), no extra state needed.
        # ``_send_rule_violation_slack`` reads ``self.testbed_info`` for
        # webhook lookup; for monitor-only the override layer handles the
        # actual delivery decision. Defaults below keep the lookup happy.
        ctrl._inflight_ops = 0
        # SocketIO live-logs broadcaster — not needed for monitor-only.
        ctrl._socketio = None
        # ── Phase-2 fix: scalar-path event-emitter attrs ─────────────────
        # ``_evaluate_monitoring_rules`` (scalar/composite + fallback path)
        # calls ``self._log_event`` and ``self._emit_event`` BEFORE
        # ``_persist_rule_violation_alert``. Those helpers reference
        # ``_event_counter`` / ``_event_timeline`` / ``start_time``. Without
        # them, AttributeError aborted the scalar branch silently and the
        # restart-rule alerts (Pod Restarts, Container Restarts) never made
        # it into ``alert_summaries`` even though they showed up in the
        # in-memory violations list and CSV export. This was the residual
        # half of the "alerts not persisting" bug.
        ctrl._event_counter = 0
        ctrl._event_timeline = []
        ctrl._operation_id_counter = 0
        ctrl._resource_lifecycle = []
        ctrl._bottleneck_history = []

        # Phase-3 hooks
        self._install_notification_overrides(ctrl)
        return ctrl

    def _install_notification_overrides(self, ctrl: SmartExecutionController) -> None:
        """Patch the Slack sender on this controller to honour Phase-3 hooks.

        We look up the override + email-notify flag from the DB row each time
        a violation fires so a config change made via reload-rules / a future
        settings-update endpoint takes effect without a restart.
        """
        monitor_id = self.monitor_id
        original_send = ctrl._send_rule_violation_slack

        def _wrapped(violation, scope_label: str = ''):
            session = SessionLocal()
            override_url = None
            notify_email = False
            try:
                row = session.query(MonitorSession).filter_by(monitor_id=monitor_id).first()
                if row:
                    override_url = row.slack_channel_override
                    notify_email = bool((row.settings or {}).get('notify_email'))
            except Exception as e:  # noqa: BLE001
                logger.debug(f"[{monitor_id}] settings lookup failed: {e}")
            finally:
                session.close()

            if override_url and str(override_url).startswith('https://hooks.slack.com/'):
                try:
                    from services.smart_execution_service import post_slack_incoming_webhook
                    rule_id = violation.get('rule_id')
                    if rule_id:
                        rule = next((r for r in self.monitoring_rules
                                     if r.get('id') == rule_id), None)
                        if rule and (rule.get('silenceSlack') or rule.get('silence_slack')
                                     or rule.get('notify_slack') is False):
                            pass  # respect per-rule silence
                        else:
                            text = self._format_slack_text(violation, scope_label)
                            post_slack_incoming_webhook(override_url, text)
                except Exception as e:
                    logger.debug(f"[{monitor_id}] override Slack send failed: {e}")
            else:
                # No override → fall back to the standard testbed-default sender
                try:
                    original_send(violation, scope_label)
                except Exception as e:
                    logger.debug(f"[{monitor_id}] default Slack send failed: {e}")

            if notify_email:
                try:
                    self._send_violation_email(violation, scope_label)
                except Exception as e:
                    logger.debug(f"[{monitor_id}] email-on-violation send failed: {e}")

        ctrl._send_rule_violation_slack = _wrapped  # type: ignore[method-assign]

    def _format_slack_text(self, violation: Dict[str, Any], scope_label: str) -> str:
        """Match the smart-execution Slack message shape so monitor-only
        alerts look identical to AI-execution ones in the channel."""
        sev_emoji = {'Critical': ':rotating_light:', 'Moderate': ':warning:',
                     'Low': ':information_source:'}
        emoji = sev_emoji.get(violation.get('severity', 'Moderate'), ':bell:')
        try:
            actual = float(violation.get('actual_value') or 0)
            actual_str = f"{actual:.4f}"
        except (TypeError, ValueError):
            actual_str = str(violation.get('actual_value'))
        return (
            f"{emoji} *Monitoring Rule Violated (Monitor-Only)*\n"
            f"*Monitor:* {self.monitor_id}\n"
            f"*Rule:* {violation.get('rule_name', '')}{scope_label}\n"
            f"*Value:* {actual_str} {violation.get('operator', '>')} "
            f"threshold {violation.get('threshold')}\n"
            f"*Severity:* {violation.get('severity')}\n"
            f"*Iteration:* {violation.get('iteration', '?')}\n"
            f"*Time:* {violation.get('timestamp', 'N/A')}"
        )

    def _send_violation_email(self, violation: Dict[str, Any], scope_label: str) -> None:
        """Send an opt-in email-on-violation using the configured SMTP settings.

        Pulls the SMTP block from the global alert config (same one the Alerts
        page uses); falls back to env vars. Safe no-op when SMTP isn't set up
        — testers won't be surprised by errors when they flip the toggle on a
        cluster that has no SMTP configured.
        """
        try:
            import smtplib
            from email.mime.text import MIMEText
            cfg = self._load_smtp_config()
            if not cfg:
                return
            recipients = (cfg.get('recipients') or [])
            if not recipients:
                return
            subject = (
                f"[{violation.get('severity', 'Moderate')}] "
                f"Monitor {self.monitor_id} rule fired: {violation.get('rule_name', '')}"
            )
            body = self._format_slack_text(violation, scope_label)
            msg = MIMEText(body)
            msg['Subject'] = subject
            msg['From'] = cfg.get('from_address') or cfg.get('smtp_username') or 'nmt-monitor@noreply'
            msg['To'] = ', '.join(recipients)
            with smtplib.SMTP(cfg['smtp_host'], int(cfg.get('smtp_port') or 587), timeout=15) as srv:
                if cfg.get('use_tls', True):
                    try:
                        srv.starttls()
                    except Exception:
                        pass
                if cfg.get('smtp_username') and cfg.get('smtp_password'):
                    srv.login(cfg['smtp_username'], cfg['smtp_password'])
                srv.sendmail(msg['From'], recipients, msg.as_string())
            logger.info(f"📧 [{self.monitor_id}] email-on-violation sent to {len(recipients)} recipient(s)")
        except Exception as e:
            logger.debug(f"[{self.monitor_id}] email send failed: {e}")

    def _load_smtp_config(self) -> Optional[Dict[str, Any]]:
        """Load global SMTP config from the alert_configs row used by the
        Alerts page, falling back to environment variables. Returns ``None``
        when SMTP is not configured (caller no-ops)."""
        try:
            import psycopg2, json as _json, os as _os  # noqa: E401
            db_url = _os.environ.get('DATABASE_URL',
                                     'postgresql://alertuser:alertpass@127.0.0.1:5432/alerts')
            from urllib.parse import urlparse
            p = urlparse(db_url)
            conn = psycopg2.connect(
                host=p.hostname or '127.0.0.1', port=p.port or 5432,
                dbname=p.path.lstrip('/') or 'alerts',
                user=p.username or 'alertuser', password=p.password or 'alertpass',
            )
            cur = conn.cursor()
            try:
                cur.execute("SELECT config_json FROM alert_configs ORDER BY id DESC LIMIT 1")
                row = cur.fetchone()
            except Exception:
                row = None
            cur.close(); conn.close()
            if row and row[0]:
                cfg = row[0] if isinstance(row[0], dict) else _json.loads(row[0])
                email = (cfg or {}).get('email') or {}
                if email.get('smtp_host'):
                    return email
        except Exception as e:
            logger.debug(f"[{self.monitor_id}] SMTP DB lookup failed: {e}")
        # Env fallback
        import os as _os
        host = _os.environ.get('NMT_SMTP_HOST')
        if not host:
            return None
        rcpt = _os.environ.get('NMT_SMTP_RECIPIENTS', '').split(',')
        rcpt = [r.strip() for r in rcpt if r.strip()]
        if not rcpt:
            return None
        return {
            'smtp_host': host,
            'smtp_port': _os.environ.get('NMT_SMTP_PORT', '587'),
            'smtp_username': _os.environ.get('NMT_SMTP_USERNAME'),
            'smtp_password': _os.environ.get('NMT_SMTP_PASSWORD'),
            'from_address': _os.environ.get('NMT_SMTP_FROM'),
            'recipients': rcpt,
            'use_tls': True,
        }

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
            # Phase-1: capture a baseline cluster_health snapshot synchronously
            # before the first poll so the report can compute "before → now"
            # deltas (restarts, OOMs, throttled pods, etc.). Failures here are
            # non-fatal — the monitor still proceeds with rule evaluation.
            try:
                self._loop.run_until_complete(self._capture_baseline_health())
            except Exception as e:  # noqa: BLE001 — never block on baseline
                logger.debug(f"[{self.monitor_id}] baseline capture failed: {e}")
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

    def _all_prometheus_urls(self) -> List[str]:
        """Return the primary + any additional Prometheus URLs to query.

        Phase-4 multi-cluster: testers can supply ``additional_prometheus_urls``
        via ``settings`` at start time (or stored on the testbed). When set,
        baseline / snapshot collection runs against each URL and the resulting
        cluster_health blocks are merged using the same union logic
        EnhancedReportService uses internally. This unblocks the "we have a PC
        AND PE Prometheus" story without forcing every monitor to set up NCM
        cluster discovery (which lives in the smart-execution path).
        """
        primary = self.testbed_meta.get('prometheus_url')
        urls: List[str] = []
        if primary:
            urls.append(primary)
        # 1. Settings override (set at start_monitor time)
        try:
            extras_session = SessionLocal()
            row = extras_session.query(MonitorSession).filter_by(monitor_id=self.monitor_id).first()
            extras = (row.settings or {}).get('additional_prometheus_urls') if row else None
            extras_session.close()
            if isinstance(extras, list):
                for u in extras:
                    if isinstance(u, str) and u.strip() and u not in urls:
                        urls.append(u.strip())
        except Exception as e:
            logger.debug(f"[{self.monitor_id}] additional_prometheus_urls lookup failed: {e}")
        # 2. Testbed-level additional URLs (e.g. PE clusters)
        raw = self.testbed_meta.get('raw') or {}
        for u in (raw.get('prometheus_urls') or raw.get('additional_prometheus_urls') or []):
            if isinstance(u, str) and u.strip() and u not in urls:
                urls.append(u.strip())
        return urls

    @staticmethod
    def _merge_cluster_health(snapshots: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Union per-pod / per-container / per-node arrays across multiple
        cluster_health snapshots so a report from a multi-cluster monitor
        contains every pod from every cluster.

        Identity tuples mirror EnhancedReportService:
          * pod arrays:    (namespace, pod)
          * container arr: (namespace, pod, container)
          * node arrays:   node
        Scalar / dict keys (e.g. ``pod_phase_summary``) are summed when both
        sides have numeric values; otherwise the first non-empty value wins.
        """
        if not snapshots:
            return {}
        if len(snapshots) == 1:
            return snapshots[0]

        UNION_POD = ('pod_cpu', 'pod_memory', 'pods_not_ready', 'problem_pods',
                     'unhealthy_pods', 'window_pod_cpu_max', 'window_pod_memory_max',
                     'window_restarts', 'window_oom_events', 'oom_killed', 'restart_timestamps')
        UNION_CTR = ('container_cpu', 'container_memory', 'container_restarts',
                     'total_restarts', 'cpu_throttling', 'terminated_containers')
        UNION_NODE = ('node_conditions', 'node_breakdown', 'node_cpu', 'node_memory', 'node_disk')
        UNION_OTHER = ('api_server_latency', 'pvc_health')
        merged: Dict[str, Any] = {}
        # Seed with the first snapshot
        for k, v in (snapshots[0] or {}).items():
            merged[k] = v if not isinstance(v, list) else list(v)

        def _key(row: Dict[str, Any], dims: Tuple[str, ...]) -> Tuple:
            return tuple(row.get(d) for d in dims)

        for snap in snapshots[1:]:
            if not isinstance(snap, dict):
                continue
            for k in UNION_POD + UNION_CTR + UNION_NODE + UNION_OTHER:
                live = merged.get(k) if isinstance(merged.get(k), list) else []
                add = snap.get(k) if isinstance(snap.get(k), list) else []
                if not add:
                    continue
                dims: Tuple[str, ...]
                if k in UNION_POD:
                    dims = ('namespace', 'pod')
                elif k in UNION_CTR:
                    dims = ('namespace', 'pod', 'container')
                elif k in UNION_NODE:
                    dims = ('node',)
                else:
                    dims = tuple()
                seen = set()
                if dims:
                    for r in live:
                        if isinstance(r, dict):
                            seen.add(_key(r, dims))
                out = list(live)
                for r in add:
                    if not isinstance(r, dict):
                        out.append(r); continue
                    if dims and _key(r, dims) in seen:
                        continue
                    out.append(r)
                    if dims:
                        seen.add(_key(r, dims))
                merged[k] = out
            # Sum pod_phase_summary across clusters
            phases = merged.get('pod_phase_summary')
            add_phases = snap.get('pod_phase_summary')
            if isinstance(phases, dict) and isinstance(add_phases, dict):
                for ph, ct in add_phases.items():
                    try:
                        phases[ph] = (phases.get(ph) or 0) + int(ct or 0)
                    except (TypeError, ValueError):
                        continue
                merged['pod_phase_summary'] = phases
            elif isinstance(add_phases, dict) and not isinstance(phases, dict):
                merged['pod_phase_summary'] = dict(add_phases)
        # Annotate provenance so the report can show "merged from N clusters"
        merged['multi_cluster_sources'] = len(snapshots)
        return merged

    def _collect_cluster_health_multi(self) -> Dict[str, Any]:
        """Run cluster_health collection across every configured Prometheus URL
        and union the results. Falls back to single-URL behaviour when only
        one URL is configured (no extra cost).
        """
        from services.enhanced_report_service import EnhancedReportService
        urls = self._all_prometheus_urls()
        if not urls:
            return {}
        snapshots: List[Dict[str, Any]] = []
        for u in urls:
            try:
                ers = EnhancedReportService(prometheus_url=u)
                snap = ers._collect_cluster_health()
                if isinstance(snap, dict) and snap:
                    snapshots.append(snap)
            except Exception as e:  # noqa: BLE001 — keep collecting other clusters
                logger.debug(f"[{self.monitor_id}] cluster_health collect failed for {u}: {e}")
        return self._merge_cluster_health(snapshots)

    async def _capture_baseline_health(self) -> None:
        """One-shot full cluster_health capture written to baseline_health.

        Uses ``EnhancedReportService._collect_cluster_health()`` so the shape
        matches exactly what the report will compare against later. Stored in
        ``MonitorSession.baseline_health``. Safe to no-op on Prometheus
        failures — the report renders the "Now" column even without a baseline.
        Phase 4.1: queries every configured Prometheus URL and unions results.
        """
        snap = self._collect_cluster_health_multi()
        if not isinstance(snap, dict) or not snap:
            return
        session = SessionLocal()
        try:
            row = session.query(MonitorSession).filter_by(monitor_id=self.monitor_id).first()
            if row:
                row.baseline_health = snap
                session.commit()
                logger.info(f"📸 [{self.monitor_id}] baseline cluster_health captured "
                            f"({len(snap.get('pod_cpu') or [])} pods, "
                            f"sources={snap.get('multi_cluster_sources', 1)})")
        except Exception as e:
            session.rollback()
            logger.debug(f"[{self.monitor_id}] persist baseline failed: {e}")
        finally:
            session.close()

    async def _capture_cluster_health_snapshot(self) -> None:
        """Refresh the persisted full cluster_health snapshot.

        Called periodically (every ``CLUSTER_HEALTH_SNAPSHOT_EVERY_POLLS``) so
        the report builder has fresh per-pod / per-container data even after
        the monitor process is gone (e.g. browser opens the report after the
        monitor stopped). Mirrors smart-execution's snapshot cadence.
        Phase 4.1: queries every configured Prometheus URL and unions results.
        """
        snap = self._collect_cluster_health_multi()
        if not isinstance(snap, dict) or not snap:
            return
        self._cluster_health_snapshot = snap
        session = SessionLocal()
        try:
            row = session.query(MonitorSession).filter_by(monitor_id=self.monitor_id).first()
            if row:
                row.cluster_health_snapshot = snap
                session.commit()
        except Exception as e:
            session.rollback()
            logger.debug(f"[{self.monitor_id}] persist cluster_health snapshot failed: {e}")
        finally:
            session.close()

    async def _refresh_report_snapshot(self) -> None:
        """Rebuild + persist the Layer-2 materialised report snapshot.

        Runs the (synchronous, possibly several-second) build off the event
        loop via the default executor so it never stalls rule evaluation /
        stop responsiveness. Best-effort: a failure here only means the
        report read path serves a slightly older snapshot — it never affects
        the monitor itself.
        """
        try:
            from services.report_snapshot_repo import refresh_monitor_snapshot
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None, refresh_monitor_snapshot, self.monitor_id
            )
            if result and result.get('success'):
                logger.debug(
                    f"[{self.monitor_id}] report snapshot refreshed "
                    f"(quality={result.get('data_quality')} "
                    f"size={result.get('size_bytes')}B)"
                )
        except Exception as e:  # noqa: BLE001 — snapshotting must never break poll
            logger.debug(f"[{self.monitor_id}] report snapshot refresh error: {e}")

    async def _poll_loop(self) -> None:
        deadline_ts = (
            time.time() + self.duration_hours * 3600
            if self.duration_hours and self.duration_hours > 0 else None
        )
        iteration = 0
        while not self._stop_event.is_set():
            iteration += 1
            poll_ok = True
            try:
                await self._eval._evaluate_monitoring_rules(iteration)
            except Exception as e:
                poll_ok = False
                self._last_prom_error = str(e)[:500]
                logger.warning(f"[{self.monitor_id}] iter {iteration} eval error: {e}")
            # Phase-2: capture cluster aggregates + per-rule health each poll
            try:
                await self._capture_metric_samples(iteration)
            except Exception as e:
                logger.debug(f"[{self.monitor_id}] sample capture error: {e}")
            # Phase-1: refresh full cluster_health snapshot every N polls so
            # the report has fresh per-pod data. The first snapshot lands on
            # iteration=1 so report-render-during-first-minute already has data.
            if iteration == 1 or (iteration % CLUSTER_HEALTH_SNAPSHOT_EVERY_POLLS == 0):
                try:
                    await self._capture_cluster_health_snapshot()
                except Exception as e:
                    logger.debug(f"[{self.monitor_id}] cluster_health snapshot error: {e}")
                # Layer-2: rebuild the materialised report snapshot right after
                # the cluster_health it depends on lands, so reads stay fast.
                if iteration == 1 or (iteration % REPORT_SNAPSHOT_EVERY_POLLS == 0):
                    await self._refresh_report_snapshot()

            # Phase-1: degraded-status tracking. Bump on failure, reset on
            # success. ``_record_poll`` propagates the count + status flip to
            # the DB row so the Live page can show a DEGRADED badge.
            if poll_ok:
                self._consecutive_failed_polls = 0
            else:
                self._consecutive_failed_polls += 1

            # Layer-C circuit breaker: once we cross the DEGRADED threshold,
            # try to self-heal the Prometheus URL via the resolver (which
            # will SSH to the PC and re-run kubectl to find the current
            # NodePort if the URL is stale). The recovery helper has its
            # own cooldown so this is safe to call every failed poll — it
            # only actually does I/O once every ~10 minutes.
            if (not poll_ok
                    and self._consecutive_failed_polls >= DEGRADED_FAILED_POLL_THRESHOLD):
                try:
                    from services.prometheus_url import attempt_url_recovery
                    testbed_ctx = {
                        'unique_testbed_id': self.testbed_meta.get('unique_testbed_id'),
                        'pc_ip': self.testbed_meta.get('pc_ip'),
                        'ncm_ip': self.testbed_meta.get('ncm_ip'),
                        'username': self.testbed_meta.get('username'),
                        'password': self.testbed_meta.get('password'),
                        'testbed_json': self.testbed_meta.get('raw') or {},
                    }
                    new_url, ts, changed = attempt_url_recovery(
                        self.testbed_meta.get('prometheus_url'),
                        testbed_ctx,
                        last_attempt_ts=getattr(self, '_last_prom_recovery_at', 0.0),
                    )
                    self._last_prom_recovery_at = ts
                    if changed and new_url:
                        logger.info(
                            f"[{self.monitor_id}] 🔄 self-healed prometheus_url: "
                            f"{self.testbed_meta.get('prometheus_url')} -> {new_url}"
                        )
                        self.testbed_meta['prometheus_url'] = new_url
                        # Push to the controller stub so the next evaluator
                        # call uses the fresh URL without restarting.
                        try:
                            self._eval.prometheus_url = new_url
                        except Exception:
                            pass
                        # Clear "Prometheus is dead" flag if it was tripped
                        # elsewhere so the next poll actually attempts a query.
                        try:
                            self._eval._prometheus_dead = False
                        except Exception:
                            pass
                except Exception as e:
                    logger.debug(f"[{self.monitor_id}] prometheus URL recovery attempt failed: {e}")

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
        # Phase-1: final cluster_health snapshot so "stopped" reports are
        # never missing the last view.
        try:
            await self._capture_cluster_health_snapshot()
        except Exception as e:
            logger.debug(f"[{self.monitor_id}] final cluster_health snapshot error: {e}")
        # Layer-2: final materialised report snapshot so the stopped report
        # is immediately fast + complete without a first slow rebuild.
        try:
            await self._refresh_report_snapshot()
        except Exception as e:
            logger.debug(f"[{self.monitor_id}] final report snapshot error: {e}")
        self._update_status('STOPPED', stopped=True)
        logger.info(f"[{self.monitor_id}] stopped (polls={iteration})")

    # ── Phase-2: per-poll cluster timeseries capture ─────────────────
    async def _capture_metric_samples(self, iteration: int) -> None:
        """Query the four cluster aggregates and append to in-memory series.
        Also updates per-rule health stats based on the latest evaluator state.
        """
        ts_iso = datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'
        for key, query in CLUSTER_PROBES.items():
            v: Optional[float]
            try:
                v = await self._eval._query_prometheus(query)
            except Exception as e:
                # Surface the underlying error so an empty cluster_cpu / cluster_mem
                # series in the report doesn't stay a silent mystery. Historically
                # this swallowed AttributeError for ``prometheus_url_https`` and
                # left every monitor's timeseries empty.
                logger.warning(
                    f"[{self.monitor_id}] cluster probe '{key}' raised "
                    f"{type(e).__name__}: {e}"
                )
                v = None
            if v is None:
                logger.debug(f"[{self.monitor_id}] cluster probe '{key}' returned None on iteration {iteration}")
                continue
            self._metric_samples[key].append([ts_iso, round(float(v), 4)])
            self._metric_samples[key] = _downsample(self._metric_samples[key], MAX_SAMPLES_PER_SERIES)

        # Per-node (physical host) capture — best-effort. A failure here only
        # skips this poll's per-host sample; the cluster aggregates above are
        # unaffected.
        try:
            self._capture_per_node_sample(ts_iso)
        except Exception as e:
            logger.debug(f"[{self.monitor_id}] per-node capture skipped: {e}")

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

    def _capture_per_node_sample(self, ts_iso: str) -> None:
        """Query per-instance CPU/Mem and append one per-host timeline entry.

        Uses the controller's multi-result query so every physical host shows
        up as its own series in the report's Physical Host Metrics chart,
        rather than collapsing to a single cluster average.
        """
        by_instance: Dict[str, Dict[str, Any]] = {}
        for field, query in PER_NODE_PROBES.items():
            try:
                results = self._eval._query_prometheus_multi(query)
            except Exception as e:
                logger.debug(
                    f"[{self.monitor_id}] per-node probe '{field}' raised "
                    f"{type(e).__name__}: {e}"
                )
                continue
            for r in results or []:
                inst = (r.get('metric') or {}).get('instance') or ''
                if not inst:
                    continue
                val = r.get('value')
                if not val or len(val) < 2:
                    continue
                try:
                    fv = round(float(val[1]), 2)
                except (TypeError, ValueError):
                    continue
                by_instance.setdefault(inst, {})[field] = fv

        if not by_instance:
            return

        cluster_name = self.testbed_meta.get('label') or ''
        cluster_ip = (self.testbed_meta.get('pc_ip')
                      or self.testbed_meta.get('ncm_ip') or '')
        per_node: List[Dict[str, Any]] = []
        for inst, vals in sorted(by_instance.items()):
            # Strip the :9100 (node-exporter) port for a cleaner host label.
            name = inst.split(':')[0] if ':' in inst else inst
            per_node.append({
                'node_id': inst,
                'name': name,
                'cluster_name': cluster_name,
                'cluster_ip': cluster_ip,
                'cpu_percent': vals.get('cpu_percent', 0.0),
                'memory_percent': vals.get('memory_percent', 0.0),
            })

        self._per_node_samples.append({'timestamp': ts_iso, 'per_node': per_node})
        self._per_node_samples = _downsample(self._per_node_samples, MAX_SAMPLES_PER_SERIES)

    def _persist_metric_samples(self) -> None:
        """Write the current ``metric_samples`` snapshot to the DB row."""
        session = SessionLocal()
        try:
            row = session.query(MonitorSession).filter_by(monitor_id=self.monitor_id).first()
            if not row:
                return
            row.metric_samples = {
                **{k: v for k, v in self._metric_samples.items()},
                'per_node_series': self._per_node_samples,
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
            # Phase-1: degraded-status tracking. Stay in RUNNING normally;
            # flip to DEGRADED above the threshold but never overwrite an
            # explicit STOPPED / FAILED.
            row.consecutive_failed_polls = self._consecutive_failed_polls
            if self._last_prom_error and self._consecutive_failed_polls > 0:
                row.last_prometheus_error = self._last_prom_error
            elif self._consecutive_failed_polls == 0:
                row.last_prometheus_error = None
            if row.status in ('RUNNING', 'DEGRADED'):
                if self._consecutive_failed_polls >= DEGRADED_FAILED_POLL_THRESHOLD:
                    row.status = 'DEGRADED'
                elif self._consecutive_failed_polls == 0 and row.status == 'DEGRADED':
                    row.status = 'RUNNING'
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
                  settings: Optional[Dict[str, Any]] = None,
                  slack_channel_override: Optional[str] = None,
                  schedule: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Start a new monitor-only session. Returns the persisted row's dict.

    Optional kwargs (Phase 3/4):
    - ``slack_channel_override`` overrides the testbed's default Slack channel
      for THIS monitor only (alerts still land in ``alert_summaries`` so the
      Alerts page is unaffected).
    - ``schedule`` is a free-form descriptor (``{start_at, repeat, status}``)
      persisted so scheduled monitors can be materialised by the scheduler.
    - ``settings.notify_email`` (bool) — opt-in email-on-violation per monitor.
    """
    if not testbed_id:
        return {'success': False, 'error': 'testbed_id required'}
    # NOTE: monitoring_rules may be empty. Monitor-only always captures pod
    # restarts, OOM kills, CPU throttling and full cluster_health snapshots
    # via _capture_metric_samples() / _capture_cluster_health_snapshot(),
    # so a session with no rules still produces a useful report — rules are
    # only needed for user-defined Slack/email-on-threshold alerts.
    monitoring_rules = monitoring_rules or []

    poll_interval_s = max(MIN_POLL_INTERVAL_S, min(MAX_POLL_INTERVAL_S, int(poll_interval_s or DEFAULT_POLL_INTERVAL_S)))

    # fast_path=True so monitor start cannot wedge for 30s-4min when the
    # testbed's PC IP is slow/unreachable. The poller's
    # ``attempt_url_recovery`` (10-min cooldown) handles stale NodePort
    # rediscovery once the monitor is actually running, and the explicit
    # "Refresh Prometheus URL" admin button is the right place for an
    # interactive kubectl rediscovery.
    meta = _testbed_meta(testbed_id, fast_path=True)
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
            slack_channel_override=slack_channel_override,
            schedule=schedule,
            rule_history=[{
                'ts': datetime.utcnow().isoformat() + 'Z',
                'source': 'start',
                'total_rules': len(monitoring_rules),
                'replaced_count': len(monitoring_rules),
                'dropped_cooldowns': 0,
            }],
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
    added = len(new_ids - old_ids)
    removed = len(old_ids - new_ids)
    # Persist the new rule_config AND append to the audit history so the
    # report can show "added 2 rules at 11:42, removed 1 at 12:15" etc.
    session = SessionLocal()
    try:
        row = session.query(MonitorSession).filter_by(monitor_id=monitor_id).first()
        if row:
            row.rule_config = {'monitoring_rules': monitoring_rules}
            history = list(row.rule_history or [])
            history.append({
                'ts': datetime.utcnow().isoformat() + 'Z',
                'source': 'reload',
                'total_rules': len(monitoring_rules),
                'replaced_count': added,
                'removed_count': removed,
                'dropped_cooldowns': dropped,
            })
            # Cap history at 100 entries so it can't grow forever
            row.rule_history = history[-100:]
            session.commit()
    except Exception as e:
        session.rollback()
        logger.warning(f"reload_monitor_rules: failed to persist new config: {e}")
    finally:
        session.close()
    return {
        'success': True,
        'replaced_count': added,
        'removed_count': removed,
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
                  limit: int = 100, offset: int = 0) -> Dict[str, Any]:
    """List monitor sessions with pagination.

    Returns ``{rows, total, limit, offset}`` so the UI can render "Showing
    1-50 of 137" pagers without a second count query.

    .. note::
        Returns the **full** ``MonitorSession.to_dict()`` for each row,
        which includes large JSONB columns (baseline_health,
        cluster_health_snapshot, metric_samples — easily 100s of KB per
        row). Use :func:`list_monitors_summary` for the sessions-page
        listing path; reserve this for callers that genuinely need the
        full payload (debug tools, exports).
    """
    session = SessionLocal()
    try:
        q = session.query(MonitorSession)
        if testbed_id:
            q = q.filter(MonitorSession.testbed_id == testbed_id)
        if status:
            q = q.filter(MonitorSession.status == status)
        total = q.count()
        q = q.order_by(MonitorSession.started_at.desc()).offset(offset).limit(limit)
        return {
            'rows': [r.to_dict() for r in q.all()],
            'total': total,
            'limit': limit,
            'offset': offset,
        }
    finally:
        session.close()


def list_monitors_summary(testbed_id: Optional[str] = None,
                          status: Optional[str] = None,
                          limit: int = 100, offset: int = 0) -> Dict[str, Any]:
    """Slim, enriched listing optimised for the Sessions page.

    For each row we return only the columns the UI needs (no JSONB blobs)
    plus three enrichments that the old endpoint forced the frontend to
    fake:

    * ``testbed_name`` / ``pc_ip`` — resolved from the ``testbeds`` table
      so the UI doesn't have to show a raw UUID.
    * ``alert_summary`` — ``{critical, warning, info, total}`` counts of
      ``alert_summaries`` rows whose ``diagnostic_context.execution_id``
      matches this monitor_id. Computed in one batched SQL query.
    * ``duration_elapsed_seconds`` / ``duration_remaining_seconds`` —
      derived from ``started_at`` + ``duration_hours`` so the UI can show
      "12h elapsed · 12h remaining" without doing date math.
    * ``rule_count`` — count of monitoring_rules in the rule_config blob
      (the only thing we need from rule_config for the list view).
    * ``is_running`` — flag based on the in-memory registry, mirrors the
      flag :func:`get_monitor` returns.

    Returns ``{rows, total, limit, offset}`` (same envelope as
    :func:`list_monitors`).
    """
    from sqlalchemy import text as _sql_text

    session = SessionLocal()
    try:
        q = session.query(MonitorSession)
        if testbed_id:
            q = q.filter(MonitorSession.testbed_id == testbed_id)
        if status:
            q = q.filter(MonitorSession.status == status)
        total = q.count()
        q = q.order_by(MonitorSession.started_at.desc()).offset(offset).limit(limit)
        rows = q.all()

        # Resolve testbed labels in one round trip (avoid N+1).
        testbed_ids = {r.testbed_id for r in rows if r.testbed_id}
        testbed_map: Dict[str, Dict[str, Any]] = {}
        if testbed_ids:
            tbs = (session.query(Testbed)
                   .filter(Testbed.unique_testbed_id.in_(testbed_ids))
                   .all())
            for tb in tbs:
                raw = tb.testbed_json or {}
                if isinstance(raw, str):
                    import json as _json
                    try:
                        raw = _json.loads(raw)
                    except (ValueError, TypeError):
                        raw = {}
                testbed_map[tb.unique_testbed_id] = {
                    'testbed_name': tb.testbed_label or raw.get('testbed_label') or tb.unique_testbed_id,
                    'pc_ip': raw.get('pc_ip') or tb.pc_ip,
                }

        # Aggregate alert counts in one batched query — `alert_summaries`
        # carries the originating monitor_id in `diagnostic_context.execution_id`.
        alert_map: Dict[str, Dict[str, int]] = {}
        monitor_ids = [r.monitor_id for r in rows if r.monitor_id]
        if monitor_ids:
            try:
                sql = _sql_text("""
                    SELECT diagnostic_context->>'execution_id' AS mid,
                           LOWER(COALESCE(severity, 'info')) AS sev,
                           COUNT(*) AS n
                    FROM alert_summaries
                    WHERE diagnostic_context->>'execution_id' = ANY(:ids)
                    GROUP BY 1, 2
                """)
                result = session.execute(sql, {'ids': monitor_ids})
                for mid, sev, n in result:
                    if not mid:
                        continue
                    slot = alert_map.setdefault(mid, {'critical': 0, 'warning': 0, 'info': 0, 'total': 0})
                    # Bucket non-standard severities (e.g. "moderate", "low") into warning/info.
                    if sev in ('critical', 'fatal', 'error'):
                        slot['critical'] += int(n)
                    elif sev in ('warning', 'warn', 'moderate', 'medium'):
                        slot['warning'] += int(n)
                    else:
                        slot['info'] += int(n)
                    slot['total'] += int(n)
            except Exception as e:  # noqa: BLE001 — alerts table optional / new schema
                logger.debug(f"alert_summary aggregation failed: {e}")

        now = _now_utc()
        out_rows: List[Dict[str, Any]] = []
        for r in rows:
            started_at = r.started_at
            stopped_at = r.stopped_at
            elapsed = None
            if started_at:
                end_ts = stopped_at or now
                try:
                    elapsed = max(0, int((end_ts - started_at).total_seconds()))
                except Exception:
                    elapsed = None
            remaining = None
            if started_at and r.duration_hours and not stopped_at:
                try:
                    target_end = started_at + timedelta(hours=float(r.duration_hours))
                    remaining = int((target_end - now).total_seconds())
                    if remaining < 0:
                        remaining = 0
                except Exception:
                    remaining = None

            rule_count = 0
            rc = r.rule_config or {}
            if isinstance(rc, dict):
                mr = rc.get('monitoring_rules') or []
                if isinstance(mr, list):
                    rule_count = len(mr)

            tb = testbed_map.get(r.testbed_id, {})
            alert_summary = alert_map.get(r.monitor_id) or {
                'critical': 0, 'warning': 0, 'info': 0, 'total': 0,
            }

            out_rows.append({
                'monitor_id': r.monitor_id,
                'testbed_id': r.testbed_id,
                'testbed_name': tb.get('testbed_name') or r.testbed_id,
                'pc_ip': tb.get('pc_ip'),
                'name': r.name,
                'description': r.description,
                'status': r.status,
                'last_error': r.last_error,
                'started_at': started_at.isoformat() if started_at else None,
                'stopped_at': stopped_at.isoformat() if stopped_at else None,
                'last_poll_at': r.last_poll_at.isoformat() if r.last_poll_at else None,
                'poll_interval_s': r.poll_interval_s,
                'duration_hours': r.duration_hours,
                'duration_elapsed_seconds': elapsed,
                'duration_remaining_seconds': remaining,
                'total_polls': r.total_polls,
                'total_violations': r.total_violations,
                'consecutive_failed_polls': r.consecutive_failed_polls or 0,
                'last_prometheus_error': r.last_prometheus_error,
                'rule_count': rule_count,
                'alert_summary': alert_summary,
                'is_running': r.monitor_id in _RUNNING_MONITORS,
                'slack_channel_override': r.slack_channel_override,
            })

        return {
            'rows': out_rows,
            'total': total,
            'limit': limit,
            'offset': offset,
        }
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
        # Pull live in-memory state if running — DB only flushes every N polls
        # so without this rule_health appears empty during the first few polls
        # and the user can't tell if rules are actually evaluating.
        runtime = _RUNNING_MONITORS.get(monitor_id)
        if runtime:
            d['live_violations'] = len(runtime._eval.monitoring_rule_violations)
            d['consecutive_failed_polls'] = runtime._consecutive_failed_polls
            if runtime._last_prom_error:
                d['last_prometheus_error'] = runtime._last_prom_error
            # Overlay live rule_health + metric_samples so callers see current
            # state without waiting for the next flush.
            live_samples = dict(d.get('metric_samples') or {})
            for k, v in (runtime._metric_samples or {}).items():
                live_samples[k] = v
            if runtime._per_node_samples:
                live_samples['per_node_series'] = runtime._per_node_samples
            if runtime._rule_health:
                live_samples['rule_health'] = runtime._rule_health
            d['metric_samples'] = live_samples

        # ── Phase-2 (v5) Live-View enrichment ───────────────────────────────
        # The Run page wants 8 header stat cards + sparklines + pod summary
        # + alert summary without making 4 separate API calls. Pre-compute
        # all of that here so the frontend just renders.
        d.update(_compute_live_enrichment(session, row))
        return d
    finally:
        session.close()


def _compute_live_enrichment(session, row: MonitorSession) -> Dict[str, Any]:
    """Compute the derived fields the live Run page needs.

    Adds (all keys present, falsy when unknown):
      * ``duration_elapsed_seconds`` / ``duration_remaining_seconds``
      * ``testbed_name`` / ``pc_ip``
      * ``alert_summary`` ``{critical, warning, info, total}``
      * ``rule_count``
      * ``pod_health_summary`` ``{critical, watch, healthy, total}`` —
        derived from the latest ``cluster_health_snapshot`` so the live
        view shows the same pod buckets as the report without an
        Enhanced-Report rebuild.
      * ``latest_cluster_summary`` ``{nodes, pods, containers, namespaces}``
      * ``latest_cluster_allocation`` ``{cpu_utilization_pct, memory_utilization_pct, …}``
    """
    from sqlalchemy import text as _sql_text

    out: Dict[str, Any] = {}
    now = _now_utc()

    started_at = row.started_at
    if started_at:
        end_ts = row.stopped_at or now
        try:
            out['duration_elapsed_seconds'] = max(0, int((end_ts - started_at).total_seconds()))
        except Exception:
            out['duration_elapsed_seconds'] = None
    else:
        out['duration_elapsed_seconds'] = None

    if started_at and row.duration_hours and not row.stopped_at:
        try:
            target = started_at + timedelta(hours=float(row.duration_hours))
            rem = int((target - now).total_seconds())
            out['duration_remaining_seconds'] = max(0, rem)
        except Exception:
            out['duration_remaining_seconds'] = None
    else:
        out['duration_remaining_seconds'] = None

    # Testbed label + pc_ip (best-effort, no error if testbed deleted)
    try:
        tb = session.query(Testbed).filter(Testbed.unique_testbed_id == row.testbed_id).first()
        if tb:
            raw = tb.testbed_json or {}
            if isinstance(raw, str):
                import json as _json
                try:
                    raw = _json.loads(raw)
                except (ValueError, TypeError):
                    raw = {}
            out['testbed_name'] = tb.testbed_label or raw.get('testbed_label') or row.testbed_id
            out['pc_ip'] = raw.get('pc_ip') or tb.pc_ip
        else:
            out['testbed_name'] = row.testbed_id
            out['pc_ip'] = None
    except Exception:
        out['testbed_name'] = row.testbed_id
        out['pc_ip'] = None

    # Rule count
    rc = row.rule_config or {}
    if isinstance(rc, dict):
        mr = rc.get('monitoring_rules') or []
        out['rule_count'] = len(mr) if isinstance(mr, list) else 0
    else:
        out['rule_count'] = 0

    # Alert severity summary (same query as the listing endpoint)
    out['alert_summary'] = {'critical': 0, 'warning': 0, 'info': 0, 'total': 0}
    try:
        sql = _sql_text("""
            SELECT LOWER(COALESCE(severity, 'info')) AS sev, COUNT(*) AS n
            FROM alert_summaries
            WHERE diagnostic_context->>'execution_id' = :mid
            GROUP BY 1
        """)
        for sev, n in session.execute(sql, {'mid': row.monitor_id}):
            if sev in ('critical', 'fatal', 'error'):
                out['alert_summary']['critical'] += int(n)
            elif sev in ('warning', 'warn', 'moderate', 'medium'):
                out['alert_summary']['warning'] += int(n)
            else:
                out['alert_summary']['info'] += int(n)
            out['alert_summary']['total'] += int(n)
    except Exception as e:  # noqa: BLE001
        logger.debug(f"_compute_live_enrichment: alert aggregation failed: {e}")

    # Pod / cluster summary derived from the most recent snapshot we have.
    snap = row.cluster_health_snapshot or {}
    if isinstance(snap, dict):
        out['latest_cluster_summary'] = snap.get('cluster_summary') or {}
        out['latest_cluster_allocation'] = snap.get('cluster_allocation') or {}
        out['pod_health_summary'] = _derive_pod_health_summary(snap)
        # Also surface the timestamp of the snapshot so the live view can
        # show "snapshot 4m ago" rather than letting the user wonder.
        out['cluster_snapshot_at'] = snap.get('captured_at') or snap.get('timestamp')
    else:
        out['latest_cluster_summary'] = {}
        out['latest_cluster_allocation'] = {}
        out['pod_health_summary'] = {'critical': 0, 'watch': 0, 'healthy': 0, 'total': 0}
        out['cluster_snapshot_at'] = None

    return out


def _derive_pod_health_summary(snap: Dict[str, Any]) -> Dict[str, int]:
    """Bucket pods into critical / watch / healthy using the same signals
    the enhanced report uses, so the live view's numbers match the report.

    * ``critical`` — pod appears in ``oom_killed``, ``unhealthy_pods``, or
      ``problem_pods`` (any Pending / Failed / Unknown phase).
    * ``watch``    — pod appears in ``pods_not_ready``, ``cpu_throttling``,
      or any pod with restarts in the report window (``window_restarts``).
    * ``healthy``  — total pod count minus the above (clamped at 0).
    """
    def _names(rows: Any) -> set:
        out = set()
        if not isinstance(rows, list):
            return out
        for r in rows:
            if isinstance(r, dict):
                pod = r.get('pod') or r.get('pod_name')
                ns = r.get('namespace') or r.get('ns') or '?'
                if pod:
                    out.add(f"{ns}/{pod}")
        return out

    crit = set()
    crit |= _names(snap.get('oom_killed'))
    crit |= _names(snap.get('unhealthy_pods'))
    crit |= _names(snap.get('problem_pods'))

    watch = set()
    watch |= _names(snap.get('pods_not_ready'))
    watch |= _names(snap.get('cpu_throttling'))
    watch |= _names(snap.get('window_restarts'))
    watch -= crit  # critical wins

    total = 0
    cs = snap.get('cluster_summary') or {}
    try:
        total = int(cs.get('pods') or 0)
    except (TypeError, ValueError):
        total = 0

    healthy = max(0, total - len(crit) - len(watch))
    return {
        'critical': len(crit),
        'watch': len(watch),
        'healthy': healthy,
        'total': total,
    }


def delete_monitor(monitor_id: str) -> Dict[str, Any]:
    """Delete a non-running monitor session row. Live runs must be stopped first.

    Note: this only removes the ``monitor_sessions`` row; persisted alerts in
    ``alert_summaries`` linked to this monitor stay (intentional — alert
    history shouldn't disappear when a tester cleans up sessions).
    """
    with _LOCK:
        if monitor_id in _RUNNING_MONITORS:
            return {'success': False, 'error': 'Monitor is still running — stop it first'}
    session = SessionLocal()
    try:
        row = session.query(MonitorSession).filter_by(monitor_id=monitor_id).first()
        if not row:
            return {'success': False, 'error': 'Monitor not found'}
        session.delete(row)
        session.commit()
        logger.info(f"🗑️ Deleted monitor session {monitor_id}")
        return {'success': True, 'monitor_id': monitor_id}
    except Exception as e:
        session.rollback()
        logger.warning(f"delete_monitor failed for {monitor_id}: {e}")
        return {'success': False, 'error': str(e)}
    finally:
        session.close()


def snapshot_testbed(testbed_id: str) -> Dict[str, Any]:
    """One-shot enhanced-report snapshot for a testbed (no session created).

    Useful for testers who want an ad-hoc cluster health view without
    configuring rules or starting a long-running monitor. Returns the same
    payload shape as ``EnhancedReportService.generate_enhanced_report``,
    minus operations / spike analysis (no execution history).
    """
    # fast_path=True — see start_monitor for rationale. Snapshot is a hot
    # UI action; if the stored URL is stale the caller can repair via
    # "Refresh Prometheus URL".
    meta = _testbed_meta(testbed_id, fast_path=True)
    if not meta:
        return {'success': False, 'error': f'Testbed {testbed_id} not found'}
    if not meta.get('prometheus_url'):
        return {'success': False, 'error': 'Testbed has no Prometheus URL configured'}
    try:
        from services.enhanced_report_service import EnhancedReportService
        ers = EnhancedReportService(prometheus_url=meta['prometheus_url'])
        snap = ers._collect_cluster_health()
    except Exception as e:
        logger.exception(f"snapshot_testbed failed for {testbed_id}: {e}")
        return {'success': False, 'error': f'Snapshot failed: {e}'}
    return {
        'success': True,
        'testbed_id': testbed_id,
        'label': meta.get('label'),
        'prometheus_url': meta.get('prometheus_url'),
        'captured_at': datetime.utcnow().isoformat() + 'Z',
        'cluster_health': snap,
    }


def test_rule(testbed_id: str, rule: Dict[str, Any]) -> Dict[str, Any]:
    """Evaluate a single rule against a testbed's Prometheus right now.

    Returns the resolved scalar/per-series values + whether the rule would
    fire. Lets testers verify a rule before kicking off a long monitor.
    """
    if not isinstance(rule, dict):
        return {'success': False, 'error': 'rule must be a dict'}
    # fast_path=True — test-rule is an interactive UI action; long
    # kubectl/SSH waits here turn into "page hung" complaints. See
    # start_monitor for the broader rationale.
    meta = _testbed_meta(testbed_id, fast_path=True)
    if not meta:
        return {'success': False, 'error': f'Testbed {testbed_id} not found'}
    if not meta.get('prometheus_url'):
        return {'success': False, 'error': 'Testbed has no Prometheus URL configured'}

    ctrl = SmartExecutionController.__new__(SmartExecutionController)
    ctrl.execution_id = f'TEST-{uuid.uuid4().hex[:8]}'
    ctrl.prometheus_url = meta['prometheus_url']
    # Same rationale as _build_evaluator: bypassing __init__ means a bunch
    # of state initialised in __init__ is missing. _query_prometheus reads
    # prometheus_url_https/_prometheus_dead, _slack_should_fire reads
    # _slack_fire_then_silent/_slack_alert_state, _log_event reads
    # live_logs/max_log_entries. Set them all so test-rule eval doesn't
    # silently swallow AttributeError mid-violation.
    ctrl.prometheus_url_https = None
    ctrl._prometheus_dead = False
    ctrl._slack_alert_state = {}
    ctrl._slack_fire_then_silent = True
    ctrl.live_logs = []
    ctrl.max_log_entries = 500
    ctrl._inflight_ops = 0
    ctrl._socketio = None
    # Scalar-path event-emitter attrs (see _build_evaluator for full rationale).
    ctrl._event_counter = 0
    ctrl._event_timeline = []
    ctrl._operation_id_counter = 0
    ctrl._resource_lifecycle = []
    ctrl._bottleneck_history = []
    ctrl.testbed_info = {
        'unique_testbed_id': testbed_id,
        'label': meta.get('label'),
        'pc_ip': meta.get('pc_ip'),
        'ncm_ip': meta.get('ncm_ip'),
    }
    ctrl.monitoring_rules = [rule]
    ctrl.monitoring_rule_violations = []
    ctrl._rule_cooldowns = {}
    ctrl.execution_logs = []
    ctrl.events = []
    ctrl.start_time = _now_utc()

    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        loop.run_until_complete(ctrl._evaluate_monitoring_rules(0))
    except Exception as e:
        return {'success': False, 'error': f'Rule evaluation failed: {e}'}
    finally:
        try:
            loop.close()
        except Exception:
            pass

    violations = ctrl.monitoring_rule_violations
    return {
        'success': True,
        'fired': len(violations) > 0,
        'violation_count': len(violations),
        'violations': violations[:50],
    }


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


# ────────────────────────────────────────────────────────────────────────
# Phase 4.2 — Scheduled monitors
# ────────────────────────────────────────────────────────────────────────
# Lightweight in-process scheduler. Sessions persisted with
# ``schedule.status='pending'`` and a ``schedule.start_at`` ISO timestamp
# get materialised by ``run_scheduler_tick()`` once the start_at has passed.
# A single daemon thread (``start_scheduler_thread``) ticks every minute so
# we don't need an external cron / Celery dependency for a feature this small.
#
# Repeat values supported:
#   ``once`` — fire once and mark schedule.status='done'
#   ``daily`` / ``weekly`` — re-arm schedule.start_at by adding 24h / 7d after
#     materialising. Status stays 'pending' so the next tick picks it up.

_SCHEDULER_THREAD: Optional[threading.Thread] = None
_SCHEDULER_STOP = threading.Event()
SCHEDULER_TICK_S = 60


def _parse_iso(ts: Any) -> Optional[datetime]:
    if not ts:
        return None
    if isinstance(ts, datetime):
        return ts
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return None


def run_scheduler_tick() -> int:
    """Materialise every due scheduled monitor. Returns the count fired.

    Idempotent and safe to call from multiple processes — each materialisation
    flips schedule.status, so a concurrent tick on the same row will skip it.
    """
    fired = 0
    session = SessionLocal()
    try:
        candidates = session.query(MonitorSession).filter(
            MonitorSession.status == 'STARTING',
        ).all() + session.query(MonitorSession).filter(
            MonitorSession.status.is_(None),
        ).all()
        # Plus any row whose schedule is pending (loaded explicitly to avoid
        # JSON-path queries that vary by DB version).
        all_scheduled = session.query(MonitorSession).filter(
            MonitorSession.schedule.isnot(None),
        ).all()
        seen = set(c.monitor_id for c in candidates)
        for m in all_scheduled:
            if m.monitor_id in seen:
                continue
            sch = m.schedule or {}
            if sch.get('status') == 'pending':
                candidates.append(m)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        for m in candidates:
            sch = m.schedule or {}
            if sch.get('status') != 'pending':
                continue
            start_at = _parse_iso(sch.get('start_at'))
            if start_at and start_at.replace(tzinfo=None) > now:
                continue
            # Materialise — re-call start_monitor with the persisted config.
            rules = (m.rule_config or {}).get('monitoring_rules') or []
            if not rules:
                logger.warning(f"[scheduler] {m.monitor_id} has no rules — skipping")
                sch['status'] = 'failed'
                m.schedule = sch
                session.commit()
                continue
            try:
                result = start_monitor(
                    testbed_id=m.testbed_id,
                    monitoring_rules=rules,
                    name=f"{m.name} (scheduled)" if m.name else None,
                    description=m.description,
                    poll_interval_s=m.poll_interval_s,
                    duration_hours=m.duration_hours,
                    settings=m.settings,
                    slack_channel_override=m.slack_channel_override,
                )
                if result.get('success'):
                    fired += 1
                    repeat = (sch.get('repeat') or 'once').lower()
                    if repeat == 'daily':
                        next_start = (start_at or now) + timedelta(days=1)
                        sch['start_at'] = next_start.isoformat() + 'Z'
                        # leave status='pending' so it fires again
                    elif repeat == 'weekly':
                        next_start = (start_at or now) + timedelta(days=7)
                        sch['start_at'] = next_start.isoformat() + 'Z'
                    else:
                        sch['status'] = 'done'
                    sch['last_fired_at'] = now.isoformat() + 'Z'
                    sch['last_materialised_id'] = result['monitor'].get('monitor_id')
                    m.schedule = sch
                    session.commit()
                    logger.info(f"[scheduler] materialised {m.monitor_id} as {sch.get('last_materialised_id')}")
            except Exception as e:
                logger.exception(f"[scheduler] failed to materialise {m.monitor_id}: {e}")
                sch['status'] = 'failed'
                sch['last_error'] = str(e)[:200]
                m.schedule = sch
                session.commit()
    finally:
        session.close()
    return fired


def _scheduler_loop() -> None:
    while not _SCHEDULER_STOP.is_set():
        try:
            run_scheduler_tick()
        except Exception as e:
            logger.exception(f"[scheduler] tick failed: {e}")
        _SCHEDULER_STOP.wait(SCHEDULER_TICK_S)


def start_scheduler_thread() -> None:
    """Idempotent — safe to call multiple times. Spawns a single daemon
    thread that ticks ``run_scheduler_tick()`` every minute."""
    global _SCHEDULER_THREAD
    if _SCHEDULER_THREAD and _SCHEDULER_THREAD.is_alive():
        return
    _SCHEDULER_STOP.clear()
    _SCHEDULER_THREAD = threading.Thread(
        target=_scheduler_loop, name='monitor-only-scheduler', daemon=True,
    )
    _SCHEDULER_THREAD.start()
    logger.info("📅 Monitor-only scheduler started (ticks every %ss)", SCHEDULER_TICK_S)

