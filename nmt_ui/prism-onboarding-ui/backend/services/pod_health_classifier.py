"""Pod-health classifier — single source of truth for pod severity.

Phase 2 of the pod-coverage initiative. Consumes the ``cluster_health`` dict
produced by ``enhanced_report_service._collect_cluster_health()`` (after the
Phase-1 changes) and returns a normalised severity classification per pod.

Why one classifier?
-------------------
The same severity logic is needed in three places that historically each had
their own ad-hoc rules:

  1. **Enhanced Report** — colours pods red/amber/green and decides which tier
     a pod renders in (Critical / Watch / Healthy).
  2. **Slack notifier** (Phase 5) — first-fire-then-silent gating + escalation
     detection requires knowing whether severity went up since last alert.
  3. **Alerts page** — colour bars, severity filters, summary KPIs.

Three implementations means three sets of subtly different thresholds — easy
to drift apart, hard to test. This module is the canonical implementation;
all three call sites consume the same ``PodHealth`` payload.

Thresholds
----------
Per the product spec ("nothing should cross 80%"):

  * **CPU/Mem usage % of limit**
    - critical when ≥ 80 (the SLA breach line)
    - watch    when 60 ≤ x < 80 (early warning)
    - healthy  when      x < 60
  * **CPU throttling %** (kernel CFS scheduler)
    - critical when ≥ 50
    - watch    when 25 ≤ x < 50
    - healthy  when      x < 25
  * **Restarts during execution window** ≥ 1 → critical
  * **OOMKilled during execution window**       → critical
  * **Pod phase**: ``CrashLoopBackOff`` / ``ImagePullBackOff`` / ``Failed`` /
    ``ErrImagePull`` / ``CreateContainerConfigError`` → critical;
    ``Pending`` → watch.
  * **Readiness probe failing**                       → watch.

A pod's overall severity is ``max(severity)`` across every triggered signal.
A pod with **zero** triggered signals is ``healthy``.

All thresholds are configurable via environment variables (see
``ClassifierThresholds.from_env``) so testbed-specific overrides don't
require a code change.
"""

from __future__ import annotations

import logging
import os
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
#  Severity ordinal — higher = worse, so ``max(severities)`` works naturally
# ---------------------------------------------------------------------------

class Severity(str, Enum):
    """Severity tiers used everywhere — values match the strings the UI uses
    in CSS class names (`badge-critical`, `badge-watch`, `badge-healthy`).

    NOTE: this inherits from ``str`` so ``json.dumps`` serialises it as the
    bare value ('critical' etc.). Side effect: ``str.__lt__`` would order
    by ALPHABET (critical < healthy < watch), which is wrong. We therefore
    intentionally do NOT use built-in ``max()``/``min()`` on Severity values
    — always compare via ``.rank`` or call ``Severity.worst()``.
    """

    HEALTHY = 'healthy'
    WATCH = 'watch'
    CRITICAL = 'critical'

    @property
    def rank(self) -> int:
        # Explicit rank so the JSON value stays a stable string and we
        # don't accidentally couple the ordering to enum declaration order.
        return _SEVERITY_RANK[self]

    @classmethod
    def worst(cls, severities: List['Severity']) -> 'Severity':
        """Return the highest-rank severity in the list (or HEALTHY if empty).

        Implemented via explicit ``.rank`` comparison rather than ``max()`` so
        the str-based ``__lt__`` from the superclass can't sneak in and pick
        WATCH over CRITICAL because 'critical' < 'watch' alphabetically.
        """
        if not severities:
            return cls.HEALTHY
        out = severities[0]
        for s in severities[1:]:
            if s.rank > out.rank:
                out = s
        return out


_SEVERITY_RANK = {
    Severity.HEALTHY: 0,
    Severity.WATCH: 1,
    Severity.CRITICAL: 2,
}


# ---------------------------------------------------------------------------
#  Thresholds (env-overridable)
# ---------------------------------------------------------------------------

def _envf(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class ClassifierThresholds:
    """All severity cut-offs in one place. Override per-deployment via env:

      POD_HEALTH_CRIT_PCT          (default 80)   CPU/Mem critical line
      POD_HEALTH_WATCH_PCT         (default 60)   CPU/Mem watch line
      POD_HEALTH_CRIT_THROTTLE_PCT (default 50)   CPU throttling critical line
      POD_HEALTH_WATCH_THROTTLE_PCT(default 25)   CPU throttling watch line
    """

    # CPU / memory usage % of limit
    crit_pct: float = 80.0
    watch_pct: float = 60.0

    # CPU throttling % (% of CFS scheduling periods throttled)
    crit_throttle_pct: float = 50.0
    watch_throttle_pct: float = 25.0

    @classmethod
    def from_env(cls) -> 'ClassifierThresholds':
        return cls(
            crit_pct=_envf('POD_HEALTH_CRIT_PCT', 80.0),
            watch_pct=_envf('POD_HEALTH_WATCH_PCT', 60.0),
            crit_throttle_pct=_envf('POD_HEALTH_CRIT_THROTTLE_PCT', 50.0),
            watch_throttle_pct=_envf('POD_HEALTH_WATCH_THROTTLE_PCT', 25.0),
        )

    def to_dict(self) -> Dict[str, float]:
        return {
            'crit_pct': self.crit_pct,
            'watch_pct': self.watch_pct,
            'crit_throttle_pct': self.crit_throttle_pct,
            'watch_throttle_pct': self.watch_throttle_pct,
        }


# ---------------------------------------------------------------------------
#  Signal / PodHealth dataclasses
# ---------------------------------------------------------------------------

@dataclass
class Signal:
    """One reason a pod is non-healthy.

    ``name`` is the signal identifier (``cpu``, ``memory``, ``cpu_window``,
    ``memory_window``, ``throttle``, ``restarts``, ``oom``, ``phase``,
    ``not_ready``). ``value`` is the raw datum that triggered it; ``reason``
    is a single human-readable line for the UI ("CPU 92.5%", "OOMKilled at
    03:14 UTC").
    """

    name: str
    severity: Severity
    value: Any = None
    reason: str = ''

    def to_dict(self) -> Dict[str, Any]:
        return {
            'name': self.name,
            'severity': self.severity.value,
            'value': self.value,
            'reason': self.reason,
        }


@dataclass
class Event:
    """A single timestamped happening in a pod's life — used by the
    "Events" tab on each pod card so users see *when* and *how often*
    things happened (the v2 report only showed counts).

    ``type`` is one of ``restart`` / ``oom`` / ``throttle_spike`` /
    ``terminated`` / ``phase_change``. The renderer picks an icon from
    that.
    """

    ts: str                                  # ISO 8601, used for sort
    type: str
    severity: Severity = Severity.WATCH
    detail: str = ''                         # one-line human summary
    container: Optional[str] = None
    exit_code: Optional[int] = None
    memory_mb: Optional[float] = None
    memory_limit_mb: Optional[float] = None
    cpu_cores: Optional[float] = None
    cpu_limit_cores: Optional[float] = None
    throttle_pct: Optional[float] = None
    concurrent_op: Optional[str] = None
    log_snippet: Optional[str] = None
    node: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            'ts': self.ts,
            'type': self.type,
            'severity': self.severity.value,
            'detail': self.detail,
            'container': self.container,
            'exit_code': self.exit_code,
            'memory_mb': self.memory_mb,
            'memory_limit_mb': self.memory_limit_mb,
            'cpu_cores': self.cpu_cores,
            'cpu_limit_cores': self.cpu_limit_cores,
            'throttle_pct': self.throttle_pct,
            'concurrent_op': self.concurrent_op,
            'log_snippet': self.log_snippet,
            'node': self.node,
        }


