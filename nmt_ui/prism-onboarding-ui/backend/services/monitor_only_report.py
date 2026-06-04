"""
Monitor-Only Report Builder
===========================

Aggregates everything needed to debug a Monitor-Only session into a single,
self-contained report payload that's safe to render in the UI *and* to drop
into a static HTML file the user can email.

Sections produced (each a top-level key in the JSON payload):

- ``overview``            — verdict, durations, totals, configuration snapshot
- ``rules``               — every rule + per-rule fire/poll counts + last value
- ``violations``          — full list (live + persisted), normalised
- ``timeseries``          — captured cluster CPU/Mem aggregates
- ``correlation``         — overlay of violations onto the timeseries
- ``recommendations``     — heuristic suggestions ("rule X never fired", …)
- ``pod_health``          — Phase-1 parity: per-pod table (Critical/Watch/Healthy)
                            from PodHealthClassifier (same shape as enhanced report)
- ``cluster_health``      — Phase-1 parity: pod_phase_summary, node_breakdown,
                            cpu_throttling, oom_killed, terminated_containers, etc.
- ``pod_restart_tracking``— Phase-1 parity: per-pod restart counts during window
- ``baseline_health``     — snapshot at monitor start (for before→now delta)
- ``baseline_delta``      — computed deltas: restarts +N, OOMs +N, etc.
- ``rule_history``        — Phase-4 audit trail of rule hot-swaps
- ``operational``         — degraded status, consecutive_failed_polls, last error

The HTML renderer in ``templates/monitor_only_report.html`` consumes the same
payload so the on-screen and downloadable views can never drift.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from services import monitor_only_service as svc

logger = logging.getLogger(__name__)


# ── Phase-1: Baseline → Now delta helpers ────────────────────────────

def _count_unique(rows: Any, key_fn) -> int:
    """Count unique entries in a list-of-dicts by key_fn. Tolerates None."""
    if not isinstance(rows, list):
        return 0
    seen = set()
    for r in rows:
        if not isinstance(r, dict):
            continue
        try:
            k = key_fn(r)
        except Exception:
            continue
        if k is not None:
            seen.add(k)
    return len(seen)


def _sum_field(rows: Any, field: str) -> float:
    """Sum a numeric field across a list-of-dicts. Tolerates None/strings."""
    if not isinstance(rows, list):
        return 0.0
    total = 0.0
    for r in rows:
        if not isinstance(r, dict):
            continue
        try:
            total += float(r.get(field) or 0)
        except (TypeError, ValueError):
            continue
    return total


def _compute_baseline_delta(baseline: Optional[Dict[str, Any]],
                            current: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute baseline → current deltas for the key cluster_health series.

    Returns ``{baseline: {...counts}, current: {...counts}, delta: {...counts}}``
    so the UI can render "Restarts: 12 → 38 (+26 during window)" rows without
    having to do the math client-side. All keys are non-negative integers.
    """
    def _measure(snap: Optional[Dict[str, Any]]) -> Dict[str, int]:
        if not isinstance(snap, dict):
            return {
                'pods_tracked': 0, 'unhealthy_pods': 0, 'pods_not_ready': 0,
                'total_restarts': 0, 'oom_events': 0, 'throttled_pods': 0,
                'terminated_containers': 0, 'problem_pods': 0,
                'node_conditions': 0,
            }
        return {
            'pods_tracked': _count_unique(
                snap.get('pod_cpu'),
                lambda r: (r.get('namespace'), r.get('pod')),
            ),
            'unhealthy_pods': len(snap.get('unhealthy_pods') or []),
            'pods_not_ready': len(snap.get('pods_not_ready') or []),
            # total_restarts is a list of {namespace, pod, container, restarts}
            # so we sum the restarts field; fall back to row count when shape
            # is unknown.
            'total_restarts': int(_sum_field(snap.get('total_restarts'), 'restarts')
                                  or len(snap.get('total_restarts') or [])),
            'oom_events': int(_sum_field(snap.get('window_oom_events'), 'oom_kills')
                              or len(snap.get('oom_killed') or [])),
            'throttled_pods': _count_unique(
                snap.get('cpu_throttling'),
                lambda r: (r.get('namespace'), r.get('pod')),
            ),
            'terminated_containers': len(snap.get('terminated_containers') or []),
            'problem_pods': len(snap.get('problem_pods') or []),
            'node_conditions': len(snap.get('node_conditions') or []),
        }

    b = _measure(baseline)
    c = _measure(current)
    delta = {k: max(0, c[k] - b[k]) for k in b}
    return {'baseline': b, 'current': c, 'delta': delta}


# ── Helpers ──────────────────────────────────────────────────────────

def _safe_iso(s: Any) -> Optional[str]:
    if s is None:
        return None
    if isinstance(s, str):
        return s
    try:
        return s.isoformat()
    except Exception:
        return str(s)


def _seconds_between(a: Optional[str], b: Optional[str]) -> Optional[float]:
    """Return ``b - a`` in seconds, parsing ISO strings if needed."""
    from datetime import datetime
    def _parse(x):
        if x is None:
            return None
        if isinstance(x, str):
            try:
                return datetime.fromisoformat(x.replace('Z', '+00:00')).replace(tzinfo=None)
            except ValueError:
                return None
        return x
    pa, pb = _parse(a), _parse(b)
    if pa is None or pb is None:
        return None
    return (pb - pa).total_seconds()


def _summarize_rule(rule: Dict[str, Any]) -> str:
    """Build a one-line human-readable rule summary."""
    if rule.get('conditions'):
        op = (rule.get('logical_operator') or rule.get('logicalOperator') or 'AND').upper()
        parts = []
        for c in rule['conditions']:
            scope = (c.get('scope') or 'pod').upper()
            target = (c.get('pod_names') or c.get('podNames')
                      or c.get('node_instance') or c.get('nodeInstance')
                      or c.get('namespace') or '*')
            if isinstance(target, (list, tuple)):
                target = ','.join(map(str, target))
            parts.append(f"{scope}:{target} {c.get('query')} {c.get('operator', '>')} {c.get('threshold')}")
        return f' {op} '.join(parts)
    target = (rule.get('podNames') or rule.get('pod_names') or rule.get('podName')
              or rule.get('nodeInstance') or rule.get('namespace') or '*')
    if isinstance(target, (list, tuple)):
        target = ','.join(map(str, target))
    scope = (rule.get('scope') or 'pod').upper()
    return f"{scope}:{target} {rule.get('query')} {rule.get('operator', '>')} {rule.get('threshold')}"


