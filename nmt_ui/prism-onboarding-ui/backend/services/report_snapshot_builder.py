"""
Report Snapshot Builder (Layer-2)
=================================

Pure transformation from a freshly-computed report payload into a *bounded*,
view-ready snapshot that the read API can serve with a single SELECT.

Hard guarantees of this module
------------------------------
1. **No external I/O.** No Prometheus, no SQL, no SSH, no kubectl, no network.
   Every input is already in memory. This is what makes the builder safe to
   unit-test and safe to call from the poller without adding latency variance.
2. **Bounded output.** Time series are down-sampled, violation lists capped,
   and the heavy per-container / per-pod arrays inside ``cluster_health`` are
   limited so the stored payload stays roughly constant in size regardless of
   how long the monitor ran or how many pods it observed.
3. **Deterministic.** Same input → same output (modulo the ``generated_at``
   timestamp the caller stamps on persistence), so repeated builds don't
   thrash the row content.

The caller (poller hook / backfill / rebuild endpoint) is responsible for:
  * producing the input ``report`` (via ``monitor_only_report.build_report``),
  * persisting the returned :class:`SnapshotResult` via the repo.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Bump when the payload SHAPE changes (keys added/removed/renamed) so readers
# can detect a stale-shaped snapshot and fall back / trigger a rebuild.
GENERATOR_VERSION = 1

# ── Bounding budgets ────────────────────────────────────────────────────
# Tuned so a 7-day, 1000-pod monitor still serialises to a few hundred KB.
MAX_TIMESERIES_POINTS = 500     # per series (cluster_cpu, cluster_mem, …)
MAX_VIOLATIONS = 200            # newest-first
MAX_CORRELATION = 200
MAX_POD_HEALTH_ROWS = 3000      # safety net; real clusters are << this
MAX_CLUSTER_ARRAY_ROWS = 1000   # per heavy cluster_health array
MAX_ROLLUP_ROWS = 50            # top-N rollups for the fast UI

# ── data_quality vocabulary (single source of truth) ────────────────────
DQ_LIVE = 'live'
DQ_LIVE_WITH_GAPS = 'live_with_gaps'
DQ_PERSISTED_ONLY = 'persisted_only'
DQ_STALE = 'stale'
DQ_UNCONFIGURED = 'unconfigured'
DQ_ERROR = 'error'

# Snapshot older than this (at READ time) is surfaced as DQ_STALE by the read
# layer. Exposed here so the read layer and tests share one constant.
STALE_AFTER_SECONDS = 15 * 60

_BANNER_BY_QUALITY = {
    DQ_LIVE: None,  # healthy → no banner
    DQ_LIVE_WITH_GAPS: (
        'Some metrics were unavailable in the most recent window — showing '
        'best-effort data merged from the poller history.'
    ),
    DQ_PERSISTED_ONLY: (
        'Live Prometheus was unreachable when this report was generated — '
        'showing the metrics the poller saved during the run. Refresh the '
        "testbed's Prometheus URL if this persists."
    ),
    DQ_STALE: (
        'This report has not refreshed recently — the monitor poller may be '
        'down or the backend was restarted. Showing the last saved data.'
    ),
    DQ_UNCONFIGURED: (
        'This testbed has no Prometheus URL configured — only poller-captured '
        'rule data is available. Configure Prometheus in the testbed settings.'
    ),
    DQ_ERROR: (
        'The report could not be fully built. Showing whatever data was '
        'available; see operational.enhanced_report_error for details.'
    ),
}


MAX_OPS_ROWS = 5000             # operations_history rows kept in a snapshot


@dataclass
class SnapshotResult:
    """What the builder returns; the caller persists this verbatim."""
    payload: Dict[str, Any]
    data_quality: str
    banner_text: Optional[str]
    size_bytes: int
    poll_count_at_gen: int
    generator_version: int = GENERATOR_VERSION
    # Non-fatal notes for observability (not persisted by default).
    notes: List[str] = field(default_factory=list)


# ── helpers ─────────────────────────────────────────────────────────────

def _downsample(points: Any, max_points: int = MAX_TIMESERIES_POINTS) -> List[Any]:
    """Largest-Triangle-Three-Buckets-ish down-sampling for ``[[ts, v], …]``.

    Keeps the first and last point and picks the locally most-significant
    sample per bucket so spikes survive. Falls back to a simple stride when
    the rows aren't the expected ``[ts, value]`` shape. Tolerant of None.
    """
    if not isinstance(points, list) or len(points) <= max_points:
        return points if isinstance(points, list) else []
    n = len(points)

    # Determine whether rows look like [ts, value] with numeric value.
    def _val(p):
        try:
            return float(p[1])
        except (TypeError, ValueError, IndexError, KeyError):
            # KeyError: rows that are dicts (e.g. per-node snapshots
            # ``{'timestamp':…, 'per_node':[…]}``) — fall back to stride.
            return None

    numeric = _val(points[1]) is not None
    if not numeric:
        # Simple uniform stride that always includes the last element.
        step = n / max_points
        out = [points[int(i * step)] for i in range(max_points - 1)]
        out.append(points[-1])
        return out

    # LTTB: bucket the interior into max_points-2 buckets, pick the point
    # forming the largest triangle with the previous selected point and the
    # average of the next bucket. Keep endpoints.
    sampled = [points[0]]
    bucket_size = (n - 2) / (max_points - 2)
    a = 0  # index of previously selected point
    for i in range(max_points - 2):
        # next bucket boundaries
        nb_start = int((i + 1) * bucket_size) + 1
        nb_end = int((i + 2) * bucket_size) + 1
        nb_end = min(nb_end, n)
        # average point of next bucket
        avg_x = 0.0
        avg_y = 0.0
        cnt = 0
        for j in range(nb_start, nb_end):
            v = _val(points[j])
            if v is None:
                continue
            avg_x += j
            avg_y += v
            cnt += 1
        if cnt:
            avg_x /= cnt
            avg_y /= cnt
        # current bucket boundaries
        cb_start = int(i * bucket_size) + 1
        cb_end = int((i + 1) * bucket_size) + 1
        cb_end = min(cb_end, n)
        ax = a
        ay = _val(points[a]) or 0.0
        best_area = -1.0
        best_idx = cb_start
        for j in range(cb_start, cb_end):
            v = _val(points[j])
            if v is None:
                continue
            area = abs((ax - avg_x) * (v - ay) - (ax - j) * (avg_y - ay)) * 0.5
            if area > best_area:
                best_area = area
                best_idx = j
        sampled.append(points[best_idx])
        a = best_idx
    sampled.append(points[-1])
    return sampled


def _cap(rows: Any, limit: int) -> List[Any]:
    """Return at most ``limit`` rows from a list; tolerate non-lists."""
    if not isinstance(rows, list):
        return []
    if len(rows) <= limit:
        return rows
    return rows[:limit]


def _num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


# Lean projections for rollup rows — the raw cluster_health rows can be fat
# (embedded per-window history / series), so rollups keep ONLY the small set
# of fields the at-a-glance UI needs. This keeps rollups genuinely "top-N
# small" rather than a second fat copy of the heavy arrays.
def _slim(row: Dict[str, Any], fields) -> Dict[str, Any]:
    return {k: row.get(k) for k in fields if k in row}


def _build_rollups(cluster_health: Dict[str, Any]) -> Dict[str, Any]:
    """Top-N rollups for the fast UI (independent of the heavy raw arrays).

    These are small, pre-sorted, projected lists the React/HTML views can
    render without scanning the full per-container arrays.
    """
    ch = cluster_health if isinstance(cluster_health, dict) else {}

    throttling = [r for r in (ch.get('cpu_throttling') or []) if isinstance(r, dict)]
    throttling_sorted = sorted(
        throttling,
        key=lambda r: _num(r.get('throttle_pct') or r.get('throttling_pct') or r.get('value')),
        reverse=True,
    )

    restarts = [r for r in (ch.get('total_restarts') or []) if isinstance(r, dict)]
    restarts_sorted = sorted(
        restarts,
        key=lambda r: _num(r.get('total_restarts') or r.get('restarts')),
        reverse=True,
    )

    oom = [r for r in (ch.get('oom_killed') or []) if isinstance(r, dict)]
    terminated = [r for r in (ch.get('terminated_containers') or []) if isinstance(r, dict)]

    _throttle_fields = ('namespace', 'pod', 'container', 'throttle_pct',
                        'throttling_pct', 'value', 'cpu_basis', 'cpu_cores',
                        'throttle_top_container')
    _restart_fields = ('namespace', 'pod', 'container', 'total_restarts',
                       'restarts', 'last_restart_at')
    _oom_fields = ('namespace', 'pod', 'container', 'oom_kills', 'count',
                   'last_oom_at')
    _term_fields = ('namespace', 'pod', 'container', 'reason', 'exit_code',
                    'finished_at')

    return {
        'top_throttled': [_slim(r, _throttle_fields)
                          for r in _cap(throttling_sorted, MAX_ROLLUP_ROWS)],
        'top_restarted': [_slim(r, _restart_fields)
                          for r in _cap(restarts_sorted, MAX_ROLLUP_ROWS)],
        'oom_events': [_slim(r, _oom_fields)
                       for r in _cap(oom, MAX_ROLLUP_ROWS)],
        'terminated': [_slim(r, _term_fields)
                       for r in _cap(terminated, MAX_ROLLUP_ROWS)],
    }


# Redundant pod_health representations dropped from MONITOR snapshots.
# The engine emits the same ~N pods up to 4 ways: ``pods`` (flat),
# ``unified_pods`` (identical to pods), ``by_namespace`` (grouped) and the
# ``*_pods`` tier splits. Monitor consumers only read ``pods`` + ``summary``
# + ``thresholds`` (the HTML template falls back from ``unified_pods`` to
# ``pods``; ``by_namespace`` is a TS type that's never rendered). Dropping the
# redundant copies cuts pod_health ~4× with no view change.
_REDUNDANT_POD_HEALTH_KEYS = (
    'unified_pods', 'by_namespace', 'critical_pods', 'watch_pods',
    'healthy_pods',
)


def _slim_pod_health(pod_health: Any) -> Tuple[Dict[str, Any], List[str]]:
    """Drop redundant pod representations + cap the canonical ``pods`` list."""
    notes: List[str] = []
    if not isinstance(pod_health, dict):
        return {}, notes
    out = dict(pod_health)
    for key in _REDUNDANT_POD_HEALTH_KEYS:
        if isinstance(out.get(key), (list, dict)) and out.get(key):
            out.pop(key, None)
            notes.append(f'dropped redundant pod_health.{key}')
    pods = out.get('pods')
    if isinstance(pods, list) and len(pods) > MAX_POD_HEALTH_ROWS:
        notes.append(f'pod_health.pods capped {len(pods)}→{MAX_POD_HEALTH_ROWS}')
        out['pods'] = pods[:MAX_POD_HEALTH_ROWS]
    return out, notes


# Heavy arrays inside cluster_health that we cap to keep payload bounded.
_HEAVY_CLUSTER_ARRAYS = (
    'pod_cpu', 'pod_memory', 'container_cpu', 'container_memory',
    'cpu_throttling', 'total_restarts', 'window_restarts',
    'container_restarts', 'oom_killed', 'window_oom_events',
    'terminated_containers', 'unhealthy_pods', 'problem_pods',
    'pods_not_ready', 'restart_timestamps', 'node_conditions',
    'window_pod_cpu_max', 'window_pod_memory_max',
    'node_cpu', 'node_memory', 'node_disk', 'api_server_latency',
    'pvc_health',
)


def _bound_cluster_health(cluster_health: Any, *, label: str = 'cluster_health') -> Tuple[Dict[str, Any], List[str]]:
    """Cap the heavy arrays in a cluster_health-shaped dict.

    Keeps summaries/scalars intact, caps each heavy per-row array, and drops
    the nested ``pod_health`` block — that block is a full duplicate of the
    canonical top-level ``payload.pod_health`` (the engine mirrors it under
    cluster_health for persistence) and was the single biggest bloat source
    (2+ MB duplicated up to 3× per report). No consumer reads it by the path
    ``cluster_health.pod_health`` — they all read top-level ``pod_health``.
    """
    notes: List[str] = []
    if not isinstance(cluster_health, dict):
        return {}, notes
    out = dict(cluster_health)  # shallow copy; we only replace capped keys
    if 'pod_health' in out:
        out.pop('pod_health', None)
        notes.append(f'dropped duplicate {label}.pod_health')
    for key in _HEAVY_CLUSTER_ARRAYS:
        rows = out.get(key)
        if isinstance(rows, list) and len(rows) > MAX_CLUSTER_ARRAY_ROWS:
            notes.append(f'{label}.{key} capped {len(rows)}→{MAX_CLUSTER_ARRAY_ROWS}')
            out[key] = rows[:MAX_CLUSTER_ARRAY_ROWS]
    return out, notes


def _reduce_baseline_health(baseline_health: Any) -> Tuple[Dict[str, Any], List[str]]:
    """Keep only baseline scalars/summaries; drop heavy arrays + nested blocks.

    The raw baseline snapshot is never rendered (the UI shows ``baseline_delta``,
    computed upstream). We retain non-list scalar/summary fields so anything
    that ever wants "what did the cluster look like at start" still has the
    headline numbers, without persisting hundreds of fat per-row records.
    """
    notes: List[str] = []
    if not isinstance(baseline_health, dict) or not baseline_health:
        return {}, notes
    out: Dict[str, Any] = {}
    dropped = 0
    for k, v in baseline_health.items():
        if k == 'pod_health':
            dropped += 1
            continue
        if isinstance(v, list):
            dropped += 1
            continue  # heavy per-row array — drop
        out[k] = v
    if dropped:
        notes.append(f'baseline_health reduced (dropped {dropped} array/block fields)')
    return out, notes


def classify_data_quality(report: Dict[str, Any]) -> Tuple[str, Optional[str]]:
    """Map a report's operational signals onto a single data_quality value.

    This is the ONLY place the banner vocabulary is decided. React and Jinja
    both read the resulting ``data_quality`` / ``banner_text`` and never
    compute their own — that's what stops the two views from disagreeing.
    """
    op = (report.get('operational') or {}) if isinstance(report, dict) else {}
    enhanced_error = op.get('enhanced_report_error')
    skip_reason = op.get('live_prometheus_skip_reason')
    live_unavailable = bool(op.get('live_prometheus_unavailable'))

    if skip_reason == 'prometheus_url_not_configured':
        quality = DQ_UNCONFIGURED
    elif live_unavailable:
        quality = DQ_PERSISTED_ONLY
    else:
        # Live merge happened. If the enhanced build still errored or the
        # cluster_health collection wasn't a clean success, flag gaps.
        ch = report.get('cluster_health') or {}
        coll = (ch.get('collection_status') if isinstance(ch, dict) else None)
        if enhanced_error or (coll and coll != 'success'):
            quality = DQ_LIVE_WITH_GAPS
        else:
            quality = DQ_LIVE

    banner = _BANNER_BY_QUALITY.get(quality)
    return quality, banner


# ── public ──────────────────────────────────────────────────────────────

def _cap_pod_health_for_render(pod_health: Any) -> Tuple[Dict[str, Any], List[str]]:
    """Parity-preserving pod_health bounding for *capture-at-render* snapshots.

    Unlike ``_slim_pod_health`` (used for the monitor React payload, which
    consumes a different shape), the smart-execution enhanced template iterates
    ``pod_health.unified_pods or pod_health.pods`` (template line ~2204). We must
    therefore keep whichever list it renders, in the SAME order, so a re-render
    is byte-identical. We only cap row counts (safety net for huge clusters) and
    drop the *unused* alternate representations to save space.
    """
    notes: List[str] = []
    if not isinstance(pod_health, dict):
        return {}, notes
    out = dict(pod_health)

    primary = 'unified_pods' if isinstance(out.get('unified_pods'), list) and out.get('unified_pods') else 'pods'
    rows = out.get(primary)
    if isinstance(rows, list) and len(rows) > MAX_POD_HEALTH_ROWS:
        notes.append(f'pod_health.{primary} capped {len(rows)}→{MAX_POD_HEALTH_ROWS}')
        out[primary] = rows[:MAX_POD_HEALTH_ROWS]

    # Drop alternate representations the enhanced template never iterates, but
    # ONLY when the primary list it DOES iterate is present (so we never strip
    # the very rows that would be rendered).
    if primary == 'unified_pods':
        for key in ('pods', 'by_namespace', 'critical_pods', 'watch_pods', 'healthy_pods'):
            if isinstance(out.get(key), (list, dict)) and out.get(key):
                out.pop(key, None)
                notes.append(f'dropped unused pod_health.{key}')
    return out, notes


def classify_smart_quality(cluster_health: Any) -> Tuple[str, Optional[str]]:
    """data_quality for a smart-execution report, derived from the enhanced
    report's ``cluster_health`` collection outcome. Same vocabulary + banners
    as the monitor path so HTML/JSON/React stay consistent across both flows.
    """
    ch = cluster_health if isinstance(cluster_health, dict) else {}
    status = ch.get('collection_status')
    reason = ch.get('collection_reason')
    if status == 'success':
        quality = DQ_LIVE
    elif reason == 'prometheus_url_not_configured':
        quality = DQ_UNCONFIGURED
    elif reason or status:
        quality = DQ_PERSISTED_ONLY
    else:
        # No cluster_health at all (e.g. simulated run) — treat as live so we
        # don't show a scary "unavailable" banner for a report that simply has
        # no cluster metrics by design.
        quality = DQ_LIVE
    return quality, _BANNER_BY_QUALITY.get(quality)


def build_smart_snapshot(
    render_kwargs: Dict[str, Any],
    enhanced_data: Dict[str, Any],
    *,
    meta: Optional[Dict[str, Any]] = None,
    now: Optional[datetime] = None,
    poll_count: int = 0,
) -> SnapshotResult:
    """Bound + package a smart-execution enhanced report for storage.

    Captures the EXACT ``render_kwargs`` the template was rendered with (so a
    re-render is byte-identical) plus a slimmed ``enhanced_data`` for the
    ``?format=json`` export. The big duplicated blocks (cluster_health,
    pod_health) are kept once in render_kwargs and dropped from the stored
    enhanced_data; the JSON export reconstructs them at read time.
    """
    now = now or datetime.utcnow()
    notes: List[str] = []
    rk = dict(render_kwargs or {})

    # bound the heavy render kwargs
    if isinstance(rk.get('cluster_health'), dict):
        ch, n = _bound_cluster_health(rk.get('cluster_health'))
        rk['cluster_health'] = ch
        notes.extend(n)
    if isinstance(rk.get('pod_health'), dict):
        ph, n = _cap_pod_health_for_render(rk.get('pod_health'))
        rk['pod_health'] = ph
        notes.extend(n)
    ops = rk.get('operations_history')
    if isinstance(ops, list) and len(ops) > MAX_OPS_ROWS:
        notes.append(f'operations_history capped {len(ops)}→{MAX_OPS_ROWS}')
        rk['operations_history'] = ops[:MAX_OPS_ROWS]

    quality, banner = classify_smart_quality(rk.get('cluster_health'))
    # Stamp operational so the shared template's banner fallback (which prefers
    # operational.banner_text) renders consistently for snapshot-served HTML.
    rk['operational'] = {'data_quality': quality, 'banner_text': banner}

    # slim enhanced_data: the big blocks live in render_kwargs already
    ed = dict(enhanced_data or {})
    for k in ('cluster_health', 'pod_health'):
        if k in ed:
            ed.pop(k, None)
            notes.append(f'dropped duplicate enhanced_data.{k} (kept in render_kwargs)')

    payload = {
        'kind': 'smart_execution',
        'render_kwargs': rk,
        'enhanced_data_slim': ed,
        'meta': meta or {},
    }
    try:
        size_bytes = len(json.dumps(payload, default=str).encode('utf-8'))
    except (TypeError, ValueError) as e:
        size_bytes = len(json.dumps(payload, default=str, skipkeys=True).encode('utf-8'))
        notes.append(f'serialisation coerced: {e}')

    return SnapshotResult(
        payload=payload, data_quality=quality, banner_text=banner,
        size_bytes=size_bytes, poll_count_at_gen=poll_count, notes=notes,
    )


def build_snapshot(
    report: Dict[str, Any],
    *,
    now: Optional[datetime] = None,
    poll_count: int = 0,
) -> SnapshotResult:
    """Transform a full report payload into a bounded, view-ready snapshot.

    Parameters
    ----------
    report
        Output of ``monitor_only_report.build_report``. Not mutated.
    now
        Generation timestamp (caller stamps this on persistence too). Only
        used for the ``operational.snapshot_generated_at`` field.
    poll_count
        ``total_polls`` at generation time, for "from poll N" UI.
    """
    now = now or datetime.utcnow()
    notes: List[str] = []

    if not isinstance(report, dict):
        # Degenerate input — produce a minimal error snapshot rather than raise.
        payload = {
            'overview': {},
            'operational': {'data_quality': DQ_ERROR},
        }
        return SnapshotResult(
            payload=payload, data_quality=DQ_ERROR,
            banner_text=_BANNER_BY_QUALITY[DQ_ERROR], size_bytes=len(json.dumps(payload)),
            poll_count_at_gen=poll_count, notes=['report was not a dict'],
        )

    quality, banner = classify_data_quality(report)

    # ── bound the heavy bits ──────────────────────────────────────────
    bounded_cluster_health, ch_notes = _bound_cluster_health(report.get('cluster_health'))
    notes.extend(ch_notes)

    rollups = _build_rollups(report.get('cluster_health') or {})

    timeseries_in = report.get('timeseries') or {}
    timeseries_out = {}
    if isinstance(timeseries_in, dict):
        for k, series in timeseries_in.items():
            timeseries_out[k] = _downsample(series, MAX_TIMESERIES_POINTS)

    violations = _cap(report.get('violations') or [], MAX_VIOLATIONS)
    correlation = _cap(report.get('correlation') or [], MAX_CORRELATION)

    pod_health, ph_notes = _slim_pod_health(report.get('pod_health'))
    notes.extend(ph_notes)

    # baseline_health is a full cluster_health-shaped snapshot captured at
    # monitor start, used ONLY to compute baseline_delta (already done and
    # stored separately). No consumer renders the raw baseline, so we keep
    # just its scalar/summary fields and drop every heavy per-row array.
    bounded_baseline, bh_notes = _reduce_baseline_health(report.get('baseline_health'))
    notes.extend(bh_notes)

    # enhanced_data carries duplicate cluster_health + pod_health (same objects
    # the engine built). Drop both from the stored copy so we don't persist the
    # heavy arrays 2-3×; the canonical bounded copies live at
    # payload.cluster_health and payload.pod_health.
    enhanced_data = report.get('enhanced_data') or {}
    if isinstance(enhanced_data, dict):
        if 'cluster_health' in enhanced_data or 'pod_health' in enhanced_data:
            enhanced_data = dict(enhanced_data)
            if enhanced_data.pop('cluster_health', None) is not None:
                notes.append('dropped duplicate enhanced_data.cluster_health')
            if enhanced_data.pop('pod_health', None) is not None:
                notes.append('dropped duplicate enhanced_data.pod_health')

    # ── operational: stamp the single-source-of-truth quality fields ──
    operational = dict(report.get('operational') or {})
    operational['data_quality'] = quality
    operational['banner_text'] = banner
    operational['snapshot_generated_at'] = now.isoformat() + 'Z'
    operational['snapshot_poll_count'] = poll_count

    payload = {
        'overview': report.get('overview') or {},
        'verdict': report.get('verdict') or {},
        'rules': report.get('rules') or [],
        'rule_health': report.get('rule_health') or {},
        'violations': violations,
        'correlation': correlation,
        'timeseries': timeseries_out,
        'recommendations': report.get('recommendations') or [],
        'log_bundles': report.get('log_bundles') or [],
        'pod_health': pod_health,
        'cluster_health': bounded_cluster_health,
        'pod_restart_tracking': report.get('pod_restart_tracking') or {},
        'baseline_health': bounded_baseline,
        'baseline_delta': report.get('baseline_delta') or {},
        'rule_history': report.get('rule_history') or [],
        'rollups': rollups,
        'operational': operational,
        'config_dump': report.get('config_dump') or {},
        'enhanced_data': enhanced_data,
    }

    # ── measure size (also asserts JSON-serialisability) ──────────────
    try:
        serialised = json.dumps(payload, default=str)
        size_bytes = len(serialised.encode('utf-8'))
    except (TypeError, ValueError) as e:
        # Last-ditch: coerce everything to str so we never persist non-JSON.
        logger.warning('build_snapshot: payload not directly serialisable: %s', e)
        serialised = json.dumps(payload, default=str, skipkeys=True)
        size_bytes = len(serialised.encode('utf-8'))
        notes.append(f'serialisation coerced: {e}')

    return SnapshotResult(
        payload=payload,
        data_quality=quality,
        banner_text=banner,
        size_bytes=size_bytes,
        poll_count_at_gen=poll_count,
        notes=notes,
    )