@dataclass
class PodHealth:
    """Classified view of a single pod."""

    pod: str
    namespace: str
    severity: Severity = Severity.HEALTHY
    signals: List[Signal] = field(default_factory=list)
    reasons: List[str] = field(default_factory=list)
    # Numeric fields kept on the dataclass (not just inside signals) so the
    # UI can colour-code columns without re-parsing reason strings.
    cpu_pct: Optional[float] = None
    # Which denominator ``cpu_pct`` was computed against: 'limit' | 'request'
    # | 'unspecified'. None when no pod_cpu row populated this PodHealth.
    cpu_basis: Optional[str] = None
    memory_pct: Optional[float] = None
    cpu_pct_max_in_run: Optional[float] = None
    cpu_pct_max_at: Optional[str] = None
    memory_pct_max_in_run: Optional[float] = None
    memory_pct_max_at: Optional[str] = None
    cpu_throttle_pct: Optional[float] = None
    # Per-container provenance for the pod-level throttle value:
    # ``{container, throttle_ratio, cpu_cores}``. None when no container in
    # the pod has any throttling. Lets the UI show "(top: x 99%)" instead of
    # users wondering whether the main container is starved.
    throttle_top_container: Optional[Dict[str, Any]] = None
    restarts_in_run: int = 0
    restarts_total_lifetime: int = 0
    last_restart_at: Optional[str] = None
    oom_in_run: bool = False
    oom_at: Optional[str] = None
    phase: Optional[str] = None
    ready: Optional[bool] = None
    sort_score: float = 0.0
    # Container-level overlay (set when container_cpu / container_memory data
    # is available). Each entry: {container, cpu_pct, memory_pct, …}
    containers: List[Dict[str, Any]] = field(default_factory=list)
    # v3: per-pod chronological timeline (restart, oom, throttle, terminated)
    # plus tiny series for sparklines. Empty when the source data isn't
    # present — never None — so the template can iterate unconditionally.
    events: List[Event] = field(default_factory=list)
    cpu_series: List[List[Any]] = field(default_factory=list)        # [[iso_ts, pct], …]
    memory_series: List[List[Any]] = field(default_factory=list)     # [[iso_ts, pct], …]
    # v4 — flat-table column data. ``node`` and ``uptime_seconds`` come from
    # kube_pod_info / kube_pod_start_time (added by the report service);
    # ``cpu_limit_cores_pod`` / ``memory_limit_mb_pod`` / ``container_count``
    # are aggregated from ``containers`` so the pod-level row in the v4 table
    # can show "CPU 78% of 1.5c" without expanding the row.
    node: Optional[str] = None
    uptime_seconds: Optional[float] = None
    cpu_limit_cores_pod: Optional[float] = None
    memory_limit_mb_pod: Optional[float] = None
    container_count: int = 0
    # v5 — unified pod-table fields. The single table replaces the v4 tiers
    # AND the legacy "Pod Restarts & OOM Kills" / "Pod Stability" / per-pod
    # cluster-infrastructure sub-tables, so every per-pod fact those views
    # used to surface needs to ride on this dataclass.
    #
    #   ``last_termination_reason`` / ``last_exit_code`` / ``last_terminated_at``
    #     are the latest non-zero exit captured by the kubelet (Prometheus
    #     ``kube_pod_container_status_last_terminated_*`` family). The v5
    #     "Last restart" column shows the reason badge from this even when
    #     no live restart-event was captured (e.g. pre-execution restarts).
    #   ``total_restart_history`` is the per-container restart-timestamp
    #     log (used by the expand row's "Cumulative restart history" panel).
    #   ``restart_events_rich`` carries the FULL ``pod_restart_tracking``
    #     event dicts (memory/cpu at restart, concurrent operation, container
    #     log snippet) so the expand row can render the same rich detail the
    #     legacy "Pod Restarts & OOM Kills" accordion did.
    #   ``waiting_reason`` / ``problem_phase`` separate the two phase signals
    #     (CrashLoopBackOff from container ``waiting`` vs Pod ``Failed`` /
    #     ``Pending`` from the pod itself) so the row can render two badges.
    #   ``last_restart`` is a tiny dict summary of the freshest restart
    #     event surfaced on the row ("Last restart" column) so the table
    #     can show "12:04 · OOMKilled" without iterating events[] again.
    #   ``last_concurrent_op`` mirrors that summary's concurrent-op for
    #     the dedicated "Last op" column.
    #   ``concern_score`` is the v5 sort key. Higher = worse. Ranks OOMs
    #     above in-run restarts above CrashLoopBackOff above throttle ≥50%
    #     above peak CPU/Mem >80% above readiness failures, with lifetime
    #     restart count as the final tiebreak. Stays 0 for "all-clear" pods
    #     so the v5 "Issues only" filter chip is a single comparison.
    last_termination_reason: Optional[str] = None
    last_exit_code: Optional[int] = None
    last_terminated_at: Optional[str] = None
    total_restart_history: List[Dict[str, Any]] = field(default_factory=list)
    restart_events_rich: List[Dict[str, Any]] = field(default_factory=list)
    waiting_reason: Optional[str] = None
    problem_phase: Optional[str] = None
    last_restart: Optional[Dict[str, Any]] = None
    last_concurrent_op: Optional[str] = None
    concern_score: float = 0.0

    def add(self, signal: Signal) -> None:
        if signal.severity == Severity.HEALTHY:
            return
        self.signals.append(signal)
        if signal.reason and signal.reason not in self.reasons:
            self.reasons.append(signal.reason)
        # Compare via .rank — see Severity docstring for why we don't use
        # the built-in str comparison operators directly.
        if signal.severity.rank > self.severity.rank:
            self.severity = signal.severity

    def add_event(self, event: Event) -> None:
        """Append an event; deduplication is left to the caller because the
        same restart can legitimately appear in two source feeds (the live
        ``pod_restart_tracking`` and the Prometheus-derived
        ``terminated_containers``) — the merge layer collapses them."""
        self.events.append(event)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'pod': self.pod,
            'namespace': self.namespace,
            'severity': self.severity.value,
            'reasons': list(self.reasons),
            'signals': [s.to_dict() for s in self.signals],
            'cpu_pct': self.cpu_pct,
            'cpu_basis': self.cpu_basis,
            'memory_pct': self.memory_pct,
            'cpu_pct_max_in_run': self.cpu_pct_max_in_run,
            'cpu_pct_max_at': self.cpu_pct_max_at,
            'memory_pct_max_in_run': self.memory_pct_max_in_run,
            'memory_pct_max_at': self.memory_pct_max_at,
            'cpu_throttle_pct': self.cpu_throttle_pct,
            'throttle_top_container': self.throttle_top_container,
            'restarts_in_run': self.restarts_in_run,
            'restarts_total_lifetime': self.restarts_total_lifetime,
            'last_restart_at': self.last_restart_at,
            'oom_in_run': self.oom_in_run,
            'oom_at': self.oom_at,
            'phase': self.phase,
            'ready': self.ready,
            'sort_score': round(self.sort_score, 2),
            'containers': list(self.containers),
            'events': [e.to_dict() for e in self.events],
            'cpu_series': list(self.cpu_series),
            'memory_series': list(self.memory_series),
            'node': self.node,
            'uptime_seconds': self.uptime_seconds,
            'cpu_limit_cores_pod': self.cpu_limit_cores_pod,
            'memory_limit_mb_pod': self.memory_limit_mb_pod,
            'container_count': self.container_count,
            'last_termination_reason': self.last_termination_reason,
            'last_exit_code': self.last_exit_code,
            'last_terminated_at': self.last_terminated_at,
            'total_restart_history': list(self.total_restart_history),
            'restart_events_rich': list(self.restart_events_rich),
            'waiting_reason': self.waiting_reason,
            'problem_phase': self.problem_phase,
            'last_restart': dict(self.last_restart) if self.last_restart else None,
            'last_concurrent_op': self.last_concurrent_op,
            'concern_score': round(self.concern_score, 2),
        }