def _verdict(monitor: Dict[str, Any], violations: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute a colour-coded verdict for the report banner."""
    n = len(violations)
    crit = sum(1 for v in violations if (v.get('severity') or '').lower() == 'critical')
    mod = sum(1 for v in violations if (v.get('severity') or '').lower() == 'moderate')
    status = (monitor.get('status') or '').upper()

    if status == 'FAILED':
        return {'level': 'fail', 'label': 'FAILED', 'icon': '✗',
                'summary': f'Monitor crashed: {monitor.get("last_error") or "unknown error"}'}
    if crit > 0:
        return {'level': 'fail', 'label': 'CRITICAL', 'icon': '✗',
                'summary': f'{crit} Critical violation(s) — investigate immediately'}
    if mod > 0:
        return {'level': 'warn', 'label': 'WARN', 'icon': '⚠',
                'summary': f'{mod} Moderate violation(s) detected'}
    if n > 0:
        return {'level': 'warn', 'label': 'INFO', 'icon': 'ℹ',
                'summary': f'{n} Low-severity violation(s) only'}
    return {'level': 'pass', 'label': 'CLEAN', 'icon': '✓',
            'summary': 'No rule violations during this monitoring window'}


def _recommendations(monitor: Dict[str, Any], rule_health: Dict[str, Any],
                     violations: List[Dict[str, Any]],
                     timeseries: Dict[str, Any]) -> List[str]:
    """Heuristic notes to help debugging."""
    recs: List[str] = []

    if monitor.get('total_polls', 0) == 0:
        recs.append('Monitor never completed a poll — Prometheus may be unreachable or the testbed has no Prometheus URL configured.')

    silent_rules = [
        h.get('rule_name') for h in (rule_health or {}).values()
        if (h.get('polls') or 0) > 5 and (h.get('fired') or 0) == 0
    ]
    if silent_rules:
        recs.append(
            f'{len(silent_rules)} rule(s) never fired despite >5 polls: '
            + ', '.join(filter(None, silent_rules[:5]))
            + ('…' if len(silent_rules) > 5 else '')
            + '. Consider lowering thresholds, widening pod selection, or removing.'
        )

    over_eager = [
        h.get('rule_name') for h in (rule_health or {}).values()
        if (h.get('polls') or 0) > 0 and ((h.get('fired') or 0) / max(1, h['polls']) > 0.5)
    ]
    if over_eager:
        recs.append(
            f'{len(over_eager)} rule(s) fired on >50% of polls — likely too sensitive: '
            + ', '.join(filter(None, over_eager[:5]))
            + ('…' if len(over_eager) > 5 else '')
        )

    cpu = (timeseries or {}).get('cluster_cpu') or []
    if cpu and len(cpu) > 5:
        peak = max(p[1] for p in cpu)
        if peak > 90:
            recs.append(f'Cluster CPU peaked at {peak:.1f}% — consider adding a Node CPU rule below this.')

    mem = (timeseries or {}).get('cluster_mem') or []
    if mem and len(mem) > 5:
        peak = max(p[1] for p in mem)
        if peak > 90:
            recs.append(f'Cluster memory peaked at {peak:.1f}% — add a memory pressure alert.')

    cooldown_clipped = sum(
        1 for h in (rule_health or {}).values()
        if (h.get('fired') or 0) > 0 and (h.get('polls') or 0) // max(1, h.get('fired') or 1) < 2
    )
    if cooldown_clipped:
        recs.append(f'{cooldown_clipped} rule(s) hit the 60s cooldown — actual violation rate may be higher than reported.')

    if not recs:
        recs.append('No anomalies in monitor behaviour. All rules evaluated cleanly.')
    return recs


# ── Public ───────────────────────────────────────────────────────────

def build_report(monitor_id: str) -> Optional[Dict[str, Any]]:
    """Return the full report payload for a monitor session, or ``None`` if
    the monitor doesn't exist."""
    monitor = svc.get_monitor(monitor_id)
    if not monitor:
        return None

    # Pull a generous window of violations (UI sub-tabs filter further)
    violations = svc.get_violations(monitor_id, limit=2000) or []

    # Normalise each violation into a stable shape for the UI / template
    norm_violations: List[Dict[str, Any]] = []
    for v in violations:
        # Persisted rows nest the original violation in diagnostic_context
        diag = v.get('diagnostic_context') or {}
        rule_name = v.get('rule_name') or diag.get('rule_name')
        severity = (v.get('severity') or diag.get('severity') or 'Moderate')
        ts = v.get('timestamp') or v.get('created_at')
        is_composite = diag.get('is_composite') or v.get('is_composite') or False
        norm_violations.append({
            'source': v.get('source', 'persisted'),
            'rule_id': diag.get('rule_id'),
            'rule_name': rule_name,
            'severity': severity,
            'value': v.get('value') if v.get('value') is not None else diag.get('actual_value'),
            'threshold': v.get('threshold') if v.get('threshold') is not None else diag.get('threshold'),
            'operator': v.get('operator') or diag.get('operator'),
            'is_composite': is_composite,
            'logical_operator': v.get('logical_operator') or diag.get('logical_operator'),
            'conditions_evaluated': v.get('conditions_evaluated') or diag.get('conditions_evaluated'),
            'message': v.get('message'),
            'timestamp': _safe_iso(ts),
            'iteration': v.get('iteration') or diag.get('iteration'),
            'pod_name': diag.get('pod_name'),
            'namespace': diag.get('namespace'),
        })

    # Sort newest-first
    norm_violations.sort(key=lambda x: x.get('timestamp') or '', reverse=True)

    metric_samples = monitor.get('metric_samples') or {}
    rule_health = (metric_samples.get('rule_health') or {}) if isinstance(metric_samples, dict) else {}
    timeseries = {k: metric_samples.get(k, []) for k in ('cluster_cpu', 'cluster_max_cpu', 'cluster_mem', 'cluster_max_mem')} if isinstance(metric_samples, dict) else {}
    # Per-host CPU/Mem timeline that powers the report's "Physical Host Metrics"
    # charts. Carried alongside the cluster aggregates so the projection can
    # attach each poll's per-node snapshot by timestamp.
    if isinstance(metric_samples, dict):
        timeseries['per_node_series'] = metric_samples.get('per_node_series', []) or []

    rules_cfg = (monitor.get('rule_config') or {}).get('monitoring_rules', []) if isinstance(monitor.get('rule_config'), dict) else []
    rule_table: List[Dict[str, Any]] = []
    for r in rules_cfg:
        rid = r.get('id') or r.get('name') or ''
        h = rule_health.get(rid, {})
        rule_table.append({
            'id': rid,
            'name': r.get('name'),
            'severity': r.get('severity'),
            'enabled': r.get('enabled', True),
            'description': r.get('description'),
            'summary': _summarize_rule(r),
            'collect_logs': bool(r.get('collectLogs') or r.get('collect_logs')),
            'log_duration_hours': r.get('logDurationHours') or r.get('log_duration_hours'),
            'polls': h.get('polls', 0),
            'fired': h.get('fired', 0),
            'last_value': h.get('last_value'),
            'last_violation_ts': h.get('last_violation_ts'),
            'fire_rate': round((h.get('fired') or 0) / max(1, h.get('polls') or 1) * 100, 2),
        })
    rule_table.sort(key=lambda x: (-(x.get('fired') or 0), x.get('name') or ''))

    # Enrich overview with testbed display name + Prometheus URL so the
    # report can show "Testbed: 10.114.54.238-longivity  Prom: https://…"
    # at a glance, mirroring the smart-execution enhanced report header.
    #
    # 2026-06-04: this MUST use ``fast_path=True``. The slow path runs
    # ``resolve_working_prometheus_url`` with ``allow_kubectl=True`` which
    # SSHs to the PC IP — when the PC is slow or unreachable this hangs
    # 30s-4min and is the dominant contributor to the "Loading monitor
    # report…" timeout the user saw on MON-20260603-140448-25952735. The
    # fast-probe gate further down handles "is Prom actually reachable
    # right now" using a 1.5s socket probe + 30s cache, so we don't need
    # the resolver here at all.
    tb_meta: Dict[str, Any] = {}
    try:
        from services import monitor_only_service as _svc
        tb_meta = _svc._testbed_meta(monitor.get('testbed_id') or '', fast_path=True) or {}
    except Exception:
        tb_meta = {}

    overview = {
        'monitor_id': monitor_id,
        'name': monitor.get('name'),
        'description': monitor.get('description'),
        'testbed_id': monitor.get('testbed_id'),
        'testbed_label': tb_meta.get('label'),
        'pc_ip': tb_meta.get('pc_ip'),
        'prometheus_url': tb_meta.get('prometheus_url'),
        'status': monitor.get('status'),
        'started_at': monitor.get('started_at'),
        'stopped_at': monitor.get('stopped_at'),
        'last_poll_at': monitor.get('last_poll_at'),
        'duration_seconds': _seconds_between(monitor.get('started_at'),
                                             monitor.get('stopped_at') or monitor.get('last_poll_at')),
        'duration_hours_target': monitor.get('duration_hours'),
        # Kept for clients/tests that read either spelling.
        'duration_hours': monitor.get('duration_hours'),
        'poll_interval_s': monitor.get('poll_interval_s'),
        'total_polls': monitor.get('total_polls'),
        'total_violations': monitor.get('total_violations'),
        'is_running': monitor.get('is_running', False),
        'rule_count': len(rule_table),
        # Phase-3 (v5) — forward the enrichment counters that get_monitor()
        # computed so render_html_enhanced can drive the executive summary
        # strip without re-querying the DB.
        'alert_summary': monitor.get('alert_summary')
                         or {'critical': 0, 'warning': 0, 'info': 0, 'total': 0},
        'pod_health_summary': monitor.get('pod_health_summary')
                              or {'critical': 0, 'watch': 0, 'healthy': 0, 'total': 0},
    }

    verdict = _verdict(monitor, norm_violations)
    recommendations = _recommendations(monitor, rule_health, norm_violations, timeseries)

    # Correlation: violations sorted onto the timeseries axis
    correlation = []
    for v in norm_violations[:200]:
        if v.get('timestamp'):
            correlation.append({
                'ts': v['timestamp'], 'severity': v.get('severity'),
                'rule_name': v.get('rule_name'), 'value': v.get('value'),
            })

    # Phase-4: log bundles triggered for this monitor
    log_bundles: List[Dict[str, Any]] = []
    try:
        from services import log_collection_service as lc
        log_bundles = lc.list_bundles(monitor_id=monitor_id, limit=100) or []
    except Exception as e:
        logger.warning(f"build_report: failed to fetch log bundles: {e}")

    # Phase-1: enhanced-report parity. Build pod_health + cluster_health by
    # running the SAME EnhancedReportService that smart-execution uses, scoped
    # to this monitor's start→stop window. We feed the persisted
    # cluster_health_snapshot in as `report_data.cluster_health_snapshot` so
    # the bidirectional merge inside EnhancedReportService can union the
    # live and persisted per-pod arrays (mirrors smart-execution's path).
    pod_health: Dict[str, Any] = {}
    cluster_health: Dict[str, Any] = {}
    pod_restart_tracking: Dict[str, Any] = {}
    enhanced_error: Optional[str] = None
    # 2026-06-03: track whether we served from the persisted snapshot
    # because live Prometheus was unreachable. The frontend surfaces this
    # as a banner so the user knows the report is honest-but-stale rather
    # than silently missing.
    live_prometheus_unavailable = False
    live_prometheus_skip_reason: Optional[str] = None
    try:
        from services.enhanced_report_service import EnhancedReportService
        from services.prometheus_url import is_prometheus_reachable_fast
        # Reuse the meta already fetched above (fast_path=True, cached for
        # 30s by monitor_only_service) instead of refetching. Two
        # _testbed_meta calls per request means two DB roundtrips and,
        # historically, two opportunities to hit the slow kubectl path.
        meta = tb_meta if tb_meta else None
        prom_url = (meta or {}).get('prometheus_url') if meta else None

        # Fast-probe gate (2026-06-03) — protects the UI against the
        # 60-90s "Loading report…" hang when the testbed's stored
        # Prometheus URL has gone stale (NodePort moved, kubectl service
        # recreated, etc). Without this gate, EnhancedReportService runs
        # 30+ sequential Prometheus queries against an unreachable URL
        # and each one waits for its own connect-timeout. The persisted
        # cluster_health_snapshot already has everything the report needs
        # for stopped sessions, and for RUNNING monitors the poller's
        # most recent snapshot is at most ``poll_interval_s`` old
        # (typically 30s), which is fresher than a 60s slow rebuild
        # would produce anyway.
        persisted_ch = monitor.get('cluster_health_snapshot') or {}
        prom_reachable = is_prometheus_reachable_fast(prom_url) if prom_url else False
        skip_live = bool(prom_url) and not prom_reachable
        if skip_live:
            live_prometheus_unavailable = True
            live_prometheus_skip_reason = 'prometheus_url_unreachable'
            logger.info(
                f"[{monitor_id}] build_report: skipping live Prometheus merge "
                f"({prom_url} did not respond to /api/v1/query within fast-probe budget)"
            )
        elif not prom_url:
            live_prometheus_unavailable = True
            live_prometheus_skip_reason = 'prometheus_url_not_configured'

        # Suppress the live-merge by handing EnhancedReportService an
        # empty URL — it already knows how to degrade gracefully when
        # ``self.prometheus_url`` is falsy (returns the persisted
        # snapshot, marks cluster_health_source='persisted_snapshot').
        effective_prom = None if (skip_live or not prom_url) else prom_url
        ers = EnhancedReportService(prometheus_url=effective_prom)
        # Feed monitor metadata into the shape EnhancedReportService expects.
        # We don't have operations_history (monitor-only has no entity ops)
        # so spike_analysis / capacity will be empty — that's fine, those are
        # smart-execution concerns.
        report_data = {
            'cluster_health_snapshot': persisted_ch,
            'pod_restart_tracking': {},
            'start_time': monitor.get('started_at'),
            'end_time': monitor.get('stopped_at') or monitor.get('last_poll_at'),
        }
        status_data = dict(report_data)
        enh = ers.generate_enhanced_report(
            report_data=report_data,
            status_data=status_data,
            execution_id=monitor_id,
            testbed_id=monitor.get('testbed_id'),
        )
        pod_health = enh.get('pod_health') or {}
        cluster_health = enh.get('cluster_health') or {}
        pod_restart_tracking = enh.get('pod_restart_tracking') or {}
    except Exception as e:  # noqa: BLE001 — keep the rest of the report
        enhanced_error = str(e)[:500]
        logger.warning(f"build_report: enhanced parity block failed for {monitor_id}: {e}",
                       exc_info=True)
        enh = {}

    # ``pod_restart_tracking`` is normally derived from the engine's per-pod
    # rolling restart history. Monitor-only has no engine, so EnhancedReport
    # returns ``{}``. Fall back to the per-container ``total_restarts`` +
    # ``window_restarts`` arrays that cluster_health already carries so the
    # report still surfaces who restarted (and how many times) during this
    # window instead of showing an empty card.
    #
    # Field names per ``EnhancedReportService._collect_cluster_health``:
    #   total_restarts row : {namespace, pod, container, total_restarts, restart_history, last_restart_at}
    #   window_restarts row: {namespace, pod, container, restarts_in_window, first_restart_at, last_restart_at}
    #   container_restarts row: {namespace, pod, container, restart_count}
    if not pod_restart_tracking and isinstance(cluster_health, dict):
        def _safe_int(v: Any) -> int:
            try:
                return int(float(v))
            except (TypeError, ValueError):
                return 0

        agg: Dict[Any, Dict[str, Any]] = {}

        def _slot(row: Dict[str, Any]) -> Dict[str, Any]:
            key = (row.get('namespace') or '?', row.get('pod') or '?')
            return agg.setdefault(key, {
                'namespace': key[0], 'pod': key[1],
                'total_restarts': 0, 'window_restarts': 0,
                'containers': set(), 'last_restart_at': None,
                'first_restart_at': None,
            })

        for row in (cluster_health.get('total_restarts') or []):
            if not isinstance(row, dict):
                continue
            slot = _slot(row)
            slot['total_restarts'] += _safe_int(row.get('total_restarts') or row.get('restarts'))
            if row.get('container'):
                slot['containers'].add(row['container'])
            lra = row.get('last_restart_at')
            if lra and (not slot['last_restart_at'] or lra > slot['last_restart_at']):
                slot['last_restart_at'] = lra

        for row in (cluster_health.get('window_restarts') or []):
            if not isinstance(row, dict):
                continue
            slot = _slot(row)
            slot['window_restarts'] += _safe_int(
                row.get('restarts_in_window') or row.get('restarts')
            )
            if row.get('container'):
                slot['containers'].add(row['container'])
            fra = row.get('first_restart_at')
            if fra and (not slot['first_restart_at'] or fra < slot['first_restart_at']):
                slot['first_restart_at'] = fra
            lra = row.get('last_restart_at')
            if lra and (not slot['last_restart_at'] or lra > slot['last_restart_at']):
                slot['last_restart_at'] = lra

        # ``container_restarts`` carries an alternate per-container counter
        # (``restart_count``). Treat it as a window count when window_restarts
        # was empty, so a single source missing doesn't blank the card.
        for row in (cluster_health.get('container_restarts') or []):
            if not isinstance(row, dict):
                continue
            slot = _slot(row)
            n = _safe_int(row.get('restart_count'))
            if n and slot['window_restarts'] == 0:
                slot['window_restarts'] = max(slot['window_restarts'], n)
            if row.get('container'):
                slot['containers'].add(row['container'])

        pods_list = []
        for slot in agg.values():
            pods_list.append({
                'namespace': slot['namespace'],
                'pod': slot['pod'],
                'total_restarts': slot['total_restarts'],
                'window_restarts': slot['window_restarts'],
                'containers': sorted(slot['containers']),
                'first_restart_at': slot.get('first_restart_at'),
                'last_restart_at': slot.get('last_restart_at'),
            })
        pods_list.sort(key=lambda p: (-p['window_restarts'], -p['total_restarts']))
        pod_restart_tracking = {
            'source': 'derived_from_cluster_health',
            'total_pods': len(pods_list),
            'pods_with_restarts_in_window': sum(1 for p in pods_list if p['window_restarts']),
            'pods_with_lifetime_restarts': sum(1 for p in pods_list if p['total_restarts']),
            'total_restarts': sum(p['total_restarts'] for p in pods_list),
            'window_restarts': sum(p['window_restarts'] for p in pods_list),
            'pods': pods_list,
        }

    # Phase-1: before → now delta from the baseline snapshot captured at start
    baseline_health = monitor.get('baseline_health') or {}
    baseline_delta = _compute_baseline_delta(baseline_health, cluster_health)

    # Phase-1 operational signal block — feeds the Live page's DEGRADED badge
    operational = {
        'is_running': monitor.get('is_running', False),
        'status': monitor.get('status'),
        'consecutive_failed_polls': monitor.get('consecutive_failed_polls') or 0,
        'last_prometheus_error': monitor.get('last_prometheus_error'),
        'last_poll_at': monitor.get('last_poll_at'),
        'enhanced_report_error': enhanced_error,
        # 2026-06-03: surface fast-probe outcome so the UI can show a
        # "Live Prometheus unavailable — showing persisted snapshot"
        # banner instead of silently serving stale data.
        'live_prometheus_unavailable': live_prometheus_unavailable,
        'live_prometheus_skip_reason': live_prometheus_skip_reason,
    }

    return {
        'overview': overview,
        'verdict': verdict,
        'rules': rule_table,
        'violations': norm_violations,
        'timeseries': timeseries,
        'rule_health': rule_health,
        'correlation': correlation,
        'recommendations': recommendations,
        'log_bundles': log_bundles,
        # Phase-1 enhanced-report parity payload
        'pod_health': pod_health,
        'cluster_health': cluster_health,
        'pod_restart_tracking': pod_restart_tracking,
        'baseline_health': baseline_health,
        'baseline_delta': baseline_delta,
        # Phase-4: rule hot-swap audit trail
        'rule_history': monitor.get('rule_history') or [],
        # Phase-1: degraded-state signals
        'operational': operational,
        'config_dump': {
            'rule_config': monitor.get('rule_config'),
            'settings': monitor.get('settings'),
            'slack_channel_override': monitor.get('slack_channel_override'),
            'schedule': monitor.get('schedule'),
        },
        # Phase-3 (v5): full enhanced-report kwargs (health_assessment,
        # ml_report_insights, capacity_planning, spike_analysis,
        # node_stability, metrics_stats, …) so render_html can drive the
        # shared enhanced_report.html template without recomputing.
        'enhanced_data': enh,
    }


def render_html(report: Dict[str, Any]) -> str:
    """Render the monitor-only report as HTML.

    Phase 3 (v5): switched from the legacy inline template to the shared
    ``templates/enhanced_report.html`` so monitor-only reports look and
    feel exactly like Smart-Execution reports — same Pod Health table,
    same Cluster Health detail, same Health Assessment / ML Insights /
    Capacity Planning cards. Operation-specific blocks (Failure Root
    Cause, Operation Heatmap, Iteration Timeline, Operations Log, …)
    are gated off by ``mode='monitor_only'`` in the template; monitor-
    only blocks (Rule Health grid, Rule History audit) are gated on.

    Falls back to :func:`render_html_legacy` if the Jinja render raises —
    we'd rather return the simpler inline version than a 500.
    """
    try:
        return _render_html_enhanced(report)
    except Exception as e:  # noqa: BLE001 — defensive: never break /report.html
        logger.exception(
            "render_html: enhanced template render failed, falling back to "
            "legacy inline template: %s", e
        )
        return render_html_legacy(report)


def _render_html_enhanced(report: Dict[str, Any]) -> str:
    """Drive ``enhanced_report.html`` with monitor-only-shaped kwargs."""
    import os
    from jinja2 import Environment, BaseLoader

    # Same custom filters the smart-execution route registers. Kept inline
    # so this module stays self-contained and we don't pull in app.py.
    def _fmtts(value):
        if not value:
            return '—'
        try:
            if isinstance(value, str):
                from datetime import datetime as _dt
                # Accept the ISO formats the rest of the codebase emits.
                v = value.rstrip('Z')
                try:
                    dt = _dt.fromisoformat(v)
                except ValueError:
                    return value
            else:
                dt = value
            return dt.strftime('%Y-%m-%d %H:%M:%S')
        except Exception:
            return str(value)

    def _fmtduration(raw):
        if raw is None or raw == '':
            return '—'
        try:
            secs = float(raw)
        except (TypeError, ValueError):
            return '—'
        if secs < 0:
            return '—'
        if secs < 60:
            return f"{int(secs)}s"
        mins = int(secs // 60)
        if mins < 60:
            return f"{mins}m"
        hours = mins // 60
        mins = mins % 60
        if hours < 24:
            return f"{hours}h {mins}m"
        days = hours // 24
        hours = hours % 24
        return f"{days}d {hours}h"

    overview = report.get('overview') or {}
    enh = report.get('enhanced_data') or {}
    verdict = report.get('verdict') or {}
    rules = report.get('rules') or []
    violations = report.get('violations') or []
    rule_health = report.get('rule_health') or {}
    rule_history = report.get('rule_history') or []
    timeseries = report.get('timeseries') or {}
    operational = report.get('operational') or {}

    # ── Verdict adapter: monitor_only_report uses {level, label, icon}
    #    but the enhanced template uses {result, summary, issues, oom_kills}.
    template_verdict = {
        'result': {'pass': 'PASS', 'warn': 'WARN', 'fail': 'FAIL'}.get(
            (verdict.get('level') or 'pass').lower(), 'PASS'),
        'summary': verdict.get('summary') or verdict.get('label') or '',
        'issues': verdict.get('issues') or [],
        'oom_kills': (report.get('pod_restart_tracking') or {}).get('total_oom_kills', 0)
                     or len((report.get('cluster_health') or {}).get('oom_killed') or []),
    }

    # ── Rule health for the monitor-only-only template block.
    #    enrich each rule_health entry with the rule_name (template expects it).
    rules_by_id: Dict[str, Dict[str, Any]] = {}
    for r in rules:
        rid = r.get('id') or r.get('name') or ''
        if rid:
            rules_by_id[rid] = r
    enriched_rule_health: Dict[str, Dict[str, Any]] = {}
    for rid, h in (rule_health or {}).items():
        meta = rules_by_id.get(rid) or {}
        enriched_rule_health[rid] = {
            **h,
            'rule_name': meta.get('name') or rid,
            'severity': meta.get('severity'),
        }

    # ── ``monitoring_rule_violations`` shape the template expects.
    #    The enhanced template reads these specific keys per violation:
    #      v.rule_name, v.namespace, v.pod_name, v.query, v.operator,
    #      v.threshold, v.actual_value, v.severity, v.iteration, v.timestamp
    #    Coerce ``value`` → ``actual_value`` and synthesise a query string
    #    from composite condition rows when the persisted violation only
    #    has the parts.
    template_violations: List[Dict[str, Any]] = []
    for v in violations[:1000]:
        conds = v.get('conditions_evaluated') or []
        query_str = ''
        if v.get('is_composite') and conds:
            query_str = (' ' + (v.get('logical_operator') or 'AND') + ' ').join(
                (c.get('query') or '') for c in conds if isinstance(c, dict)
            )
        # Fall back to a single-condition query (best effort: monitor_only_report
        # currently doesn't persist the raw query string on simple rules, so
        # surface the message instead).
        if not query_str:
            query_str = (v.get('message') or '')[:160]

        # ``actual_value`` MUST be numeric (template uses ``'%.4f'|format``).
        actual_value = v.get('value')
        if actual_value is None and conds:
            for c in conds:
                if isinstance(c, dict) and c.get('value') is not None:
                    actual_value = c.get('value')
                    break
        try:
            actual_value = float(actual_value) if actual_value is not None else 0.0
        except (TypeError, ValueError):
            actual_value = 0.0

        template_violations.append({
            'rule_name': v.get('rule_name') or '—',
            'severity': (v.get('severity') or 'Moderate').title(),
            'timestamp': v.get('timestamp'),
            'actual_value': actual_value,
            'value': v.get('value'),  # kept for any downstream consumer
            'threshold': v.get('threshold') if v.get('threshold') is not None else '—',
            'operator': v.get('operator') or '',
            'query': query_str or '—',
            'is_composite': v.get('is_composite', False),
            'conditions_evaluated': conds,
            'logical_operator': v.get('logical_operator') or 'AND',
            'pod_name': v.get('pod_name') or 'All',
            'namespace': v.get('namespace') or 'All',
            'iteration': v.get('iteration') or '—',
            'message': v.get('message'),
        })

    # ── Duration in minutes for the verdict meta / Executive Summary card.
    duration_seconds = overview.get('duration_seconds') or 0
    try:
        duration_minutes = float(duration_seconds) / 60.0
    except (TypeError, ValueError):
        duration_minutes = 0.0

    # ── Monitor-summary block (new, used only by monitor_only template path).
    #    pod_health_summary preference:
    #      1) overview.pod_health_summary  (live counters from get_monitor)
    #      2) pod_health.summary            (Critical/Watch/Healthy from classifier)
    #      3) zeros
    pod_summary = (overview.get('pod_health_summary')
                   or (report.get('pod_health') or {}).get('summary')
                   or {'critical': 0, 'watch': 0, 'healthy': 0, 'total': 0})
    monitor_summary = {
        'rule_count': overview.get('rule_count') or len(rules),
        'total_polls': overview.get('total_polls') or 0,
        'total_violations': overview.get('total_violations') or 0,
        'poll_interval_s': overview.get('poll_interval_s'),
        'duration_hours': overview.get('duration_hours_target') or overview.get('duration_hours'),
        'alert_summary': overview.get('alert_summary')
                         or {'critical': 0, 'warning': 0, 'info': 0, 'total': 0},
        'pod_health_summary': pod_summary,
        'rule_health': enriched_rule_health,
        'rule_history': rule_history,
        'operational': operational,
    }

    template_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        'templates', 'enhanced_report.html',
    )
    with open(template_path, 'r', encoding='utf-8') as fh:
        template_src = fh.read()
    env = Environment(loader=BaseLoader(), autoescape=False)
    env.filters['fmtts'] = _fmtts
    env.filters['fmtduration'] = _fmtduration
    template = env.from_string(template_src)

    # Stubs for kwargs the template references but that don't apply to
    # monitor-only (each is gated by `_is_monitor` or by data so they
    # render as empty / skipped). Always provide them to avoid Jinja
    # ``UndefinedError`` from a stray ``{{ var }}`` reference outside of
    # a guard.
    return template.render(
        mode='monitor_only',
        monitor_summary=monitor_summary,
        # Single-source banner (data_quality / banner_text). Stamped by the
        # read path / snapshot builder; referenced by the Cluster Health
        # fallback card so HTML matches JSON + React exactly.
        operational=operational,
        # ── Identity / framing ─────────────────────────────────────────
        execution_id=overview.get('monitor_id') or '—',
        testbed_label=(overview.get('testbed_label')
                       or overview.get('testbed_id') or '—'),
        status=overview.get('status') or 'UNKNOWN',
        timestamp=overview.get('last_poll_at') or overview.get('started_at') or '',
        start_time=overview.get('started_at'),
        end_time=overview.get('stopped_at') or overview.get('last_poll_at'),
        duration_minutes=duration_minutes,
        # ── Operation counters (zeroed — gated by mode in template) ────
        total_operations=0,
        ops_per_minute=0,
        success_rate=100.0,
        target_config={},
        baseline_metrics={},
        final_metrics={},
        operations_history=[],
        operations_history_total=0,
        operations_history_truncated=0,
        operation_effectiveness=[],
        operation_heatmap={'buckets': [], 'entity_ops': [], 'data': {}, 'row_totals': {}},
        iteration_timeline={'total_iterations': 0},
        entity_operation_counts=[],
        failure_analysis={'total_failures': 0, 'unique_patterns': 0, 'groups': []},
        resource_lifecycle={'total_created': 0},
        threshold_reached=False,
        # ── Shared v5 sections (all driven from enh / report) ─────────
        verdict=template_verdict,
        spike_analysis=enh.get('spike_analysis') or {'total_spikes': 0, 'spikes': []},
        pod_stability=enh.get('pod_stability') or [],
        node_stability=enh.get('node_stability') or [],
        cluster_health=report.get('cluster_health') or {},
        historical_comparison=enh.get('historical_comparison') or {'available': False, 'count': 0, 'previous_executions': []},
        health_assessment=enh.get('health_assessment') or {},
        ml_report_insights=enh.get('ml_report_insights') or {},
        capacity_planning=enh.get('capacity_planning') or {'available': False},
        report_metadata=enh.get('report_metadata') or {},
        metrics_resolution_note=(enh.get('report_metadata') or {}).get('baseline_final_resolution', 'derived'),
        pod_restart_tracking=report.get('pod_restart_tracking') or {},
        testbed_topology={},
        data_quality=enh.get('data_quality') or {},
        metrics_stats=enh.get('metrics_stats') or {},
        event_timeline=enh.get('event_timeline') or [],
        monitoring_rule_violations=template_violations,
        # ── Chart JSON payloads ───────────────────────────────────────
        metrics_history_json=json.dumps(_metrics_history_for_template(timeseries)),
        operations_history_json=json.dumps([]),
        failure_timeline_json=json.dumps([]),
        pod_health=report.get('pod_health') or {},
        violations_by_rule=_violations_by_rule(template_violations),
    )


def _metrics_history_for_template(timeseries: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Project the monitor's ``metric_samples.cluster_cpu`` / ``cluster_mem``
    series onto the ``[{timestamp, cpu_percent, memory_percent}, …]`` shape
    the enhanced template's metrics-timeline chart consumes.

    We zip the CPU and Memory series by index — both are sampled on the
    same poll cadence so the indexes line up. The per-host snapshot captured
    on the same poll is attached as ``per_node`` (matched by timestamp) so the
    "Physical Host Metrics" charts have real per-node data.
    """
    cpu = timeseries.get('cluster_cpu') or []
    mem = timeseries.get('cluster_mem') or []
    # Index per-host snapshots by timestamp for O(1) attach.
    per_node_by_ts: Dict[Any, List[Dict[str, Any]]] = {}
    for entry in (timeseries.get('per_node_series') or []):
        if isinstance(entry, dict) and entry.get('timestamp') is not None:
            per_node_by_ts[entry['timestamp']] = entry.get('per_node') or []
    out: List[Dict[str, Any]] = []
    n = max(len(cpu), len(mem))
    for i in range(n):
        c = cpu[i] if i < len(cpu) else None
        m = mem[i] if i < len(mem) else None
        ts = (c[0] if isinstance(c, (list, tuple)) and len(c) > 0 else
              m[0] if isinstance(m, (list, tuple)) and len(m) > 0 else None)
        cv = c[1] if isinstance(c, (list, tuple)) and len(c) > 1 else None
        mv = m[1] if isinstance(m, (list, tuple)) and len(m) > 1 else None
        sample: Dict[str, Any] = {
            'timestamp': ts,
            'cpu_percent': cv,
            'memory_percent': mv,
        }
        if ts is not None and ts in per_node_by_ts:
            sample['per_node'] = per_node_by_ts[ts]
        out.append(sample)
    return out


def _violations_by_rule(violations: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Group violations by rule_name for the bottom "Summary by Rule" pills."""
    out: Dict[str, Dict[str, Any]] = {}
    for v in violations:
        name = v.get('rule_name') or '—'
        sev = (v.get('severity') or 'Moderate').title()
        slot = out.setdefault(name, {'count': 0, 'severity': sev})
        slot['count'] += 1
        # Promote severity: Critical > Moderate > Low
        order = {'Critical': 3, 'Moderate': 2, 'Low': 1}
        if order.get(sev, 0) > order.get(slot['severity'], 0):
            slot['severity'] = sev
    return out


def render_html_legacy(report: Dict[str, Any]) -> str:
    """Legacy inline-template renderer (kept as fallback for _render_html_enhanced).

    Same behaviour as the pre-v5 monitor-only report. Useful for testing
    that the template change didn't drop information and as a safety net
    when the shared enhanced template can't render the monitor payload."""
    # We deliberately keep the template inlined here rather than as a separate
    # Jinja file so the report module is fully self-contained and easy to
    # iterate on. Style mirrors templates/enhanced_report.html.
    safe_json = json.dumps(report, default=str)
    overview = report['overview']
    verdict = report['verdict']
    rules = report['rules']
    violations = report['violations']
    recommendations = report['recommendations']
    pod_health = report.get('pod_health') or {}
    cluster_health = report.get('cluster_health') or {}
    pod_restart_tracking = report.get('pod_restart_tracking') or {}
    baseline_delta = report.get('baseline_delta') or {}
    rule_history = report.get('rule_history') or []
    operational = report.get('operational') or {}

    def _html_escape(s):
        if s is None:
            return ''
        return (str(s).replace('&', '&amp;').replace('<', '&lt;')
                .replace('>', '&gt;').replace('"', '&quot;'))

    verdict_class = {'pass': 'verdict-pass', 'warn': 'verdict-warn', 'fail': 'verdict-fail'}.get(verdict['level'], 'verdict-pass')
    rec_html = ''.join(f'<li>{_html_escape(r)}</li>' for r in recommendations)

    # Pod Health: top 80 rows from the classifier (Critical first, then Watch).
    # Mirrors the enhanced report's "v5 unified Pod Health" table.
    pod_rows_html = ''
    pods_list = (pod_health or {}).get('pods') or []
    if pods_list:
        for p in pods_list[:80]:
            sev = (p.get('severity') or 'healthy').lower()
            sev_class = {'critical': 'badge-critical', 'watch': 'badge-warn',
                         'healthy': 'badge-pass'}.get(sev, 'badge-pass')
            cpu_max = p.get('cpu_pct_max_in_run')
            cpu_basis = p.get('cpu_basis') or 'limit'
            cpu_cores = p.get('cpu_cores')
            mem_max = p.get('memory_pct_max_in_run')
            restarts = p.get('restarts_in_run') or p.get('restarts') or 0
            ooms = p.get('oom_kills_in_run') or 0
            if isinstance(cpu_max, (int, float)):
                # Annotate when % is of CPU request (not limit) so a 250%
                # reading on a burstable pod is read correctly.
                suffix = ' (req)' if cpu_basis == 'request' else ''
                cpu_str = f'{cpu_max:.1f}%{suffix}'
            elif isinstance(cpu_cores, (int, float)):
                # No CPU limit AND no CPU request — show raw cores so the
                # report doesn't fabricate a 100% reading (eg.
                # ntnx-ncm-common/ncm-data-processor-1).
                cpu_str = f'{cpu_cores:.2f} c <span style="color:#64748b;font-size:10px">(no limit)</span>'
            else:
                cpu_str = '—'
            mem_str = f'{mem_max:.1f}%' if isinstance(mem_max, (int, float)) else '—'
            pod_rows_html += (
                f'<tr><td><span class="badge {sev_class}">{_html_escape(p.get("severity"))}</span></td>'
                f'<td>{_html_escape(p.get("namespace"))}</td>'
                f'<td><strong>{_html_escape(p.get("pod"))}</strong></td>'
                f'<td>{_html_escape(p.get("node"))}</td>'
                f'<td>{_html_escape(p.get("phase"))}</td>'
                f'<td>{cpu_str}</td><td>{mem_str}</td>'
                f'<td>{int(restarts)}</td><td>{int(ooms)}</td>'
                f'<td><code>{_html_escape(", ".join(p.get("reasons") or [])[:160])}</code></td></tr>'
            )

    # Cluster Health quick stats
    summary = (pod_health or {}).get('summary') or {}
    cluster_summary = (cluster_health or {}).get('cluster_summary') or {}
    delta = baseline_delta.get('delta') or {}
    baseline = baseline_delta.get('baseline') or {}
    current = baseline_delta.get('current') or {}

    # Baseline → Now delta rows (only render when we actually have a baseline)
    delta_rows_html = ''
    if baseline_delta.get('baseline'):
        for key, label in [
            ('pods_tracked', 'Pods tracked'),
            ('total_restarts', 'Container restarts'),
            ('oom_events', 'OOM kills'),
            ('unhealthy_pods', 'Unhealthy pods'),
            ('pods_not_ready', 'Pods not ready'),
            ('throttled_pods', 'CPU-throttled pods'),
            ('terminated_containers', 'Terminated containers'),
            ('problem_pods', 'Problem pods'),
            ('node_conditions', 'Node condition flags'),
        ]:
            d = delta.get(key, 0)
            b_val = baseline.get(key, 0)
            c_val = current.get(key, 0)
            delta_class = 'badge-fail' if d > 0 else 'badge-pass'
            delta_str = f'+{d}' if d > 0 else '0'
            delta_rows_html += (
                f'<tr><td>{label}</td><td>{b_val}</td><td>{c_val}</td>'
                f'<td><span class="badge {delta_class}">{delta_str}</span></td></tr>'
            )

    # Rule hot-swap audit history (Phase 4)
    history_rows_html = ''
    for h in rule_history[-20:]:
        history_rows_html += (
            f'<tr><td>{_html_escape(h.get("ts"))}</td>'
            f'<td>{_html_escape(h.get("source"))}</td>'
            f'<td>{h.get("total_rules") or 0}</td>'
            f'<td>+{h.get("replaced_count") or 0}</td>'
            f'<td>-{h.get("removed_count") or 0}</td></tr>'
        )

    # Operational banner — only show if degraded
    operational_banner = ''
    if (operational.get('consecutive_failed_polls') or 0) > 0 or operational.get('status') == 'DEGRADED':
        operational_banner = (
            f'<div style="background:#fef3c7; border-left:6px solid #f59e0b; '
            f'padding:14px 20px; margin-bottom:16px; border-radius:8px;">'
            f'<strong>⚠ Degraded:</strong> '
            f'{operational.get("consecutive_failed_polls") or 0} consecutive Prometheus failures. '
            f'<code>{_html_escape((operational.get("last_prometheus_error") or "")[:200])}</code>'
            f'</div>'
        )

    rules_rows = ''
    for r in rules:
        fire_class = 'badge-fail' if (r.get('fired') or 0) > 5 else ('badge-warn' if (r.get('fired') or 0) > 0 else 'badge-pass')
        rules_rows += (
            f'<tr><td>{_html_escape(r.get("name"))}</td>'
            f'<td><span class="badge badge-{(r.get("severity") or "moderate").lower()}">{_html_escape(r.get("severity"))}</span></td>'
            f'<td><code>{_html_escape(r.get("summary"))}</code></td>'
            f'<td>{r.get("polls") or 0}</td>'
            f'<td><span class="badge {fire_class}">{r.get("fired") or 0}</span></td>'
            f'<td>{r.get("fire_rate") or 0}%</td>'
            f'<td>{_html_escape(r.get("last_value"))}</td>'
            f'<td>{_html_escape(r.get("last_violation_ts"))}</td>'
            '</tr>'
        )

    viol_rows = ''
    for v in violations[:500]:
        sev = (v.get('severity') or 'moderate').lower()
        comp = '🔗 composite' if v.get('is_composite') else 'simple'
        viol_rows += (
            f'<tr><td>{_html_escape(v.get("timestamp"))}</td>'
            f'<td>{_html_escape(v.get("rule_name"))}</td>'
            f'<td><span class="badge badge-{sev}">{_html_escape(v.get("severity"))}</span></td>'
            f'<td>{comp}</td>'
            f'<td>{_html_escape(v.get("value"))}</td>'
            f'<td>{_html_escape(v.get("operator"))} {_html_escape(v.get("threshold"))}</td>'
            f'<td><code>{_html_escape((v.get("message") or "")[:160])}</code></td>'
            '</tr>'
        )

    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Monitor-Only Report — {_html_escape(overview.get('monitor_id'))}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  :root {{ --pass:#22c55e; --warn:#f59e0b; --fail:#ef4444; --dark:#1e293b; --muted:#64748b; --light:#f8fafc; --border:#e2e8f0; }}
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  body {{ font-family:'Segoe UI',-apple-system,system-ui,sans-serif; background:var(--light); color:var(--dark); line-height:1.6; }}
  .container {{ max-width:1280px; margin:0 auto; padding:24px; }}
  .verdict-banner {{ padding:28px 32px; border-radius:12px; margin-bottom:28px; display:flex; align-items:center; gap:20px; }}
  .verdict-pass {{ background:linear-gradient(135deg,#dcfce7,#bbf7d0); border-left:6px solid var(--pass); }}
  .verdict-warn {{ background:linear-gradient(135deg,#fef3c7,#fde68a); border-left:6px solid var(--warn); }}
  .verdict-fail {{ background:linear-gradient(135deg,#fee2e2,#fecaca); border-left:6px solid var(--fail); }}
  .verdict-icon {{ font-size:48px; }}
  .verdict-label {{ font-size:28px; font-weight:800; letter-spacing:1px; }}
  .verdict-summary {{ color:var(--muted); margin-top:4px; }}
  .card {{ background:white; border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,.08); border:1px solid var(--border); margin-bottom:24px; overflow:hidden; }}
  .card-header {{ padding:20px 24px; border-bottom:1px solid var(--border); }}
  .card-header h2 {{ font-size:18px; font-weight:700; }}
  .card-body {{ padding:24px; }}
  .stat-grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:16px; }}
  .stat-card {{ background:white; border:1px solid var(--border); border-radius:10px; padding:16px; text-align:center; }}
  .stat-value {{ font-size:28px; font-weight:800; }}
  .stat-label {{ color:var(--muted); font-size:12px; font-weight:600; text-transform:uppercase; margin-top:4px; }}
  table {{ width:100%; border-collapse:collapse; }}
  th {{ background:#f1f5f9; color:var(--muted); font-size:12px; font-weight:700; text-transform:uppercase; padding:10px 14px; text-align:left; }}
  td {{ padding:8px 14px; border-bottom:1px solid var(--border); font-size:13px; }}
  tr:hover {{ background:#f8fafc; }}
  .badge {{ display:inline-block; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; }}
  .badge-pass,.badge-low {{ background:#dcfce7; color:#166534; }}
  .badge-warn,.badge-moderate {{ background:#fef3c7; color:#92400e; }}
  .badge-fail,.badge-critical {{ background:#fee2e2; color:#991b1b; }}
  .chart-container {{ position:relative; width:100%; height:340px; margin:16px 0; }}
  pre {{ background:#1e293b; color:#e2e8f0; border-radius:8px; padding:12px 16px; font-family:'SF Mono',monospace; font-size:12px; overflow:auto; }}
  ul.recs {{ list-style:none; padding:0; }}
  ul.recs li {{ padding:8px 12px; background:#fffbeb; border-left:4px solid var(--warn); margin-bottom:6px; border-radius:4px; }}
  @media print {{ body {{ background:white; }} .card {{ break-inside:avoid; }} }}
</style></head>
<body><div class="container">

<div class="verdict-banner {verdict_class}">
  <div class="verdict-icon">{verdict['icon']}</div>
  <div>
    <div class="verdict-label">{verdict['label']}</div>
    <div class="verdict-summary">{_html_escape(verdict['summary'])}</div>
  </div>
</div>

{operational_banner}

<div class="card"><div class="card-header"><h2>Overview</h2></div><div class="card-body">
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-value">{overview.get('total_polls') or 0}</div><div class="stat-label">Total polls</div></div>
    <div class="stat-card"><div class="stat-value">{overview.get('total_violations') or 0}</div><div class="stat-label">Violations recorded</div></div>
    <div class="stat-card"><div class="stat-value">{overview.get('rule_count')}</div><div class="stat-label">Rules configured</div></div>
    <div class="stat-card"><div class="stat-value">{overview.get('poll_interval_s')}s</div><div class="stat-label">Poll interval</div></div>
    <div class="stat-card"><div class="stat-value">{(overview.get('duration_seconds') or 0) / 60:.1f}m</div><div class="stat-label">Wall-clock</div></div>
    <div class="stat-card"><div class="stat-value">{_html_escape(overview.get('status'))}</div><div class="stat-label">Status</div></div>
    <div class="stat-card"><div class="stat-value">{summary.get('critical', 0)}</div><div class="stat-label">Critical pods</div></div>
    <div class="stat-card"><div class="stat-value">{summary.get('watch', 0)}</div><div class="stat-label">Watch pods</div></div>
    <div class="stat-card"><div class="stat-value">{summary.get('healthy', 0)}</div><div class="stat-label">Healthy pods</div></div>
  </div>
  <p style="margin-top:16px; color:var(--muted); font-size:13px;">
    <b>Monitor ID:</b> {_html_escape(overview.get('monitor_id'))} &nbsp;|&nbsp;
    <b>Testbed:</b> {_html_escape(overview.get('testbed_id'))} &nbsp;|&nbsp;
    <b>Started:</b> {_html_escape(overview.get('started_at'))} &nbsp;|&nbsp;
    <b>Last poll:</b> {_html_escape(overview.get('last_poll_at'))}
  </p>
</div></div>

{('<div class="card"><div class="card-header"><h2>Baseline → Now (during this monitor window)</h2></div>'
  '<div class="card-body" style="padding:0; overflow-x:auto;">'
  '<table><thead><tr><th>Metric</th><th>At start</th><th>Now</th><th>Delta</th></tr></thead>'
  f'<tbody>{delta_rows_html}</tbody></table></div></div>'
  if delta_rows_html else '')}

{('<div class="card"><div class="card-header"><h2>Pod Health (' + str(len(pods_list)) + ' pods)</h2></div>'
  '<div class="card-body" style="padding:0; overflow-x:auto;">'
  '<table><thead><tr><th>Severity</th><th>Namespace</th><th>Pod</th><th>Node</th>'
  '<th>Phase</th><th>CPU max %</th><th>Mem max %</th><th>Restarts</th>'
  '<th>OOM</th><th>Reasons</th></tr></thead>'
  f'<tbody>{pod_rows_html}</tbody></table>'
  '<p style="padding:10px 16px; color:#64748b; font-size:11px;">'
  + (f'Showing top 80 of {len(pods_list)} pods sorted by severity.' if len(pods_list) > 80 else 'Showing all classified pods.')
  + '</p></div></div>'
  if pods_list else '')}

<div class="card"><div class="card-header"><h2>Cluster Resource Trend</h2></div><div class="card-body">
  <div class="chart-container"><canvas id="trendChart"></canvas></div>
  <p style="color:var(--muted); font-size:12px;">Cluster CPU + Memory aggregates captured each poll. Shaded markers indicate violation timestamps overlaid on the timeline.</p>
</div></div>

<div class="card"><div class="card-header"><h2>Rule Health ({len(rules)} rules)</h2></div><div class="card-body" style="padding:0; overflow-x:auto;">
  <table><thead><tr>
    <th>Rule</th><th>Severity</th><th>Definition</th><th>Polls</th><th>Fired</th><th>Fire %</th><th>Last value</th><th>Last violation</th>
  </tr></thead><tbody>{rules_rows or '<tr><td colspan=8>No rules configured.</td></tr>'}</tbody></table>
</div></div>

<div class="card"><div class="card-header"><h2>Violations ({len(violations)})</h2></div><div class="card-body" style="padding:0; overflow-x:auto;">
  <table><thead><tr>
    <th>Timestamp</th><th>Rule</th><th>Severity</th><th>Type</th><th>Value</th><th>Threshold</th><th>Message</th>
  </tr></thead><tbody>{viol_rows or '<tr><td colspan=7>No violations recorded.</td></tr>'}</tbody></table>
</div></div>

<div class="card"><div class="card-header"><h2>Recommendations</h2></div><div class="card-body">
  <ul class="recs">{rec_html}</ul>
</div></div>

{('<div class="card"><div class="card-header"><h2>Rule History (' + str(len(rule_history)) + ' events)</h2></div>'
  '<div class="card-body" style="padding:0; overflow-x:auto;">'
  '<table><thead><tr><th>Time</th><th>Source</th><th>Total rules</th><th>Added</th><th>Removed</th></tr></thead>'
  f'<tbody>{history_rows_html}</tbody></table></div></div>'
  if history_rows_html else '')}

<div class="card"><div class="card-header"><h2>Raw Configuration</h2></div><div class="card-body">
  <pre>{_html_escape(json.dumps(report['config_dump'], indent=2, default=str))}</pre>
</div></div>

<script>
  const REPORT = {safe_json};
  (function () {{
    const ts = REPORT.timeseries || {{}};
    const cpu = ts.cluster_cpu || [];
    const mem = ts.cluster_mem || [];
    if (!cpu.length && !mem.length) {{
      const c = document.getElementById('trendChart');
      if (c) c.parentElement.innerHTML = '<div style="color:#64748b; padding:24px; text-align:center;">No timeseries data captured (Prometheus may have been unreachable).</div>';
      return;
    }}
    const labels = (cpu.length ? cpu : mem).map(p => p[0]);
    new Chart(document.getElementById('trendChart').getContext('2d'), {{
      type: 'line',
      data: {{
        labels,
        datasets: [
          {{ label: 'Cluster Avg CPU %', data: cpu.map(p => p[1]), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.3 }},
          {{ label: 'Cluster Avg Mem %', data: mem.map(p => p[1]), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', tension: 0.3 }},
        ],
      }},
      options: {{
        responsive: true, maintainAspectRatio: false,
        scales: {{ y: {{ min: 0, max: 100, title: {{ display: true, text: 'Percent' }} }} }},
        plugins: {{ legend: {{ position: 'top' }} }}
      }}
    }});
  }})();
</script>

</div></body></html>"""
