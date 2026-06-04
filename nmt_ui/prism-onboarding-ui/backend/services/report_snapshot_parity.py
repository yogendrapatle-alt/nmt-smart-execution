"""
Report Snapshot Parity Validator (Layer-2, Phase B)
===================================================

Proves that a *stored* snapshot (Layer-2) is equivalent to what we'd build
*live* right now — the confidence gate we need before Phase C flips reads to
serve the snapshot.

It does NOT do a naive deep-equal (that would be drowned in noise: timestamps,
down-sampled time series, capped lists, and the deliberately-dropped redundant
representations would all "differ"). Instead it compares a curated set of
**headline fields** — the things a human actually reads off the report — and
tags every difference with a severity that depends on the monitor's state:

  * For a **terminal** monitor (STOPPED / COMPLETED / FAILED) the underlying
    data is immutable, so any headline difference is a real ``mismatch``.
  * For a **running** monitor the live build has simply seen more polls since
    the snapshot was written, so count/timestamp drift is ``drift_expected``.

The result is a structured :class:`ParityReport` (also ``to_dict``-able for the
debug endpoint) with an overall verdict of:

    match | drift_expected | mismatch | no_snapshot | error
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Overall verdicts
P_MATCH = 'match'
P_DRIFT = 'drift_expected'
P_MISMATCH = 'mismatch'
P_NO_SNAPSHOT = 'no_snapshot'
P_ERROR = 'error'

# Diff severities
SEV_CRITICAL = 'critical'   # headline value differs on an immutable monitor
SEV_DRIFT = 'drift'         # expected because the live monitor moved on
SEV_INFO = 'info'           # cosmetic / size-only

_TERMINAL_STATES = {'STOPPED', 'COMPLETED', 'FAILED', 'CANCELLED'}


@dataclass
class Diff:
    path: str
    stored: Any
    live: Any
    severity: str
    note: str = ''

    def to_dict(self) -> Dict[str, Any]:
        return {
            'path': self.path,
            'stored': self.stored,
            'live': self.live,
            'severity': self.severity,
            'note': self.note,
        }


@dataclass
class ParityReport:
    monitor_id: str
    verdict: str
    monitor_status: str
    is_terminal: bool
    diffs: List[Diff] = field(default_factory=list)
    stored_generated_at: Optional[str] = None
    stored_size_bytes: int = 0
    note: str = ''

    @property
    def critical_count(self) -> int:
        return sum(1 for d in self.diffs if d.severity == SEV_CRITICAL)

    @property
    def drift_count(self) -> int:
        return sum(1 for d in self.diffs if d.severity == SEV_DRIFT)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'monitor_id': self.monitor_id,
            'verdict': self.verdict,
            'monitor_status': self.monitor_status,
            'is_terminal': self.is_terminal,
            'stored_generated_at': self.stored_generated_at,
            'stored_size_bytes': self.stored_size_bytes,
            'critical_count': self.critical_count,
            'drift_count': self.drift_count,
            'note': self.note,
            'diffs': [d.to_dict() for d in self.diffs],
        }


# ── headline extraction ─────────────────────────────────────────────────

def _get(d: Any, *path, default=None):
    cur = d
    for p in path:
        if isinstance(cur, dict):
            cur = cur.get(p)
        else:
            return default
    return cur if cur is not None else default


def _len(d: Any, *path) -> int:
    v = _get(d, *path)
    return len(v) if hasattr(v, '__len__') else 0


def extract_headline(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Pull the small set of values a reader actually compares between two
    renderings of the same report. Robust to missing keys."""
    if not isinstance(payload, dict):
        payload = {}
    ch = payload.get('cluster_health') or {}
    return {
        'verdict.level': _get(payload, 'verdict', 'level'),
        'verdict.label': _get(payload, 'verdict', 'label'),
        'overview.status': _get(payload, 'overview', 'status'),
        'overview.testbed_label': _get(payload, 'overview', 'testbed_label'),
        'pod_health.summary.total': _get(payload, 'pod_health', 'summary', 'total', default=0),
        'pod_health.summary.critical': _get(payload, 'pod_health', 'summary', 'critical', default=0),
        'pod_health.summary.watch': _get(payload, 'pod_health', 'summary', 'watch', default=0),
        'pod_health.summary.healthy': _get(payload, 'pod_health', 'summary', 'healthy', default=0),
        'cluster_health.collection_status': ch.get('collection_status') if isinstance(ch, dict) else None,
        # counts (these legitimately drift while a monitor runs)
        'count.rules': _len(payload, 'rules'),
        'count.violations': _len(payload, 'violations'),
        'count.pods': _len(payload, 'pod_health', 'pods'),
        'count.timeseries_series': _len(payload, 'timeseries'),
        'count.recommendations': _len(payload, 'recommendations'),
        'count.rule_history': _len(payload, 'rule_history'),
    }