# ---------------------------------------------------------------------------
#  The classifier
# ---------------------------------------------------------------------------

# Phases that always indicate a broken pod (no recovery without intervention).
_CRITICAL_PHASES = {
    'CrashLoopBackOff',
    'ImagePullBackOff',
    'ErrImagePull',
    'CreateContainerConfigError',
    'CreateContainerError',
    'InvalidImageName',
    'Failed',
    'Unknown',
}
_WATCH_PHASES = {'Pending'}


class PodHealthClassifier:
    """Stateless classifier — instantiate once with thresholds and reuse.

    Typical use::

        classifier = PodHealthClassifier(ClassifierThresholds.from_env())
        result = classifier.classify(cluster_health_dict)
        # result['summary']         → KPI counts
        # result['critical_pods']   → list[dict] for the Critical tier
        # result['by_namespace']    → grouped for namespace cards
    """

    def __init__(self, thresholds: Optional[ClassifierThresholds] = None):
        self.thresholds = thresholds or ClassifierThresholds()

    # ------------------------------------------------------------------
    #  Public entry point
    # ------------------------------------------------------------------
    def classify(
        self,
        cluster_health: Dict[str, Any],
        pod_restart_tracking: Optional[Dict[str, Any]] = None,
        pod_series: Optional[Dict[Tuple[str, str], Dict[str, List]]] = None,
        pod_meta: Optional[Dict[Tuple[str, str], Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Classify every pod in ``cluster_health``.

        ``pod_restart_tracking`` (optional) is the rich live restart-event
        log captured by ``SmartExecutionController`` — it carries
        timestamps, exit codes, log snippets and the operation that was
        running when the restart was detected. When supplied, those events
        end up on each pod's ``events`` list.

        ``pod_series`` (optional) is a per-pod sparkline payload of the
        shape ``{(namespace, pod): {'cpu': [[ts, pct], …],
        'memory': [[ts, pct], …]}}`` produced by
        ``EnhancedReportService._collect_pod_series()`` — the report
        renderer turns each list into a tiny inline SVG so users can see
        the trend without leaving the pod card.

        ``pod_meta`` (optional, v4) is per-pod metadata used by the v4
        flat-table view: ``{(namespace, pod): {'node': 'nc-…',
        'uptime_seconds': 86400, 'phase': 'Running'}}``. Keys not present
        on a pod default to ``None``. This is also the canonical source
        of "every pod in the cluster" so passing pod_meta from a
        ``kube_pod_info`` query guarantees the v4 table has 100 % pod
        coverage (no missing pods because they happened to have zero
        per-pod metric samples).
        """
        cluster_health = cluster_health or {}
        pods: Dict[Tuple[str, str], PodHealth] = {}

        # 1. Seed pods from every input array — even healthy pods get an entry
        #    so callers can render the full cluster (with the Healthy tier
        #    collapsed) rather than only the misbehaving ones.
        for arr_name in ('pod_cpu', 'pod_memory', 'cpu_throttling',
                         'container_restarts', 'total_restarts',
                         'window_restarts', 'window_oom_events', 'oom_killed',
                         'unhealthy_pods', 'pods_not_ready', 'problem_pods',
                         'window_pod_cpu_max', 'window_pod_memory_max',
                         'restart_timestamps', 'terminated_containers',
                         'container_cpu', 'container_memory'):
            for row in (cluster_health.get(arr_name) or []):
                pod = (row or {}).get('pod')
                ns = (row or {}).get('namespace')
                if not pod or not ns:
                    continue
                key = (ns, pod)
                if key not in pods:
                    pods[key] = PodHealth(pod=pod, namespace=ns)

        # Live restart-event log can introduce pods that aren't in any
        # cluster_health array (e.g. pod was restarted, then deleted before
        # the next Prometheus scrape).
        for ev in ((pod_restart_tracking or {}).get('restart_events') or []):
            pod = ev.get('pod')
            ns = ev.get('namespace')
            if pod and ns and (ns, pod) not in pods:
                pods[(ns, pod)] = PodHealth(pod=pod, namespace=ns)

        # v4 — pod_meta is the kube_pod_info-driven full-cluster seed. If
        # supplied, every pod in the cluster gets a PodHealth entry even
        # if it has zero samples in every other array. This is what fixes
        # the user's "missing pods" complaint.
        for (ns, pod) in (pod_meta or {}).keys():
            if not ns or not pod:
                continue
            if (ns, pod) not in pods:
                pods[(ns, pod)] = PodHealth(pod=pod, namespace=ns)

        # 2. Apply each signal class in turn. Each helper mutates ``pods`` in
        #    place; missing input arrays are silently skipped.
        self._apply_pod_cpu(pods, cluster_health)
        self._apply_pod_memory(pods, cluster_health)
        self._apply_window_cpu(pods, cluster_health)
        self._apply_window_memory(pods, cluster_health)
        self._apply_throttling(pods, cluster_health)
        self._apply_restarts(pods, cluster_health)
        self._apply_oom(pods, cluster_health)
        self._apply_phase(pods, cluster_health)
        self._apply_readiness(pods, cluster_health)
        self._apply_container_overlay(pods, cluster_health)
        # v4 — aggregate container limits → pod totals + container_count.
        self._aggregate_pod_limits(pods)
        # v4 — fold per-pod metadata (node, uptime, phase) onto each entry.
        self._apply_pod_meta(pods, pod_meta)

        # 2b. v3 — fold every timestamped happening into per-pod events[].
        #     Order matters: live restart events first (they're authoritative
        #     and carry the rich detail like exit_code / log_snippet), then
        #     terminated_containers (skip dupes), then throttle samples.
        self._merge_restart_events(pods, pod_restart_tracking)
        self._merge_terminated_containers(pods, cluster_health)
        self._merge_throttle_history(pods, cluster_health)
        self._merge_window_oom(pods, cluster_health)

        # 2c. v3 — attach sparkline series.
        if pod_series:
            for key, series in pod_series.items():
                ph = pods.get(key)
                if not ph:
                    continue
                ph.cpu_series = list(series.get('cpu') or [])
                ph.memory_series = list(series.get('memory') or [])

        # 2d. Sort each pod's events newest-first and dedupe near-identical
        #     ones (same type + container within 30 seconds).
        for ph in pods.values():
            ph.events = self._dedupe_and_sort_events(ph.events)

        # 2e. v5 — sort restart_events_rich newest-first and derive the
        #     "Last restart" summary so the row can render it without
        #     iterating the events list at template time.
        for ph in pods.values():
            ph.restart_events_rich.sort(
                key=lambda ev: ev.get('detected_at') or '', reverse=True,
            )
            ph.last_restart = self._summarize_last_restart(ph)
            ph.last_concurrent_op = (
                (ph.last_restart or {}).get('concurrent_op')
            )
            # If the rich event log captured a more recent restart than
            # the kubelet snapshot, prefer it for the row's "last seen".
            lr_ts = (ph.last_restart or {}).get('ts')
            if lr_ts and (
                not ph.last_terminated_at or lr_ts > ph.last_terminated_at
            ):
                ph.last_terminated_at = lr_ts
                if not ph.last_termination_reason:
                    ph.last_termination_reason = (
                        (ph.last_restart or {}).get('reason')
                    )
                if ph.last_exit_code is None:
                    ph.last_exit_code = (
                        (ph.last_restart or {}).get('exit_code')
                    )

        # 3. Compute sort score (within-tier) AND v5 concern score
        #    (cross-tier, drives the unified-table sort) & assemble.
        for ph in pods.values():
            ph.sort_score = self._sort_score(ph)
            ph.concern_score = self._concern_score(ph)

        sorted_pods = sorted(
            pods.values(),
            key=lambda p: (-p.severity.rank, -p.sort_score, p.namespace, p.pod),
        )

        # v5 — single unified ordering by concern_score (descending), with
        # namespace/pod as deterministic tie-breakers. This is the order
        # the new single-table view renders in.
        unified = sorted(
            pods.values(),
            key=lambda p: (-p.concern_score, p.namespace, p.pod),
        )

        critical = [p for p in sorted_pods if p.severity == Severity.CRITICAL]
        watch = [p for p in sorted_pods if p.severity == Severity.WATCH]
        healthy = [p for p in sorted_pods if p.severity == Severity.HEALTHY]

        # 4. Per-namespace grouping for the UI's collapsible cards.
        by_ns: Dict[str, Dict[str, Any]] = {}
        for ph in sorted_pods:
            slot = by_ns.setdefault(ph.namespace, {
                'namespace': ph.namespace,
                'total': 0, 'critical': 0, 'watch': 0, 'healthy': 0,
                'pods': [],
            })
            slot['total'] += 1
            slot[ph.severity.value] += 1
            slot['pods'].append(ph.to_dict())

        return {
            'thresholds': self.thresholds.to_dict(),
            'summary': {
                'total': len(sorted_pods),
                'critical': len(critical),
                'watch': len(watch),
                'healthy': len(healthy),
                'with_restarts_in_run': sum(1 for p in sorted_pods if p.restarts_in_run),
                'with_oom_in_run': sum(1 for p in sorted_pods if p.oom_in_run),
                'with_high_throttle': sum(
                    1 for p in sorted_pods
                    if (p.cpu_throttle_pct or 0) >= self.thresholds.crit_throttle_pct
                ),
                'with_critical_cpu': sum(
                    1 for p in sorted_pods
                    if (p.cpu_pct or 0) >= self.thresholds.crit_pct
                    or (p.cpu_pct_max_in_run or 0) >= self.thresholds.crit_pct
                ),
                'with_critical_memory': sum(
                    1 for p in sorted_pods
                    if (p.memory_pct or 0) >= self.thresholds.crit_pct
                    or (p.memory_pct_max_in_run or 0) >= self.thresholds.crit_pct
                ),
                # v5 — quick counters the unified-table filter chips key off.
                'with_issues': sum(1 for p in sorted_pods if p.concern_score > 0),
                'with_lifetime_restarts': sum(
                    1 for p in sorted_pods if (p.restarts_total_lifetime or 0) > 0
                ),
                'not_ready': sum(1 for p in sorted_pods if p.ready is False),
            },
            'pods': [p.to_dict() for p in sorted_pods],
            'critical_pods': [p.to_dict() for p in critical],
            'watch_pods': [p.to_dict() for p in watch],
            'healthy_pods': [p.to_dict() for p in healthy],
            # v5 — single sorted list (concern-score descending) the new
            # unified-table renders directly. Same dicts as ``pods``,
            # different ordering — both are preserved so legacy consumers
            # that expect the severity-tier ordering keep working.
            'unified_pods': [p.to_dict() for p in unified],
            'by_namespace': by_ns,
        }

    # ------------------------------------------------------------------
    #  Severity-from-percentage helpers
    # ------------------------------------------------------------------
    def _severity_for_pct(self, value: Optional[float]) -> Severity:
        if value is None:
            return Severity.HEALTHY
        if value >= self.thresholds.crit_pct:
            return Severity.CRITICAL
        if value >= self.thresholds.watch_pct:
            return Severity.WATCH
        return Severity.HEALTHY

    def _severity_for_throttle(self, value: Optional[float]) -> Severity:
        if value is None:
            return Severity.HEALTHY
        if value >= self.thresholds.crit_throttle_pct:
            return Severity.CRITICAL
        if value >= self.thresholds.watch_throttle_pct:
            return Severity.WATCH
        return Severity.HEALTHY

    # ------------------------------------------------------------------
    #  Per-signal mutators
    # ------------------------------------------------------------------
    def _apply_pod_cpu(self, pods, ch):
        for row in (ch.get('pod_cpu') or []):
            ph = pods.get((row.get('namespace'), row.get('pod')))
            if not ph:
                continue
            pct = row.get('cpu_pct')
            ph.cpu_pct = pct
            ph.cpu_basis = row.get('cpu_basis')
            sev = self._severity_for_pct(pct)
            if sev != Severity.HEALTHY:
                # ``cpu_basis`` ('limit', 'request', or 'unspecified') tells us
                # which denominator the percentage was computed against — say
                # it explicitly so a 90% reading isn't misread (90% of request
                # is normal for burstable QoS pods).
                basis = row.get('cpu_basis') or 'limit'
                ph.add(Signal(
                    name='cpu', severity=sev, value=pct,
                    reason=f"CPU {pct:.1f}% of {basis}",
                ))

    def _apply_pod_memory(self, pods, ch):
        for row in (ch.get('pod_memory') or []):
            ph = pods.get((row.get('namespace'), row.get('pod')))
            if not ph:
                continue
            pct = row.get('memory_pct')
            ph.memory_pct = pct
            sev = self._severity_for_pct(pct)
            if sev != Severity.HEALTHY:
                ph.add(Signal(
                    name='memory', severity=sev, value=pct,
                    reason=f"Memory {pct:.1f}% of limit",
                ))

    def _apply_window_cpu(self, pods, ch):
        for row in (ch.get('window_pod_cpu_max') or []):
            ph = pods.get((row.get('namespace'), row.get('pod')))
            if not ph:
                continue
            pct = row.get('cpu_pct_max')
            ph.cpu_pct_max_in_run = pct
            ph.cpu_pct_max_at = row.get('cpu_pct_max_at')
            sev = self._severity_for_pct(pct)
            if sev != Severity.HEALTHY:
                ph.add(Signal(
                    name='cpu_window', severity=sev, value=pct,
                    reason=f"Peak CPU {pct:.1f}% during run",
                ))

    def _apply_window_memory(self, pods, ch):
        for row in (ch.get('window_pod_memory_max') or []):
            ph = pods.get((row.get('namespace'), row.get('pod')))
            if not ph:
                continue
            pct = row.get('memory_pct_max')
            ph.memory_pct_max_in_run = pct
            ph.memory_pct_max_at = row.get('memory_pct_max_at')
            sev = self._severity_for_pct(pct)
            if sev != Severity.HEALTHY:
                ph.add(Signal(
                    name='memory_window', severity=sev, value=pct,
                    reason=f"Peak memory {pct:.1f}% during run",
                ))

    def _apply_throttling(self, pods, ch):
        # Usage-weighted pod throttling — v2 (bug fix 2026-06-03).
        #
        # CPU throttling is per-CONTAINER in the source data. The original
        # implementation took ``max(throttle_ratio)`` across all containers
        # in a pod, which let a 26m sidecar throttled at 99% poison a
        # 1.4-core main container that was healthy.
        #
        # Correct aggregation:
        #
        #   throttle_pod = Σ(throttle_i × cores_i) / Σ(cores_i)
        #
        # CRITICAL — the sum has to span EVERY container in the pod, not
        # just the ones that have a throttling row. cAdvisor only emits
        # ``container_cpu_cfs_throttled_periods_total`` for containers
        # that have throttled at least once; an unthrottled main
        # container has NO row in ``cpu_throttling`` at all. v1 of this
        # fix iterated only ``cpu_throttling``, so the main container's
        # 0% × big-cores never entered the denominator and the weighted
        # average collapsed back to ~max(). Real example caught by the
        # ncm-policy-7ffc9994f9-2khr2 report:
        #   sidecar: 1.1m cores, 81.8% throttled (1 row)
        #   main:    4.2m cores,  0% throttled (NO row)
        #   v1 said: (81.8×1.1)/1.1 = 81.8%   (only saw sidecar)
        #   v2 says: (81.8×1.1 + 0×4.2)/5.3 = 17.0%   (correct)
        #
        # v2 algorithm:
        #   1. Build the full per-pod container roster from container_cpu
        #      (every container's cores, throttled or not).
        #   2. Look up throttle ratio per container; default 0 when no row.
        #   3. weight_sum = Σ(cores_i) over ALL containers in the pod.
        #   4. weighted_sum = Σ(ratio_i × cores_i) over ALL containers.
        #
        # Provenance for the UI: record the worst-throttled container by
        # name so users can see "(top: ncm-logging-sidecar 99%)" inline
        # even when the pod-level number is correctly low.
        from collections import defaultdict
        pod_containers: Dict[Tuple[str, str], Dict[str, float]] = defaultdict(dict)
        for entry in (ch.get('container_cpu') or []):
            pod_containers[(entry.get('namespace', ''), entry.get('pod', ''))][
                entry.get('container', '')
            ] = float(entry.get('cpu_cores') or 0)

        throttle_lookup: Dict[Tuple[str, str, str], float] = {}
        for row in (ch.get('cpu_throttling') or []):
            throttle_lookup[(
                row.get('namespace', ''),
                row.get('pod', ''),
                row.get('container', ''),
            )] = float(row.get('throttle_ratio') or 0)

        # Index throttled containers by pod so we can find them when
        # ``container_cpu`` is missing.
        throttled_by_pod: Dict[Tuple[str, str], Dict[str, float]] = defaultdict(dict)
        for (ns, pod, container), ratio in throttle_lookup.items():
            throttled_by_pod[(ns, pod)][container] = ratio

        # Only score pods that have at least one throttling row — the
        # vast majority of pods have no throttling and don't need updates.
        for key in throttled_by_pod:
            ph = pods.get(key)
            if not ph:
                continue
            ns, pod = key
            containers_in_pod = pod_containers.get((ns, pod), {})
            throttle_for_pod = throttled_by_pod[(ns, pod)]

            weighted_sum = 0.0
            weight_sum = 0.0
            max_ratio = 0.0
            top_info: Optional[Dict[str, Any]] = None

            if containers_in_pod:
                # Primary path: weighted average across every container
                # in the pod (each container's cores acts as its weight;
                # throttle defaults to 0 for containers with no row).
                for container, cores in containers_in_pod.items():
                    ratio = throttle_for_pod.get(container, 0.0)
                    weighted_sum += ratio * cores
                    weight_sum += cores
                    if ratio > max_ratio:
                        max_ratio = ratio
                        top_info = {
                            'container': container,
                            'throttle_ratio': round(ratio, 1),
                            'cpu_cores': round(cores, 3),
                        }
                # Defensive: pick up containers that have throttling
                # data but no container_cpu row (rare race during
                # collection — count them as 0 weight but still surface
                # the worst as the "top" container for the UI tooltip).
                for container, ratio in throttle_for_pod.items():
                    if container not in containers_in_pod and ratio > max_ratio:
                        max_ratio = ratio
                        top_info = {
                            'container': container,
                            'throttle_ratio': round(ratio, 1),
                            'cpu_cores': 0.0,
                        }
            else:
                # No container_cpu data at all for this pod — fall back to
                # max() over the throttling rows so we still surface SOMETHING.
                # cAdvisor can report throttling without cumulative usage
                # in some scenarios (idle pod with bursty periodic work).
                for container, ratio in throttle_for_pod.items():
                    if ratio > max_ratio:
                        max_ratio = ratio
                        top_info = {
                            'container': container,
                            'throttle_ratio': round(ratio, 1),
                            'cpu_cores': 0.0,
                        }
                weighted_sum = max_ratio
                weight_sum = 1.0

            pct = weighted_sum / weight_sum if weight_sum > 0 else max_ratio
            ph.cpu_throttle_pct = round(pct, 1)
            ph.throttle_top_container = top_info

            sev = self._severity_for_throttle(pct)
            if sev != Severity.HEALTHY:
                top_note = (
                    f" (top: {top_info.get('container')} "
                    f"{top_info.get('throttle_ratio')}% "
                    f"using {top_info.get('cpu_cores')} cores)"
                    if top_info else ''
                )
                ph.add(Signal(
                    name='throttle', severity=sev, value=pct,
                    reason=f"CPU throttled {pct:.1f}% of scheduling periods{top_note}",
                ))

    def _apply_restarts(self, pods, ch):
        # Lifetime totals — informational only (no severity escalation).
        for row in (ch.get('total_restarts') or []):
            ph = pods.get((row.get('namespace'), row.get('pod')))
            if not ph:
                continue
            count = int(row.get('total_restarts') or 0)
            # Pod-level total = sum of container totals (matches reference
            # report's "total restarts" column).
            ph.restarts_total_lifetime += count
            last_at = row.get('last_restart_at') or row.get('last_terminated_at')
            if last_at:
                # Keep the most recent restart timestamp.
                if not ph.last_restart_at or last_at > ph.last_restart_at:
                    ph.last_restart_at = last_at
            # v5 — preserve per-container restart history so the expand
            # row's "Cumulative restart history" panel can render it.
            history = list(row.get('restart_history') or [])
            ph.total_restart_history.append({
                'container': row.get('container') or '',
                'total': count,
                'last_at': last_at,
                'history': history,
            })

        # v5 — Capture last termination reason / exit code from the
        # ``terminated_containers`` array (Prometheus
        # ``kube_pod_container_status_last_terminated_reason``). The
        # latest non-empty row wins so the v5 row's "Last restart"
        # column has a reason badge even when no live restart-event
        # was captured (pods restarted before tracking started).
        for tc in (ch.get('terminated_containers') or []):
            ph = pods.get((tc.get('namespace'), tc.get('pod')))
            if not ph:
                continue
            ts = tc.get('last_terminated_at') or tc.get('sampled_at') or ''
            if ts and (
                not ph.last_terminated_at or ts > ph.last_terminated_at
            ):
                ph.last_terminated_at = ts
                ph.last_termination_reason = tc.get('reason') or ph.last_termination_reason
                ec = tc.get('exit_code')
                if ec is not None:
                    try:
                        ph.last_exit_code = int(ec)
                    except (TypeError, ValueError):
                        pass

        # Restarts that happened DURING the execution window — these escalate.
        agg: Dict[Tuple[str, str], Dict[str, Any]] = {}
        for row in (ch.get('window_restarts') or []):
            key = (row.get('namespace'), row.get('pod'))
            count = int(row.get('restarts_in_window') or 0)
            slot = agg.setdefault(key, {'count': 0, 'last': '', 'first': ''})
            slot['count'] += count
            last_at = row.get('last_restart_at') or ''
            first_at = row.get('first_restart_at') or ''
            if last_at and last_at > slot['last']:
                slot['last'] = last_at
            if first_at and (not slot['first'] or first_at < slot['first']):
                slot['first'] = first_at

        for key, data in agg.items():
            ph = pods.get(key)
            if not ph or data['count'] <= 0:
                continue
            ph.restarts_in_run = data['count']
            if data['last'] and (not ph.last_restart_at or data['last'] > ph.last_restart_at):
                ph.last_restart_at = data['last']
            ph.add(Signal(
                name='restarts', severity=Severity.CRITICAL,
                value=data['count'],
                reason=(
                    f"{data['count']} restart(s) during run"
                    + (f" (last at {data['last']})" if data['last'] else '')
                ),
            ))

    def _apply_oom(self, pods, ch):
        # OOM during the execution window → critical, with timestamp.
        seen: Dict[Tuple[str, str], str] = {}
        for row in (ch.get('window_oom_events') or []):
            key = (row.get('namespace'), row.get('pod'))
            ts = row.get('oom_at') or ''
            if key not in seen or ts > seen[key]:
                seen[key] = ts
        for key, ts in seen.items():
            ph = pods.get(key)
            if not ph:
                continue
            ph.oom_in_run = True
            ph.oom_at = ts
            ph.add(Signal(
                name='oom', severity=Severity.CRITICAL, value=ts,
                reason=f"OOMKilled during run" + (f" at {ts}" if ts else ''),
            ))

    def _apply_phase(self, pods, ch):
        for row in (ch.get('problem_pods') or []):
            ph = pods.get((row.get('namespace'), row.get('pod')))
            if not ph:
                continue
            phase = (row.get('phase') or '').strip()
            ph.phase = phase or ph.phase
            # v5 — keep the "problem phase" separate from the regular
            # ``phase`` so the table can render both badges (problem
            # phase first, in red; current phase next, neutral).
            if phase in _CRITICAL_PHASES or phase in _WATCH_PHASES:
                ph.problem_phase = phase
            if phase in _CRITICAL_PHASES:
                ph.add(Signal(
                    name='phase', severity=Severity.CRITICAL, value=phase,
                    reason=f"Pod phase: {phase}",
                ))
            elif phase in _WATCH_PHASES:
                ph.add(Signal(
                    name='phase', severity=Severity.WATCH, value=phase,
                    reason=f"Pod phase: {phase}",
                ))
        # Also inspect unhealthy_pods for crash-loop reasons that
        # ``problem_pods`` may not surface (it's phase-only).
        for row in (ch.get('unhealthy_pods') or []):
            ph = pods.get((row.get('namespace'), row.get('pod')))
            if not ph:
                continue
            reason = (row.get('reason') or '').strip()
            # v5 — surface the container-waiting reason on its own
            # field so the expand row can list it independently of
            # the pod-level phase.
            if reason and not ph.waiting_reason:
                ph.waiting_reason = reason
            if reason in _CRITICAL_PHASES:
                ph.phase = ph.phase or reason
                ph.add(Signal(
                    name='phase', severity=Severity.CRITICAL, value=reason,
                    reason=f"Container waiting: {reason}",
                ))
            elif reason in _WATCH_PHASES:
                ph.add(Signal(
                    name='phase', severity=Severity.WATCH, value=reason,
                    reason=f"Container waiting: {reason}",
                ))

    def _apply_readiness(self, pods, ch):
        for row in (ch.get('pods_not_ready') or []):
            ph = pods.get((row.get('namespace'), row.get('pod')))
            if not ph:
                continue
            ph.ready = False
            ph.add(Signal(
                name='not_ready', severity=Severity.WATCH, value=False,
                reason='Readiness probe failing',
            ))

    def _apply_container_overlay(self, pods, ch):
        """Attach per-container CPU/Mem rows so the UI drill-down works.

        Doesn't escalate severity (the pod-level signals above already do
        that based on the worst container) — purely informational drill-down.
        """
        rows_by_pod: Dict[Tuple[str, str], Dict[str, Dict[str, Any]]] = defaultdict(dict)
        for row in (ch.get('container_cpu') or []):
            key = (row.get('namespace'), row.get('pod'))
            cname = row.get('container') or ''
            slot = rows_by_pod[key].setdefault(cname, {'container': cname})
            slot.update({
                'cpu_pct': row.get('cpu_pct'),
                'cpu_cores': row.get('cpu_cores'),
                'cpu_limit_cores': row.get('cpu_limit_cores'),
                'cpu_request_cores': row.get('cpu_request_cores'),
            })
        for row in (ch.get('container_memory') or []):
            key = (row.get('namespace'), row.get('pod'))
            cname = row.get('container') or ''
            slot = rows_by_pod[key].setdefault(cname, {'container': cname})
            slot.update({
                'memory_pct': row.get('memory_pct'),
                'memory_mb': row.get('memory_mb'),
                'memory_limit_mb': row.get('memory_limit_mb'),
                'memory_request_mb': row.get('memory_request_mb'),
            })
        for key, ctr_map in rows_by_pod.items():
            ph = pods.get(key)
            if not ph:
                continue
            # Sort containers worst-first by max(cpu_pct, memory_pct)
            sorted_ctrs = sorted(
                ctr_map.values(),
                key=lambda c: max(
                    c.get('cpu_pct') or 0, c.get('memory_pct') or 0
                ),
                reverse=True,
            )
            ph.containers = sorted_ctrs

    # ------------------------------------------------------------------
    #  v4 — pod-level aggregations and metadata
    # ------------------------------------------------------------------
    @staticmethod
    def _aggregate_pod_limits(pods: Dict[Tuple[str, str], 'PodHealth']) -> None:
        """Roll container CPU/Mem limits up to a pod-level total.

        The user's v4 table shows "CPU Limit" and "Mem Limit" per pod row,
        but Kubernetes only enforces them per *container*. The convention
        the rest of the report uses (and what the kubelet's
        ``kube_pod_container_resource_limits`` aggregation yields) is to
        sum container limits to get the pod limit. ``container_count`` is
        the count of containers we have any data for so the UI can show
        "3 containers ▾".
        """
        for ph in pods.values():
            cpu_total = 0.0
            cpu_seen = False
            mem_total = 0.0
            mem_seen = False
            for c in ph.containers:
                cpu = c.get('cpu_limit_cores')
                if cpu is not None:
                    try:
                        cpu_total += float(cpu)
                        cpu_seen = True
                    except (TypeError, ValueError):
                        pass
                mem = c.get('memory_limit_mb')
                if mem is not None:
                    try:
                        mem_total += float(mem)
                        mem_seen = True
                    except (TypeError, ValueError):
                        pass
            if cpu_seen and ph.cpu_limit_cores_pod is None:
                ph.cpu_limit_cores_pod = round(cpu_total, 3)
            if mem_seen and ph.memory_limit_mb_pod is None:
                ph.memory_limit_mb_pod = round(mem_total, 1)
            ph.container_count = len(ph.containers)

    @staticmethod
    def _apply_pod_meta(
        pods: Dict[Tuple[str, str], 'PodHealth'],
        pod_meta: Optional[Dict[Tuple[str, str], Dict[str, Any]]],
    ) -> None:
        """Set node, uptime_seconds and (if missing) phase on each pod
        from the report-service supplied metadata. Silently skips entries
        with no ``pod_meta`` key — the UI columns will just render '—'."""
        if not pod_meta:
            return
        for key, meta in pod_meta.items():
            ph = pods.get(key)
            if not ph or not meta:
                continue
            node = meta.get('node')
            if node:
                ph.node = node
            uptime = meta.get('uptime_seconds')
            if uptime is not None:
                try:
                    ph.uptime_seconds = float(uptime)
                except (TypeError, ValueError):
                    pass
            phase = meta.get('phase')
            if phase and not ph.phase:
                ph.phase = phase

    # ------------------------------------------------------------------
    #  v3 — Event merging (the per-pod chronological timeline)
    # ------------------------------------------------------------------
    def _merge_restart_events(self, pods, pod_restart_tracking):
        """Fold the rich live restart-event log into per-pod events[].

        Each event keeps the data the old "Pod Restarts & OOM Kills"
        accordion used to render: exit code, container logs, memory/CPU
        at the moment of the restart, the operation that was concurrently
        running. OOMKilled rows get severity=critical, everything else
        watch (caller can re-rank if needed).

        v5 — also stores a copy of the raw event dict on
        ``ph.restart_events_rich`` so the unified-table expand row can
        render the same rich resource snapshot the legacy accordion did
        without regrowing a parallel data path.
        """
        for ev in ((pod_restart_tracking or {}).get('restart_events') or []):
            pod = ev.get('pod')
            ns = ev.get('namespace')
            if not pod or not ns:
                continue
            ph = pods.get((ns, pod))
            if not ph:
                continue
            reason = (ev.get('restart_reason') or '').strip()
            exit_code = ev.get('exit_code')
            is_oom = reason == 'OOMKilled' or exit_code == 137
            sev = Severity.CRITICAL if is_oom else Severity.WATCH
            etype = 'oom' if is_oom else 'restart'
            n_new = ev.get('new_restarts') or 1
            container = ev.get('container') or ''
            base = (
                f"OOMKilled (exit 137)" if is_oom
                else f"Restart {reason or 'Unknown'}"
            )
            detail = base + (
                f" — +{n_new} restart(s)" if n_new and n_new != 1 else ''
            ) + (
                f" — container={container}" if container else ''
            )
            ph.add_event(Event(
                ts=ev.get('detected_at') or '',
                type=etype,
                severity=sev,
                detail=detail,
                container=container or None,
                exit_code=exit_code,
                memory_mb=ev.get('pod_memory_mb'),
                memory_limit_mb=ev.get('pod_memory_limit_mb'),
                cpu_cores=ev.get('pod_cpu_cores'),
                cpu_limit_cores=ev.get('pod_cpu_limit_cores'),
                concurrent_op=ev.get('concurrent_operation'),
                log_snippet=ev.get('log_snippet'),
                node=ev.get('node'),
            ))
            # v5 — keep the raw event dict (everything the legacy
            # accordion rendered) for the expand row.
            ph.restart_events_rich.append(dict(ev))

    def _merge_terminated_containers(self, pods, ch):
        """Add container-termination samples Prometheus surfaces (no
        exit-code logs, but useful for pods that were already terminated
        before the live tracker started). Skip rows that obviously
        duplicate a live restart event (same container + same minute)."""
        for tc in (ch.get('terminated_containers') or []):
            pod = tc.get('pod')
            ns = tc.get('namespace')
            if not pod or not ns:
                continue
            ph = pods.get((ns, pod))
            if not ph:
                continue
            ts = (
                tc.get('last_terminated_at')
                or tc.get('sampled_at')
                or ''
            )
            if not ts:
                continue
            container = tc.get('container') or ''
            reason = (tc.get('reason') or '').strip()
            exit_code = tc.get('exit_code')
            is_oom = reason == 'OOMKilled' or exit_code == 137
            # Dedup against any live event for the same container within
            # ±60 s — the live tracker is authoritative for those.
            if any(
                (e.container or '') == container
                and e.type in ('restart', 'oom', 'terminated')
                and self._ts_close(e.ts, ts, seconds=60)
                for e in ph.events
            ):
                continue
            sev = Severity.CRITICAL if is_oom else Severity.WATCH
            ph.add_event(Event(
                ts=ts,
                type='oom' if is_oom else 'terminated',
                severity=sev,
                detail=(
                    f"OOMKilled (exit 137) — container={container}"
                    if is_oom else
                    f"Terminated: {reason or 'Unknown'}"
                    + (f" (exit {exit_code})" if exit_code is not None else '')
                    + (f" — container={container}" if container else '')
                ),
                container=container or None,
                exit_code=exit_code,
            ))

    def _merge_throttle_history(self, pods, ch):
        """Each throttle sample > watch-threshold becomes one event.
        Cap to the last 5 samples per (pod, container) to avoid spam.
        """
        # Group samples per (ns, pod, container) so we can keep the worst.
        per_ctr: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = defaultdict(list)
        for t in (ch.get('cpu_throttling') or []):
            pod = t.get('pod')
            ns = t.get('namespace')
            container = t.get('container') or ''
            if not pod or not ns:
                continue
            for s in (t.get('throttle_history') or []):
                pct = float(s.get('throttle_pct') or 0)
                if pct < self.thresholds.watch_throttle_pct:
                    continue
                per_ctr[(ns, pod, container)].append({
                    'ts': s.get('timestamp') or '',
                    'pct': pct,
                })
        for (ns, pod, container), samples in per_ctr.items():
            ph = pods.get((ns, pod))
            if not ph:
                continue
            samples.sort(key=lambda s: s['ts'], reverse=True)
            for s in samples[:5]:
                pct = s['pct']
                sev = self._severity_for_throttle(pct)
                if sev == Severity.HEALTHY:
                    continue
                ph.add_event(Event(
                    ts=s['ts'],
                    type='throttle_spike',
                    severity=sev,
                    detail=(
                        f"CPU throttled {pct:.1f}% of scheduling periods"
                        + (f" — container={container}" if container else '')
                    ),
                    container=container or None,
                    throttle_pct=pct,
                ))

    def _merge_window_oom(self, pods, ch):
        """If ``window_oom_events`` says a pod OOMd during the run but no
        restart_event captured it (rare, can happen when the live tracker
        missed the scrape), add a synthetic OOM event so the timeline
        still reflects it."""
        for row in (ch.get('window_oom_events') or []):
            pod = row.get('pod')
            ns = row.get('namespace')
            ts = row.get('oom_at') or ''
            if not pod or not ns or not ts:
                continue
            ph = pods.get((ns, pod))
            if not ph:
                continue
            if any(e.type == 'oom' and self._ts_close(e.ts, ts, 120)
                   for e in ph.events):
                continue
            ph.add_event(Event(
                ts=ts,
                type='oom',
                severity=Severity.CRITICAL,
                detail='OOMKilled during run (Prometheus-derived)',
            ))

    @staticmethod
    def _dedupe_and_sort_events(events: List[Event]) -> List[Event]:
        """Sort newest-first; drop exact-duplicate events (rare but cheap
        to defend against)."""
        seen: set = set()
        out: List[Event] = []
        for e in sorted(events, key=lambda e: e.ts or '', reverse=True):
            sig = (e.ts, e.type, e.container or '', e.exit_code)
            if sig in seen:
                continue
            seen.add(sig)
            out.append(e)
        return out

    @staticmethod
    def _ts_close(a: str, b: str, seconds: int) -> bool:
        """True when two ISO-8601 timestamps are within ``seconds`` of each
        other. Returns False on parse errors so we never falsely dedupe."""
        if not a or not b:
            return False
        try:
            from datetime import datetime
            ta = datetime.fromisoformat(a.replace('Z', '+00:00'))
            tb = datetime.fromisoformat(b.replace('Z', '+00:00'))
            return abs((ta - tb).total_seconds()) <= seconds
        except Exception:  # noqa: BLE001 — defensive parsing
            return False

    # ------------------------------------------------------------------
    #  Sort score — used to break ties within the same severity tier
    # ------------------------------------------------------------------
    @staticmethod
    def _sort_score(ph: PodHealth) -> float:
        return (
            (ph.cpu_pct or 0)
            + (ph.memory_pct or 0)
            + (ph.cpu_pct_max_in_run or 0) * 0.5
            + (ph.memory_pct_max_in_run or 0) * 0.5
            + (ph.cpu_throttle_pct or 0) * 0.3
            + ph.restarts_in_run * 30
            + (100 if ph.oom_in_run else 0)
        )

    # ------------------------------------------------------------------
    #  v5 — Concern score (cross-tier, drives unified-table sort)
    # ------------------------------------------------------------------
    @staticmethod
    def _concern_score(ph: PodHealth) -> float:
        """Compute a single 0…N score that ranks pods worst-first across
        the entire cluster. Higher = worse.

        Bands (informational — used by the v5 row's coloured severity dot):
          * ≥ 500 → red    — actively broken (OOM, restart-in-run,
                              CrashLoopBackOff, Failed phase)
          * ≥ 100 → amber  — at-risk (high CPU/Mem, throttling, not-ready,
                              waiting reason, lifetime restart spam)
          * = 0   → green  — quiet pod, eligible for the "Hide healthy"
                              filter chip

        Weights are picked so that (a) the things the user said to
        "prioritise" — OOMs and restarts — always sit at the top, and
        (b) two pods with similar peak%/throttle% but different lifetime
        restart counts still tie-break in a meaningful order.
        """
        score = 0.0
        # Tier 1 — actively broken (always ≥ 500)
        if ph.oom_in_run:
            score += 600
        score += (ph.restarts_in_run or 0) * 200
        if ph.problem_phase and ph.problem_phase in _CRITICAL_PHASES:
            score += 250
        if ph.waiting_reason and ph.waiting_reason in _CRITICAL_PHASES:
            score += 220

        # Tier 2 — at-risk (lands somewhere in 100…500)
        thr = ph.cpu_throttle_pct or 0
        if thr >= 50:
            score += 60 + (thr - 50) * 4
        elif thr >= 25:
            score += 30 + (thr - 25) * 1.2

        cpu_peak = ph.cpu_pct_max_in_run or ph.cpu_pct or 0
        if cpu_peak >= 80:
            score += 40 + (cpu_peak - 80) * 3
        elif cpu_peak >= 60:
            score += 15 + (cpu_peak - 60) * 1
        mem_peak = ph.memory_pct_max_in_run or ph.memory_pct or 0
        if mem_peak >= 80:
            score += 40 + (mem_peak - 80) * 3
        elif mem_peak >= 60:
            score += 15 + (mem_peak - 60) * 1

        if ph.ready is False:
            score += 70
        if ph.problem_phase and ph.problem_phase in _WATCH_PHASES:
            score += 40
        if ph.waiting_reason and ph.waiting_reason in _WATCH_PHASES:
            score += 30

        # Tie-break — lifetime restart spam (capped so it can never on
        # its own promote a quiet pod past an actively-broken one).
        score += min(ph.restarts_total_lifetime or 0, 50) * 0.6

        return score

    # ------------------------------------------------------------------
    #  v5 — Last restart summary
    # ------------------------------------------------------------------
    @staticmethod
    def _summarize_last_restart(ph: PodHealth) -> Optional[Dict[str, Any]]:
        """Pick the freshest restart/OOM event for the v5 row's "Last
        restart" column. Falls back to the kubelet-snapshot fields when
        no rich event was captured (which is the common case for pods
        that restarted before the live tracker started)."""
        # Prefer rich events when available — they carry concurrent_op
        # and the in-pod CPU/Mem snapshot.
        if ph.restart_events_rich:
            ev = ph.restart_events_rich[0]
            reason = ev.get('restart_reason') or ev.get('reason')
            exit_code = ev.get('exit_code')
            if reason == 'OOMKilled' or exit_code == 137:
                reason = 'OOMKilled'
            return {
                'ts': ev.get('detected_at') or '',
                'reason': reason or 'Restart',
                'exit_code': exit_code,
                'container': ev.get('container'),
                'concurrent_op': ev.get('concurrent_operation'),
                'source': 'live',
            }
        # Fall back to the synthesised events list (Prometheus-derived
        # OOM / terminated rows).
        for e in ph.events:
            if e.type in ('restart', 'oom', 'terminated'):
                return {
                    'ts': e.ts,
                    'reason': (
                        'OOMKilled' if e.type == 'oom' else
                        (e.detail.split(':', 1)[1].strip()
                         if e.type == 'terminated' and ':' in e.detail
                         else 'Restart')
                    ),
                    'exit_code': e.exit_code,
                    'container': e.container,
                    'concurrent_op': e.concurrent_op,
                    'source': 'metric',
                }
        # Last resort — kubelet snapshot.
        if ph.last_terminated_at or ph.last_termination_reason:
            return {
                'ts': ph.last_terminated_at or ph.last_restart_at or '',
                'reason': ph.last_termination_reason or 'Restart',
                'exit_code': ph.last_exit_code,
                'container': None,
                'concurrent_op': None,
                'source': 'snapshot',
            }
        return None


# ---------------------------------------------------------------------------
#  Convenience module-level wrapper
# ---------------------------------------------------------------------------

def classify_cluster_health(
    cluster_health: Dict[str, Any],
    thresholds: Optional[ClassifierThresholds] = None,
    pod_restart_tracking: Optional[Dict[str, Any]] = None,
    pod_series: Optional[Dict[Tuple[str, str], Dict[str, List]]] = None,
    pod_meta: Optional[Dict[Tuple[str, str], Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """One-shot helper: build a default classifier and run it.

    See ``PodHealthClassifier.classify`` for the meaning of the optional
    ``pod_restart_tracking`` / ``pod_series`` / ``pod_meta`` arguments —
    they enrich the v3 per-pod Events / Time-series tabs and the v4
    flat-table columns (Node, Uptime, aggregated CPU/Mem limits, plus
    a "no missing pods" full-cluster seed).
    """
    return PodHealthClassifier(thresholds or ClassifierThresholds.from_env()).classify(
        cluster_health,
        pod_restart_tracking=pod_restart_tracking,
        pod_series=pod_series,
        pod_meta=pod_meta,
    )