# Fields that drift regardless of monitor state because the LIVE rebuild
# re-merges *current* cluster metrics (build_report still probes Prometheus
# even for a stopped monitor when the testbed is reachable). The stored
# snapshot froze these at generation time — which is the more correct
# historical view — so a difference here is expected, never a snapshot bug.
_ALWAYS_DRIFT = {
    'overview.status',                     # may flip RUNNING→STOPPED
    'cluster_health.collection_status',    # prometheus reachability at build time
    'pod_health.summary.total',            # = current cluster pod count
    'pod_health.summary.critical',         # tier = f(current live CPU/throttle)
    'pod_health.summary.watch',
    'pod_health.summary.healthy',
    'count.pods',                          # = len(current cluster pods)
}

# Counts that only grow while a monitor RUNS. Strict (critical) once terminal,
# because the underlying persisted data is then final.
_COUNT_DRIFT = {
    'count.violations', 'count.rules', 'count.recommendations',
    'count.rule_history', 'count.timeseries_series',
}


def compare_payloads(
    stored_payload: Dict[str, Any],
    live_payload: Dict[str, Any],
    *,
    monitor_id: str = '',
    monitor_status: str = '',
    stored_generated_at: Optional[str] = None,
    stored_size_bytes: int = 0,
) -> ParityReport:
    """Compare two report payloads' headline fields with state-aware severity."""
    status_u = (monitor_status or '').upper()
    is_terminal = status_u in _TERMINAL_STATES

    rpt = ParityReport(
        monitor_id=monitor_id,
        verdict=P_MATCH,
        monitor_status=status_u,
        is_terminal=is_terminal,
        stored_generated_at=stored_generated_at,
        stored_size_bytes=stored_size_bytes,
    )

    stored_h = extract_headline(stored_payload)
    live_h = extract_headline(live_payload)

    for key in stored_h:
        sv = stored_h.get(key)
        lv = live_h.get(key)
        if sv == lv:
            continue
        # classify severity
        if key in _ALWAYS_DRIFT:
            sev = SEV_DRIFT
            note = 'live rebuild re-merges current cluster metrics'
        elif key in _COUNT_DRIFT:
            if is_terminal:
                sev = SEV_CRITICAL
                note = 'count differs on a terminal (immutable) monitor'
            else:
                sev = SEV_DRIFT
                note = 'live monitor advanced since snapshot'
        else:
            # identity + verdict — strict regardless of state
            sev = SEV_CRITICAL
            note = 'headline value differs'
        rpt.diffs.append(Diff(path=key, stored=sv, live=lv, severity=sev, note=note))

    # overall verdict
    if rpt.critical_count:
        rpt.verdict = P_MISMATCH
        rpt.note = f'{rpt.critical_count} critical headline difference(s)'
    elif rpt.drift_count:
        rpt.verdict = P_DRIFT
        rpt.note = f'{rpt.drift_count} expected drift difference(s)'
    else:
        rpt.verdict = P_MATCH
        rpt.note = 'all headline fields match'
    return rpt


# ── orchestration: stored-vs-fresh ──────────────────────────────────────

def validate_monitor(monitor_id: str) -> ParityReport:
    """Build the report live, bound it the way the snapshot is bounded, and
    compare to the stored snapshot. Returns a ParityReport (never raises).

    This is the explicit "prove they match" entry point used by the debug
    endpoint and verification scripts.
    """
    from services import monitor_only_report as report_svc
    from services import report_snapshot_builder as builder
    from services import report_snapshot_repo as repo

    stored = None
    try:
        stored = repo.get_monitor_snapshot(monitor_id)
    except Exception as e:  # noqa: BLE001
        logger.warning('[%s] parity: stored snapshot read failed: %s', monitor_id, e)

    try:
        live_report = report_svc.build_report(monitor_id)
    except Exception as e:  # noqa: BLE001
        return ParityReport(
            monitor_id=monitor_id, verdict=P_ERROR, monitor_status='',
            is_terminal=False, note=f'live build_report failed: {e}',
        )
    if not live_report:
        return ParityReport(
            monitor_id=monitor_id, verdict=P_ERROR, monitor_status='',
            is_terminal=False, note='monitor not found',
        )

    status = (_get(live_report, 'overview', 'status') or '')

    if not stored:
        rpt = ParityReport(
            monitor_id=monitor_id, verdict=P_NO_SNAPSHOT,
            monitor_status=status.upper(), is_terminal=False,
            note='no stored snapshot — run rebuild-snapshot or wait for poller',
        )
        return rpt

    # bound the live report the same way the snapshot was produced, so we
    # compare like-for-like (post-bounding headline values are identical to
    # pre-bounding for the headline set, but this keeps the contract honest).
    try:
        fresh = builder.build_snapshot(live_report)
        fresh_payload = fresh.payload
    except Exception as e:  # noqa: BLE001
        return ParityReport(
            monitor_id=monitor_id, verdict=P_ERROR, monitor_status=status.upper(),
            is_terminal=False, note=f'build_snapshot failed: {e}',
        )

    return compare_payloads(
        stored.get('payload') or {},
        fresh_payload,
        monitor_id=monitor_id,
        monitor_status=status,
        stored_generated_at=stored.get('generated_at'),
        stored_size_bytes=stored.get('size_bytes') or 0,
    )
