"""
Enhanced Smart Execution Report Service

Generates AI-powered reports with:
- Spike-to-operation correlation (maps metric spikes to causal operations)
- Cluster health snapshots (CPU throttling, OOMKills, restarts, node conditions)
- Failure root cause grouping
- Operation timing heatmap data
- Historical comparison across executions
- Pod stability scoring
- Capacity planning estimates
- Executive verdict (PASS/WARN/FAIL)

Data flow (Phase 0):
  smart_execution_service (execution + persist) -> full_execution_data.cluster_health_snapshot
  enhanced_report_service.generate_enhanced_report() -> SmartExecutionReport.tsx / enhanced_report.html
  Optional live Prometheus: same host as testbed :9090 or controller.prometheus_url

JSON contract (enhanced_report top-level keys used by UI):
  verdict, spike_analysis, cluster_health, failure_analysis, operation_heatmap,
  pod_stability, node_stability, restart_timestamps, historical_comparison,
  capacity_planning, ml_report_insights, latency_report, learning_summary,
  iteration_timeline, entity_operation_counts, effective_metrics,
  report_metadata (provenance: samples, time range, cluster_health_source, prometheus_configured)

cluster_health:
  cpu_throttling[], container_restarts[], oom_killed[], node_conditions[], pvc_health[],
  unhealthy_pods[], terminated_containers[], total_restarts[], problem_pods[],
  pods_not_ready[], pod_phase_summary{}, api_server_latency[], etcd_healthy
  collection_status: "success" | "unavailable" | "failed" (legacy: "error: ..." from old runs)
  collection_reason: short code or message when not success (e.g. prometheus_unreachable)

Prometheus instant queries used in _collect_cluster_health:
  throttle: topk(20, rate(container_cpu_cfs_throttled_periods_total{...}[5m]) / rate(...[5m]))
  restarts: topk(20, increase(kube_pod_container_status_restarts_total{...}[1h]))
  oom: kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}
  nodes: kube_node_status_condition{status="true"}
  pvc: kubelet_volume_stats_capacity_bytes, kubelet_volume_stats_used_bytes
"""

import json
import logging
import math
import re
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import requests
from urllib.parse import urljoin

from services.prometheus_url import resolve_working_prometheus_url
# Pod-coverage v2: single source of truth for pod severity. Used here to add a
# ``pod_health`` block to the report payload (Critical / Watch / Healthy tiers,
# per-namespace grouping, sort score). The same module is consumed later by the
# Slack notifier and the Alerts page so the three views can never disagree.
from services.pod_health_classifier import (
    ClassifierThresholds,
    PodHealthClassifier,
)

logger = logging.getLogger(__name__)

SPIKE_WINDOW_SECONDS = 90
RECOVERY_THRESHOLD_PERCENT = 2.0
MIN_SPIKE_DELTA = 5.0

# An operation is treated as "successful" for QA / pass-rate purposes when it
# carries any of these terminal-success status strings, OR when the engine
# explicitly set ``success=True`` on the record.
#
# Why this matters:
# - The in-memory engine (smart_execution_engine_ai) records ``status='SUCCESS'``
#   and ``success=True`` on each op.
# - Persisted rows in ``operation_metrics`` (DB) use ``status='COMPLETED'`` for
#   successful ops (the SQLAlchemy enum chosen long ago).
# Treating only 'SUCCESS' as success made every report rendered from DB-loaded
# data collapse to 0% pass rate — the cause of the "28628 ops, 0% success" bug.
SUCCESS_STATES = {'SUCCESS', 'COMPLETED', 'OK'}


# ---------------------------------------------------------------------------
#  Pod-coverage v1 — feature flag + sanity caps
# ---------------------------------------------------------------------------
# Set ``POD_COVERAGE_V1=false`` in the environment to fall back to the legacy
# ``topk(20)/topk(30)`` behaviour. Default is on, because the legacy caps
# silently dropped pods 21..N from the report (the "we only see 30 of 273
# pods" complaint).
#
# Even with the flag on, every new field is *additive* — no existing key is
# removed or renamed. So flipping the flag back off is safe and the UI keeps
# working. Anything that fails (e.g. kube-state-metrics not installed) leaves
# the affected new key as an empty list / empty dict.
import os as _os


def _env_bool(name: str, default: bool = True) -> bool:
    raw = _os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {'1', 'true', 'yes', 'on', 'y', 't'}


def _env_int(name: str, default: int) -> int:
    raw = _os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


# Master toggle for the full pod-coverage payload (cluster_summary,
# cluster_allocation, node_breakdown, container_cpu, container_memory,
# window_pod_cpu_max, window_pod_memory_max, window_restarts, window_oom_events).
POD_COVERAGE_V1_ENABLED = _env_bool('POD_COVERAGE_V1', True)

# When the legacy ``topk(N)`` is removed, Prometheus may hand back hundreds of
# pods. We still cap the rendered list so a single rogue cluster can't OOM
# the browser. 1000 rows × ~200 bytes each = ~200 KB JSON which is fine.
POD_COVERAGE_MAX_ROWS = _env_int('POD_COVERAGE_MAX_ROWS', 1000)

# Pod-coverage v3 — per-pod sparkline series for the redesigned report.
# OFF by default (one extra Prometheus range query per non-healthy pod) —
# flip POD_COVERAGE_V3=true to enable. The payload is small (~30 [ts, pct]
# pairs per pod × 2 series) but the queries cost ~1-2s each so we only
# run them for non-healthy pods.
POD_COVERAGE_V3_ENABLED = _env_bool('POD_COVERAGE_V3', True)

# Cap how many pods get sparkline series — the rest fall back to the
# scalar peak we already compute (cpu_pct_max_in_run / memory_pct_max_in_run).
POD_COVERAGE_V3_MAX_PODS = _env_int('POD_COVERAGE_V3_MAX_PODS', 80)

# Number of points per sparkline. 30 keeps the SVG path tiny and the
# per-pod range queries cheap.
POD_COVERAGE_V3_SERIES_POINTS = _env_int('POD_COVERAGE_V3_SERIES_POINTS', 30)


def _op_succeeded(op: dict) -> bool:
    if not isinstance(op, dict):
        return False
    if op.get('success') is True:
        return True
    return (op.get('status') or '').upper() in SUCCESS_STATES


class EnhancedReportService:

    def __init__(self, prometheus_url: Optional[str] = None):
        self.prometheus_url = (
            resolve_working_prometheus_url(prometheus_url) if prometheus_url else None
        )

    # ------------------------------------------------------------------
    #  PUBLIC: build the full enhanced report payload
    # ------------------------------------------------------------------
    def generate_enhanced_report(self,
                                 report_data: Dict,
                                 status_data: Dict,
                                 execution_id: str,
                                 testbed_id: Optional[str] = None) -> Dict:
        metrics_history = report_data.get('metrics_history') or status_data.get('metrics_history') or []
        operations_history = report_data.get('operations_history') or status_data.get('operations_history') or []
        pod_correlation = report_data.get('pod_operation_correlation') or status_data.get('pod_operation_correlation') or {}
        raw_baseline = report_data.get('baseline_metrics') or status_data.get('baseline_metrics') or {}
        raw_final = report_data.get('current_metrics') or report_data.get('final_metrics') or status_data.get('current_metrics') or status_data.get('final_metrics') or {}
        baseline_metrics, final_metrics, metrics_resolution_note = self._resolve_effective_metrics(
            raw_baseline, raw_final, metrics_history
        )
        detected_anomalies = report_data.get('detected_anomalies') or status_data.get('detected_anomalies') or []
        target_config = report_data.get('target_config') or status_data.get('target_config') or {}

        spike_analysis = self._analyze_spikes(metrics_history, operations_history, pod_correlation, detected_anomalies, target_config)
        # Pod-coverage v1: pass the execution window so range queries can
        # compute per-pod max CPU%/Mem% / window restarts / window OOM events.
        # Falls back to (None, None) when the run hasn't started or these
        # fields aren't on the status payload (legacy execution data).
        exec_start = (
            status_data.get('start_time')
            or report_data.get('start_time')
            or (report_data.get('full_execution_data', {}) or {}).get('start_time')
        )
        exec_end = (
            status_data.get('end_time')
            or report_data.get('end_time')
            or (report_data.get('full_execution_data', {}) or {}).get('end_time')
        )
        # If the run is still in flight, "now" is a fine proxy for the
        # window-end so range queries still cover everything seen so far.
        if exec_start and not exec_end:
            exec_end = datetime.now(tz=timezone.utc).isoformat()
        live_cluster_health = self._collect_cluster_health(
            execution_window=(exec_start, exec_end) if exec_start else None
        )
        cluster_health = live_cluster_health
        persisted_health = report_data.get('cluster_health_snapshot') or status_data.get('cluster_health_snapshot')
        cluster_health_source = 'unavailable'
        if self._cluster_health_snapshot_usable(cluster_health):
            cluster_health_source = 'live_prometheus'
        elif self._cluster_health_snapshot_usable(persisted_health):
            cluster_health = dict(persisted_health)
            cluster_health_source = 'persisted_snapshot'
            # Enrich persisted snapshot with live data if available
            if live_cluster_health.get('pod_cpu'):
                cluster_health['pod_cpu'] = live_cluster_health['pod_cpu']
                cluster_health['pod_memory'] = live_cluster_health.get('pod_memory', [])
            for live_key in ('unhealthy_pods', 'terminated_containers', 'total_restarts',
                             'problem_pods', 'pod_phase_summary', 'pods_not_ready',
                             'api_server_latency', 'etcd_healthy',
                             'node_cpu', 'node_memory', 'node_disk', 'restart_timestamps',
                             # Pod-coverage v1 — additive, never present on
                             # legacy persisted snapshots so the merge below
                             # is safe.
                             'pod_coverage_v1', 'cluster_summary',
                             'cluster_allocation', 'node_breakdown',
                             'container_cpu', 'container_memory',
                             'window_pod_cpu_max', 'window_pod_memory_max',
                             'window_restarts', 'window_oom_events',
                             'execution_window'):
                if live_key in live_cluster_health:
                    cluster_health[live_key] = live_cluster_health[live_key]

        # ------------------------------------------------------------------
        # v5 — bidirectional merge: even when LIVE Prometheus is reachable
        # the per-pod / per-container arrays it produces can be partial
        # (e.g. cAdvisor scrape was delayed, NCM nodePort flapped between
        # iterations, or only node-level series were available at query
        # time). The pre-v5 logic was all-or-nothing — picked the live
        # snapshot whole, discarding the richer persisted snapshot the
        # engine had captured during the run. That made the v5 unified
        # Pod Health table render "—" for CPU Max %, Mem Max %, CPU Limit,
        # Mem Limit and container_count even though the run had collected
        # all of it on disk (verified end-to-end on 10.114.54.238-longivity
        # — 181 pod_cpu / pod_memory / container_cpu / container_memory rows
        # in the persisted snapshot, 0 in the live one).
        # Strategy:
        #   * For scalar / dict-shaped keys: live wins, fall back to
        #     persisted only when live is empty.
        #   * For list-of-rows keys with a (namespace, pod[, container])
        #     identity: UNION live + persisted, with live entries winning
        #     on tuple collisions (so the live snapshot's freshness still
        #     beats the persisted one) but every persisted row that the
        #     live scrape missed is preserved instead of being dropped.
        #     This is the only thing that fixes the otel-collector case
        #     where live had ~5 container_cpu rows and persisted had 248.
        if (cluster_health_source == 'live_prometheus'
                and isinstance(persisted_health, dict)
                and persisted_health):
            _SCALAR_KEYS = (
                'pod_phase_summary', 'cluster_summary', 'cluster_allocation',
                'etcd_healthy', 'execution_window',
            )
            # Union keys are arrays of dicts where (ns, pod[, container])
            # uniquely identifies each row. Three-tuple keys are listed
            # explicitly so we pick up the container axis.
            _UNION_KEYS_POD: Tuple[str, ...] = (
                'pod_cpu', 'pod_memory', 'pods_not_ready', 'problem_pods',
                'unhealthy_pods', 'window_pod_cpu_max',
                'window_pod_memory_max', 'window_restarts',
                'window_oom_events', 'oom_killed', 'restart_timestamps',
            )
            _UNION_KEYS_CONTAINER: Tuple[str, ...] = (
                'container_cpu', 'container_memory', 'container_restarts',
                'total_restarts', 'cpu_throttling', 'terminated_containers',
            )
            _UNION_KEYS_NODE: Tuple[str, ...] = (
                'node_conditions', 'node_breakdown', 'node_cpu',
                'node_memory', 'node_disk',
            )
            _UNION_KEYS_OTHER: Tuple[str, ...] = (
                'api_server_latency', 'pvc_health',
            )

            def _union(live_list, pers_list, key_fn):
                live_list = live_list if isinstance(live_list, list) else []
                pers_list = pers_list if isinstance(pers_list, list) else []
                if not pers_list:
                    return live_list
                seen = set()
                out: List[Any] = []
                for row in live_list:
                    if not isinstance(row, dict):
                        out.append(row)
                        continue
                    try:
                        k = key_fn(row)
                    except Exception:
                        k = None
                    if k is not None:
                        seen.add(k)
                    out.append(row)
                for row in pers_list:
                    if not isinstance(row, dict):
                        continue
                    try:
                        k = key_fn(row)
                    except Exception:
                        k = None
                    if k is None or k not in seen:
                        out.append(row)
                        if k is not None:
                            seen.add(k)
                return out

            _pod_key = lambda r: (r.get('namespace'), r.get('pod'))
            _ctr_key = lambda r: (r.get('namespace'), r.get('pod'),
                                  r.get('container'))
            _node_key = lambda r: r.get('node') or r.get('instance')
            _generic_key = lambda r: tuple(sorted(
                (k, str(v)) for k, v in r.items()
                if k in ('namespace', 'pod', 'container', 'node',
                         'instance', 'pvc_name', 'verb', 'resource')
            ))

            for k in _UNION_KEYS_POD:
                cluster_health[k] = _union(
                    cluster_health.get(k), persisted_health.get(k),
                    _pod_key,
                )
            for k in _UNION_KEYS_CONTAINER:
                cluster_health[k] = _union(
                    cluster_health.get(k), persisted_health.get(k),
                    _ctr_key,
                )
            for k in _UNION_KEYS_NODE:
                cluster_health[k] = _union(
                    cluster_health.get(k), persisted_health.get(k),
                    _node_key,
                )
            for k in _UNION_KEYS_OTHER:
                cluster_health[k] = _union(
                    cluster_health.get(k), persisted_health.get(k),
                    _generic_key,
                )
            for k in _SCALAR_KEYS:
                live_v = cluster_health.get(k)
                pers_v = persisted_health.get(k)
                empty_live = (
                    live_v is None
                    or (isinstance(live_v, (list, dict)) and len(live_v) == 0)
                )
                if empty_live and pers_v:
                    cluster_health[k] = pers_v
            # Preserve pod_coverage_v1 and any other simple flag the live
            # snapshot didn't bother to set.
            for k in ('pod_coverage_v1',):
                if k not in cluster_health and k in persisted_health:
                    cluster_health[k] = persisted_health[k]
            cluster_health_source = 'live_prometheus+persisted'
        failure_groups = self._group_failures(operations_history)
        heatmap = self._build_operation_heatmap(operations_history)
        pod_stability = self._compute_pod_stability(pod_correlation, cluster_health)
        node_stability = self._compute_node_stability(cluster_health)
        historical = self._get_historical_comparison(testbed_id, execution_id)
        historical = self._enrich_historical_trends(historical, status_data, report_data)
        capacity = self._estimate_capacity(operations_history, metrics_history, baseline_metrics, final_metrics, report_data)
        ml_insights = self._get_ml_report_insights(testbed_id)
        iteration_timeline = self._build_iteration_timeline(metrics_history, operations_history, spike_analysis)
        entity_operation_counts = self._entity_operation_counts(operations_history)
        verdict = self._compute_verdict(
            report_data, status_data, spike_analysis, cluster_health,
            failure_groups, operations_history, metrics_history
        )

        latency_report = self._build_latency_report(status_data)
        entity_latency = self._build_entity_latency_breakdown(operations_history)
        error_code_breakdown = self._build_error_code_breakdown(operations_history)
        dependency_cascade = self._detect_dependency_cascades(operations_history)
        execution_mode_summary = self._build_execution_mode_summary(operations_history)
        learning = status_data.get('learning_summary') or report_data.get('learning_summary') or ''
        health_assessment = self._build_health_assessment(cluster_health, pod_stability, node_stability)

        report_metadata = self._build_report_metadata(
            metrics_history=metrics_history,
            operations_history=operations_history,
            cluster_health_source=cluster_health_source,
            metrics_resolution_note=metrics_resolution_note,
            execution_id=execution_id,
        )

        pod_restart_tracking = (
            report_data.get('pod_restart_tracking')
            or status_data.get('pod_restart_tracking')
            or (report_data.get('full_execution_data', {}) or {}).get('pod_restart_tracking')
            or {}
        )

        # ------------------------------------------------------------------
        # Pod-coverage v2/v3: classify every pod into Critical / Watch /
        # Healthy using a single, shared severity engine. v3 additionally
        # enriches each pod with:
        #   * events[]  — chronological timeline (restart/oom/throttle/term)
        #   * cpu_series / memory_series — tiny sparklines (top-N pods only)
        # The output drives:
        #   - the tiered Pod Coverage section in the report
        #   - the Slack notifier's first-fire-then-silent gating (Phase 5)
        #   - the Alerts page severity column (Phase 6)
        # Wrapped in try/except + feature flag so a classifier-side bug can
        # never break report generation; consumers fall back to the raw
        # ``cluster_health`` arrays they were already using.
        pod_health_block: Dict[str, Any] = {}
        if POD_COVERAGE_V1_ENABLED:
            # v3 sparkline series — only for non-healthy pods (saves Prometheus).
            pod_series: Dict[Tuple[str, str], Dict[str, List]] = {}
            if POD_COVERAGE_V3_ENABLED and exec_start and self.prometheus_url:
                try:
                    pod_series = self._collect_pod_series(
                        cluster_health=cluster_health or {},
                        execution_window=(exec_start, exec_end),
                        max_pods=POD_COVERAGE_V3_MAX_PODS,
                        points=POD_COVERAGE_V3_SERIES_POINTS,
                    )
                except Exception as series_err:  # noqa: BLE001
                    logger.warning(
                        "Pod sparkline collection failed for %s: %s",
                        execution_id, series_err, exc_info=True,
                    )
                    pod_series = {}
            # v4 — kube_pod_info-driven full-cluster seed (Node, Uptime, Phase).
            # This is what guarantees "no missing pods" in the v4 table even
            # when a pod had zero per-pod metric samples in cluster_health.
            pod_meta: Dict[Tuple[str, str], Dict[str, Any]] = {}
            if self.prometheus_url:
                try:
                    pod_meta = self._collect_pod_meta()
                except Exception as meta_err:  # noqa: BLE001
                    logger.warning(
                        "Pod metadata collection failed for %s: %s",
                        execution_id, meta_err, exc_info=True,
                    )
                    pod_meta = {}
            try:
                pod_health_block = PodHealthClassifier(
                    ClassifierThresholds.from_env()
                ).classify(
                    cluster_health or {},
                    pod_restart_tracking=pod_restart_tracking,
                    pod_series=pod_series or None,
                    pod_meta=pod_meta or None,
                )
            except Exception as exc:  # noqa: BLE001 — defensive, log + continue
                logger.warning(
                    "PodHealthClassifier failed for execution %s: %s",
                    execution_id, exc, exc_info=True,
                )
                pod_health_block = {'error': str(exc), 'pods': [], 'summary': {
                    'total': 0, 'critical': 0, 'watch': 0, 'healthy': 0,
                }}
            # Mirror the block under cluster_health so persisted snapshots can
            # carry it forward (DB JSONB column already serialises cluster_health).
            if isinstance(cluster_health, dict):
                cluster_health['pod_health'] = pod_health_block

        return {
            'verdict': verdict,
            'spike_analysis': spike_analysis,
            'cluster_health': cluster_health,
            # Top-level for direct template access (e.g. ``pod_health.summary.critical``).
            # Same object is also reachable as ``cluster_health.pod_health`` below
            # so existing per-cluster JSON consumers can find it without a UI change.
            'pod_health': pod_health_block,
            'failure_analysis': failure_groups,
            'operation_heatmap': heatmap,
            'pod_stability': pod_stability,
            'node_stability': node_stability,
            'restart_timestamps': cluster_health.get('restart_timestamps', []),
            'health_assessment': health_assessment,
            'historical_comparison': historical,
            'capacity_planning': capacity,
            'ml_report_insights': ml_insights,
            'latency_report': latency_report,
            'entity_latency_breakdown': entity_latency,
            'error_code_breakdown': error_code_breakdown,
            'dependency_cascade': dependency_cascade,
            'execution_mode_summary': execution_mode_summary,
            'learning_summary': learning,
            'iteration_timeline': iteration_timeline,
            'entity_operation_counts': entity_operation_counts,
            'effective_metrics': {
                'baseline': baseline_metrics,
                'final': final_metrics,
                'resolution_note': metrics_resolution_note,
            },
            'report_metadata': report_metadata,
            'pod_restart_tracking': pod_restart_tracking,
        }

    def _entity_operation_counts(self, operations_history: List) -> List[Dict[str, Any]]:
        """QA breakdown per entity.operation: total, success, failed, skipped, pass_rate."""
        buckets: Dict[str, Dict[str, int]] = defaultdict(lambda: {
            'total': 0, 'success': 0, 'failed': 0, 'skipped': 0,
        })
        for op in operations_history:
            key = f"{op.get('entity_type', '?')}.{op.get('operation', '?')}"
            b = buckets[key]
            b['total'] += 1
            status = (op.get('status') or '').upper()
            if _op_succeeded(op):
                b['success'] += 1
            elif status == 'FAILED':
                b['failed'] += 1
            else:
                b['skipped'] += 1
        ordered = sorted(buckets.items(), key=lambda x: (-x[1]['total'], x[0]))
        results = []
        for key, b in ordered:
            attempted = b['success'] + b['failed']
            pass_rate = round((b['success'] / attempted * 100) if attempted else 0, 1)
            qa_verdict = 'PASS' if pass_rate >= 80 else ('WARN' if pass_rate >= 50 else 'FAIL')
            results.append({
                'key': key,
                'count': b['total'],
                'success': b['success'],
                'failed': b['failed'],
                'skipped': b['skipped'],
                'pass_rate': pass_rate,
                'qa_verdict': qa_verdict,
            })
        return results

    def _build_report_metadata(
        self,
        metrics_history: List,
        operations_history: List,
        cluster_health_source: str,
        metrics_resolution_note: str,
        execution_id: str,
    ) -> Dict[str, Any]:
        """Provenance for trust: sample counts, optional time range, how cluster health was sourced."""
        first_ts = ''
        last_ts = ''
        if metrics_history:
            first = metrics_history[0]
            last = metrics_history[-1]
            first_ts = str(first.get('timestamp') or first.get('time') or '')
            last_ts = str(last.get('timestamp') or last.get('time') or '')
        return {
            'execution_id': execution_id,
            'generated_at_utc': datetime.now(timezone.utc).isoformat(),
            'metrics_samples': len(metrics_history),
            'operations_recorded': len(operations_history),
            'metrics_time_range': (
                {'first_timestamp': first_ts, 'last_timestamp': last_ts}
                if metrics_history
                else None
            ),
            'cluster_health_source': cluster_health_source,
            'prometheus_configured': bool(self.prometheus_url and str(self.prometheus_url).strip()),
            'baseline_final_resolution': metrics_resolution_note or 'stored',
        }

    def _enrich_historical_trends(
        self,
        historical: Dict,
        status_data: Dict,
        report_data: Dict,
    ) -> Dict:
        """Compare current run to most recent prior execution on the same testbed (when available)."""
        if not historical.get('available') or not historical.get('previous_executions'):
            return historical
        prev = historical['previous_executions'][0]
        if not isinstance(prev, dict):
            return historical
        dur = float(status_data.get('duration_minutes') or report_data.get('duration_minutes') or 0)
        sr = float(status_data.get('success_rate') or report_data.get('success_rate') or 0)
        pdur = float(prev.get('duration_minutes') or 0)
        psr = float(prev.get('success_rate') or 0)
        historical['trend_vs_last_run'] = {
            'duration_delta_minutes': round(dur - pdur, 2),
            'success_rate_delta_pct': round(sr - psr, 2),
            'duration_vs_last': 'faster' if dur < pdur else 'slower' if dur > pdur else 'same',
        }
        return historical

    def _resolve_effective_metrics(
        self,
        baseline_metrics: Dict,
        final_metrics: Dict,
        metrics_history: List,
    ) -> Tuple[Dict, Dict, str]:
        """
        When stored baseline/final are missing or all zeros but metrics_history has samples,
        use first/last samples so reports and capacity math match what the run actually observed.
        """
        bm = dict(baseline_metrics) if isinstance(baseline_metrics, dict) else {}
        fm = dict(final_metrics) if isinstance(final_metrics, dict) else {}
        notes: List[str] = []

        if not metrics_history:
            return bm, fm, 'stored'

        first = metrics_history[0]
        last = metrics_history[-1]
        f_cpu = float(first.get('cpu_percent') or 0)
        f_mem = float(first.get('memory_percent') or 0)
        l_cpu = float(last.get('cpu_percent') or 0)
        l_mem = float(last.get('memory_percent') or 0)

        b_cpu = float(bm.get('cpu_percent') or 0)
        b_mem = float(bm.get('memory_percent') or 0)
        if (b_cpu == 0 and b_mem == 0) and (f_cpu > 0 or f_mem > 0):
            bm['cpu_percent'] = f_cpu
            bm['memory_percent'] = f_mem
            notes.append('baseline_from_first_metric_sample')

        c_cpu = float(fm.get('cpu_percent') or 0)
        c_mem = float(fm.get('memory_percent') or 0)
        if (c_cpu == 0 and c_mem == 0) and (l_cpu > 0 or l_mem > 0):
            fm['cpu_percent'] = l_cpu
            fm['memory_percent'] = l_mem
            notes.append('final_from_last_metric_sample')
        elif c_cpu == 0 and l_cpu > 0:
            fm['cpu_percent'] = l_cpu
            notes.append('final_cpu_from_last_metric_sample')
        elif c_mem == 0 and l_mem > 0:
            fm['memory_percent'] = l_mem
            notes.append('final_memory_from_last_metric_sample')

        return bm, fm, ','.join(notes) if notes else 'stored'

    # ------------------------------------------------------------------
    #  1. SPIKE ANALYSIS
    # ------------------------------------------------------------------
    def _analyze_spikes(self, metrics_history: List, operations_history: List,
                        pod_correlation: Dict, detected_anomalies: List,
                        target_config: Optional[Dict] = None) -> Dict:
        """Detect metric spikes and classify each as one of:

        * **threshold_breach** – CPU or memory exceeded the configured threshold
        * **ml_anomaly_deviation** – an ML IsolationForest anomaly was detected
          within ±1 iteration of this spike
        * **delta_spike** – a raw delta exceeded MIN_SPIKE_DELTA (fallback)
        """
        spikes = []
        if len(metrics_history) < 3:
            return {'spikes': [], 'total_spikes': 0, 'avg_recovery_minutes': 0}

        cpu_threshold = (target_config or {}).get('cpu_threshold', 80)
        mem_threshold = (target_config or {}).get('memory_threshold', 80)

        for i in range(1, len(metrics_history)):
            prev = metrics_history[i - 1]
            curr = metrics_history[i]
            cpu_delta = curr.get('cpu_percent', 0) - prev.get('cpu_percent', 0)
            mem_delta = curr.get('memory_percent', 0) - prev.get('memory_percent', 0)

            is_spike = abs(cpu_delta) >= MIN_SPIKE_DELTA or abs(mem_delta) >= MIN_SPIKE_DELTA
            if not is_spike:
                continue

            spike_ts = curr.get('timestamp', '')
            spike_iter = curr.get('iteration', i)

            causal_ops = self._find_causal_operations(spike_ts, operations_history)
            affected_pods = self._find_affected_pods(spike_ts, causal_ops, pod_correlation)
            recovery_min = self._calculate_recovery_time(metrics_history, i, curr.get('cpu_percent', 0))

            risk = 'low'
            if abs(cpu_delta) > 20 or abs(mem_delta) > 20:
                risk = 'high'
            elif abs(cpu_delta) > 10 or abs(mem_delta) > 10:
                risk = 'medium'

            ml_prediction = self._get_ml_prediction_for_spike(causal_ops)

            # --- spike type classification ---
            curr_cpu = curr.get('cpu_percent', 0)
            curr_mem = curr.get('memory_percent', 0)
            spike_type = 'delta_spike'

            if curr_cpu >= cpu_threshold or curr_mem >= mem_threshold:
                spike_type = 'threshold_breach'

            ml_anomaly_match = next(
                (a for a in detected_anomalies
                 if a.get('type') == 'ml_anomaly'
                 and isinstance(a.get('iteration'), int)
                 and abs(a['iteration'] - spike_iter) <= 1),
                None,
            )
            if ml_anomaly_match:
                spike_type = 'ml_anomaly_deviation'

            # Count operations that ran around this iteration
            ops_in_window = [op for op in operations_history
                             if op.get('iteration') == spike_iter or
                             (isinstance(op.get('iteration'), int) and abs(op.get('iteration', 0) - spike_iter) <= 1)]
            ops_count = len(ops_in_window)
            ops_success = sum(1 for op in ops_in_window if _op_succeeded(op))
            ops_failed = sum(1 for op in ops_in_window if op.get('status') == 'FAILED')

            spikes.append({
                'spike_number': len(spikes) + 1,
                'iteration': spike_iter,
                'timestamp': spike_ts,
                'cpu_before': prev.get('cpu_percent', 0),
                'cpu_after': curr_cpu,
                'cpu_delta': round(cpu_delta, 2),
                'memory_before': prev.get('memory_percent', 0),
                'memory_after': curr_mem,
                'memory_delta': round(mem_delta, 2),
                'risk_level': risk,
                'spike_type': spike_type,
                'threshold_cpu': cpu_threshold,
                'threshold_memory': mem_threshold,
                'ml_anomaly_score': (ml_anomaly_match or {}).get('score'),
                'causal_operations': causal_ops,
                'operation_count': ops_count,
                'operations_success': ops_success,
                'operations_failed': ops_failed,
                'affected_pods': affected_pods[:10],
                'recovery_minutes': round(recovery_min, 1) if recovery_min else None,
                'ml_prediction': ml_prediction,
            })

        recovery_values = [s['recovery_minutes'] for s in spikes if s['recovery_minutes'] is not None]
        avg_recovery = sum(recovery_values) / len(recovery_values) if recovery_values else 0

        return {
            'spikes': spikes,
            'total_spikes': len(spikes),
            'avg_recovery_minutes': round(avg_recovery, 1),
            'high_risk_count': sum(1 for s in spikes if s['risk_level'] == 'high'),
            'medium_risk_count': sum(1 for s in spikes if s['risk_level'] == 'medium'),
            'threshold_breach_count': sum(1 for s in spikes if s.get('spike_type') == 'threshold_breach'),
            'ml_anomaly_count': sum(1 for s in spikes if s.get('spike_type') == 'ml_anomaly_deviation'),
        }

    def _find_causal_operations(self, spike_ts: str, operations_history: List) -> List[Dict]:
        if not spike_ts or not operations_history:
            return []

        try:
            spike_time = datetime.fromisoformat(spike_ts.replace('Z', '+00:00'))
        except Exception:
            return []

        causal = []
        for op in operations_history:
            op_ts = op.get('timestamp') or op.get('started_at', '') or op.get('start_time', '')
            if not op_ts:
                continue
            try:
                op_time = datetime.fromisoformat(op_ts.replace('Z', '+00:00'))
            except Exception:
                continue

            diff = (spike_time - op_time).total_seconds()
            if 0 <= diff <= SPIKE_WINDOW_SECONDS:
                causal.append({
                    'timestamp': op_ts,
                    'entity_type': op.get('entity_type', 'unknown'),
                    'operation': op.get('operation', 'unknown'),
                    'entity_name': op.get('entity_name', 'unknown'),
                    'status': op.get('status', 'UNKNOWN'),
                    'duration_seconds': op.get('duration_seconds', 0),
                    'seconds_before_spike': round(diff, 1),
                })
        return causal

    def _find_affected_pods(self, spike_ts: str, causal_ops: List, pod_correlation: Dict) -> List[Dict]:
        affected = []
        ops_list = pod_correlation.get('operations', [])
        if not ops_list:
            return affected

        causal_names = {op.get('entity_name') for op in causal_ops}
        for op_corr in ops_list:
            if op_corr.get('entity_name') in causal_names:
                for pod in op_corr.get('pods', []):
                    impact = abs(pod.get('cpu_delta', 0)) + abs(pod.get('memory_delta', 0))
                    if impact > 0.1:
                        affected.append({
                            'pod_name': pod.get('pod_name', 'unknown'),
                            'namespace': pod.get('namespace', 'unknown'),
                            'cpu_delta': round(pod.get('cpu_delta', 0), 2),
                            'memory_delta': round(pod.get('memory_delta', 0), 2),
                            'impact_score': round(pod.get('impact_score', 0), 2),
                        })

        affected.sort(key=lambda x: abs(x.get('impact_score', 0)), reverse=True)
        return affected

    def _calculate_recovery_time(self, metrics_history: List, spike_idx: int, spike_cpu: float) -> Optional[float]:
        if spike_idx >= len(metrics_history) - 1:
            return None

        spike_ts_str = metrics_history[spike_idx].get('timestamp', '')
        try:
            spike_time = datetime.fromisoformat(spike_ts_str.replace('Z', '+00:00'))
        except Exception:
            return None

        for j in range(spike_idx + 1, len(metrics_history)):
            cpu = metrics_history[j].get('cpu_percent', 0)
            if cpu <= spike_cpu - RECOVERY_THRESHOLD_PERCENT:
                rec_ts_str = metrics_history[j].get('timestamp', '')
                try:
                    rec_time = datetime.fromisoformat(rec_ts_str.replace('Z', '+00:00'))
                    return (rec_time - spike_time).total_seconds() / 60
                except Exception:
                    return None
        return None

    def _get_ml_prediction_for_spike(self, causal_ops: List) -> Optional[Dict]:
        if not causal_ops:
            return None
        try:
            from services.ml_training_service import get_model_for_testbed
            predictor = get_model_for_testbed()
            if not predictor.is_trained:
                return None

            total_predicted_cpu = 0
            total_predicted_mem = 0
            for op in causal_ops:
                pred = predictor.predict(op['entity_type'], op['operation'], 50, 50)
                if pred:
                    total_predicted_cpu += pred.get('predicted_cpu_impact', 0)
                    total_predicted_mem += pred.get('predicted_memory_impact', 0)

            return {
                'predicted_cpu_impact': round(total_predicted_cpu, 2),
                'predicted_memory_impact': round(total_predicted_mem, 2),
                'model_available': True,
            }
        except Exception:
            return None

    # ------------------------------------------------------------------
    #  2. CLUSTER HEALTH SNAPSHOT
    # ------------------------------------------------------------------
    def _cluster_health_snapshot_usable(self, h: Optional[Dict]) -> bool:
        """True if snapshot can be shown (success, or legacy rows present)."""
        if not h or not isinstance(h, dict):
            return False
        if h.get('collection_status') == 'success':
            return True
        for k in ('node_conditions', 'cpu_throttling', 'oom_killed', 'container_restarts', 'pvc_health'):
            if h.get(k):
                return True
        return False

    def _probe_prometheus(self) -> Tuple[bool, str]:
        """Verify /api/v1/query responds; avoids false success when HTTP fails silently in _prom_query."""
        if not self.prometheus_url:
            return False, 'prometheus_url_not_configured'
        url = urljoin(self.prometheus_url, '/api/v1/query')
        try:
            resp = requests.get(url, params={'query': '1'}, verify=False, timeout=12)
            if resp.status_code != 200:
                return False, f'http_{resp.status_code}'
            data = resp.json()
            if data.get('status') != 'success':
                err = data.get('error') or data.get('errorType') or 'prometheus_query_failed'
                return False, str(err)[:200]
            return True, ''
        except Exception as e:
            return False, str(e)[:200]

    def _collect_cluster_health(
        self,
        execution_window: Optional[Tuple[Optional[str], Optional[str]]] = None,
    ) -> Dict:
        """Collect cluster-health snapshot from Prometheus.

        ``execution_window`` is an optional ``(start_iso, end_iso)`` pair. When
        provided AND ``POD_COVERAGE_V1`` is enabled, additional range queries
        compute the per-pod max CPU% / Mem% / restart deltas / OOM events that
        occurred specifically *during the run*. Without a window, only the
        current/lifetime snapshot is built (legacy behaviour).
        """
        health = {
            'cpu_throttling': [],
            'container_restarts': [],
            'oom_killed': [],
            'node_conditions': [],
            'pvc_health': [],
            'collection_status': 'unavailable',
            'collection_reason': 'prometheus_url_not_configured',
        }
        # Pod-coverage v1 fields — pre-seeded so callers never NPE on missing
        # keys even when Prometheus is down or kube-state-metrics absent.
        if POD_COVERAGE_V1_ENABLED:
            health.update({
                'pod_coverage_v1': True,
                'cluster_summary': {},
                'cluster_allocation': {},
                'node_breakdown': [],
                'container_cpu': [],
                'container_memory': [],
                'window_pod_cpu_max': [],
                'window_pod_memory_max': [],
                'window_restarts': [],
                'window_oom_events': [],
                'execution_window': {},
            })
        if not self.prometheus_url:
            return health

        ok, reason = self._probe_prometheus()
        if not ok:
            health['collection_status'] = 'failed'
            health['collection_reason'] = reason or 'prometheus_unreachable'
            return health

        try:
            url = urljoin(self.prometheus_url, '/api/v1/query')

            # CPU throttling — was ``topk(20, ...)`` which silently dropped pods
            # 21..N. Pod-coverage v1 returns the FULL list (filtered to >1% so
            # noise doesn't dominate), sorted worst-first, capped at
            # ``POD_COVERAGE_MAX_ROWS`` for browser sanity.
            if POD_COVERAGE_V1_ENABLED:
                throttle_query = (
                    'rate(container_cpu_cfs_throttled_periods_total'
                    '{container!="", image!=""}[5m]) / '
                    'rate(container_cpu_cfs_periods_total'
                    '{container!="", image!=""}[5m])'
                )
            else:
                throttle_query = (
                    'topk(20, rate(container_cpu_cfs_throttled_periods_total'
                    '{container!="", image!=""}[5m]) / '
                    'rate(container_cpu_cfs_periods_total'
                    '{container!="", image!=""}[5m]))'
                )
            throttle_data = self._prom_query(url, throttle_query)
            for r in throttle_data:
                m = r.get('metric', {})
                val = r.get('value', [0, 0])
                ratio = float(val[1])
                if ratio > 0.01:
                    ts_epoch = float(val[0]) if val[0] else 0
                    ts_str = datetime.fromtimestamp(ts_epoch, tz=timezone.utc).isoformat() if ts_epoch else ''
                    health['cpu_throttling'].append({
                        'pod': m.get('pod', 'unknown'),
                        'namespace': m.get('namespace', 'unknown'),
                        'container': m.get('container', 'unknown'),
                        'throttle_ratio': round(ratio * 100, 1),
                        'timestamp': ts_str,
                    })
            if POD_COVERAGE_V1_ENABLED and health['cpu_throttling']:
                health['cpu_throttling'].sort(
                    key=lambda x: x.get('throttle_ratio', 0), reverse=True
                )
                health['cpu_throttling'] = health['cpu_throttling'][:POD_COVERAGE_MAX_ROWS]

            # Container restarts in last 1h — same drop-the-cap treatment as
            # throttling above. Filter ``count >= 1`` keeps the list bounded
            # to actually-restarted containers; final cap protects the UI.
            if POD_COVERAGE_V1_ENABLED:
                restart_query = (
                    'increase(kube_pod_container_status_restarts_total'
                    '{container!=""}[1h])'
                )
            else:
                restart_query = (
                    'topk(20, increase(kube_pod_container_status_restarts_total'
                    '{container!=""}[1h]))'
                )
            restart_data = self._prom_query(url, restart_query)
            for r in restart_data:
                m = r.get('metric', {})
                count = float(r.get('value', [0, 0])[1])
                if count >= 1:
                    health['container_restarts'].append({
                        'pod': m.get('pod', 'unknown'),
                        'namespace': m.get('namespace', 'unknown'),
                        'container': m.get('container', 'unknown'),
                        'restart_count': int(count),
                    })
            if POD_COVERAGE_V1_ENABLED and health['container_restarts']:
                health['container_restarts'].sort(
                    key=lambda x: x.get('restart_count', 0), reverse=True
                )
                health['container_restarts'] = health['container_restarts'][:POD_COVERAGE_MAX_ROWS]

            oom_query = (
                'kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}'
            )
            oom_data = self._prom_query(url, oom_query)
            for r in oom_data:
                m = r.get('metric', {})
                val = float(r.get('value', [0, 0])[1])
                if val >= 1:
                    health['oom_killed'].append({
                        'pod': m.get('pod', 'unknown'),
                        'namespace': m.get('namespace', 'unknown'),
                        'container': m.get('container', 'unknown'),
                    })

            cond_query = 'kube_node_status_condition{status="true"}'
            cond_data = self._prom_query(url, cond_query)
            nodes = defaultdict(dict)
            for r in cond_data:
                m = r.get('metric', {})
                node = m.get('node', 'unknown')
                condition = m.get('condition', '')
                nodes[node][condition] = True
            for node, conds in nodes.items():
                health['node_conditions'].append({
                    'node': node,
                    'ready': conds.get('Ready', False),
                    'disk_pressure': conds.get('DiskPressure', False),
                    'memory_pressure': conds.get('MemoryPressure', False),
                    'pid_pressure': conds.get('PIDPressure', False),
                })

            pvc_cap_query = 'kubelet_volume_stats_capacity_bytes'
            pvc_used_query = 'kubelet_volume_stats_used_bytes'
            cap_data = self._prom_query(url, pvc_cap_query)
            used_data = self._prom_query(url, pvc_used_query)
            used_map = {}
            for r in used_data:
                m = r.get('metric', {})
                key = (m.get('namespace', ''), m.get('persistentvolumeclaim', ''))
                used_map[key] = float(r.get('value', [0, 0])[1])
            for r in cap_data:
                m = r.get('metric', {})
                ns = m.get('namespace', '')
                pvc = m.get('persistentvolumeclaim', '')
                cap = float(r.get('value', [0, 0])[1])
                used = used_map.get((ns, pvc), 0)
                pct = (used / cap * 100) if cap > 0 else 0
                if pct > 50:
                    health['pvc_health'].append({
                        'namespace': ns,
                        'pvc_name': pvc,
                        'capacity_gb': round(cap / (1024**3), 2),
                        'used_gb': round(used / (1024**3), 2),
                        'usage_percent': round(pct, 1),
                    })

            # Per-pod CPU usage (normalized by limit where available)
            # Pod-coverage v1 drops the ``topk(30)`` so all pods are visible.
            # Key by ``(pod, namespace)`` not just ``pod`` — two pods with the
            # same name in different namespaces (common with operators) used
            # to collide and inherit the wrong limit.
            if POD_COVERAGE_V1_ENABLED:
                pod_cpu_cores_query = (
                    'sum(rate(container_cpu_usage_seconds_total'
                    '{container!="", container!="POD"}[1m])) by (pod, namespace)'
                )
            else:
                pod_cpu_cores_query = (
                    'topk(30, sum(rate(container_cpu_usage_seconds_total'
                    '{container!="", container!="POD"}[1m])) by (pod, namespace))'
                )
            pod_cpu_limit_query = (
                'sum(kube_pod_container_resource_limits'
                '{resource="cpu", container!=""}) by (pod, namespace)'
            )
            pod_cpu_request_query = (
                'sum(kube_pod_container_resource_requests'
                '{resource="cpu", container!=""}) by (pod, namespace)'
            )
            cpu_cores_data = self._prom_query(url, pod_cpu_cores_query)
            cpu_limit_data = self._prom_query(url, pod_cpu_limit_query)
            cpu_request_data = self._prom_query(url, pod_cpu_request_query)
            cpu_limits: Dict[Tuple[str, str], float] = {}
            for r in cpu_limit_data:
                m = r.get('metric', {})
                limit_cores = float(r.get('value', [0, 0])[1])
                if limit_cores > 0:
                    cpu_limits[(m.get('pod', ''), m.get('namespace', ''))] = limit_cores
            cpu_requests: Dict[Tuple[str, str], float] = {}
            for r in cpu_request_data:
                m = r.get('metric', {})
                req_cores = float(r.get('value', [0, 0])[1])
                if req_cores > 0:
                    cpu_requests[(m.get('pod', ''), m.get('namespace', ''))] = req_cores

            health['pod_cpu'] = []
            for r in cpu_cores_data:
                m = r.get('metric', {})
                pod = m.get('pod', 'unknown')
                ns = m.get('namespace', 'unknown')
                cores = float(r.get('value', [0, 0])[1])
                limit = cpu_limits.get((pod, ns)) or cpu_limits.get((pod, ''))
                request = cpu_requests.get((pod, ns)) or cpu_requests.get((pod, ''))
                # Honest CPU% calculation. The old fallback ``min(cores*100, 100)``
                # made any pod with no limit but ~1 core of usage look like it
                # was pegged at 100% (eg. ntnx-ncm-common/ncm-data-processor-1),
                # which fired bogus "High CPU" entries and poisoned the
                # stability score. New chain:
                #   1. limit defined  -> % of limit, capped at 100
                #   2. request defined -> % of request (NOT capped — burst above
                #      request is normal for burstable QoS pods and the user
                #      should see eg. 250% to know they're burstable)
                #   3. neither       -> cpu_pct = None; UI shows raw cores
                if limit and limit > 0:
                    pct = round(min((cores / limit) * 100, 100.0), 1)
                    basis = 'limit'
                elif request and request > 0:
                    pct = round((cores / request) * 100, 1)
                    basis = 'request'
                else:
                    pct = None
                    basis = 'unspecified'
                health['pod_cpu'].append({
                    'pod': pod,
                    'namespace': ns,
                    'cpu_cores': round(cores, 3),
                    'cpu_limit_cores': round(limit, 3) if limit else None,
                    'cpu_request_cores': round(request, 3) if request else None,
                    'cpu_pct': pct,
                    'cpu_basis': basis,
                })
            if POD_COVERAGE_V1_ENABLED and health['pod_cpu']:
                # Sort by cpu_pct desc, treating None as -1 so unspecified pods
                # land at the bottom (UI shows them with cores instead).
                health['pod_cpu'].sort(
                    key=lambda x: x.get('cpu_pct') if x.get('cpu_pct') is not None else -1,
                    reverse=True,
                )
                health['pod_cpu'] = health['pod_cpu'][:POD_COVERAGE_MAX_ROWS]

            # Per-pod Memory usage — same drop-the-cap treatment, plus joins
            # against the memory limit so the JSON carries ``memory_pct`` and
            # ``memory_limit_mb`` (UI uses them for the 80% colour threshold).
            if POD_COVERAGE_V1_ENABLED:
                pod_mem_query = (
                    'sum(container_memory_working_set_bytes'
                    '{container!="", container!="POD"}) by (pod, namespace)'
                )
            else:
                pod_mem_query = (
                    'topk(30, sum(container_memory_working_set_bytes'
                    '{container!="", container!="POD"}) by (pod, namespace))'
                )
            pod_mem_data = self._prom_query(url, pod_mem_query)
            pod_mem_limits: Dict[Tuple[str, str], float] = {}
            if POD_COVERAGE_V1_ENABLED:
                pod_mem_limit_query = (
                    'sum(kube_pod_container_resource_limits'
                    '{resource="memory", container!=""}) by (pod, namespace)'
                )
                for r in self._prom_query(url, pod_mem_limit_query):
                    m = r.get('metric', {})
                    lim_bytes = float(r.get('value', [0, 0])[1])
                    if lim_bytes > 0:
                        pod_mem_limits[(m.get('pod', ''), m.get('namespace', ''))] = lim_bytes
            health['pod_memory'] = []
            for r in pod_mem_data:
                m = r.get('metric', {})
                pod = m.get('pod', 'unknown')
                ns = m.get('namespace', 'unknown')
                mem_bytes = float(r.get('value', [0, 0])[1])
                lim_bytes = pod_mem_limits.get((pod, ns))
                row = {
                    'pod': pod,
                    'namespace': ns,
                    'memory_mb': round(mem_bytes / (1024 * 1024), 1),
                }
                if lim_bytes:
                    row['memory_limit_mb'] = round(lim_bytes / (1024 * 1024), 1)
                    row['memory_pct'] = round(min(mem_bytes / lim_bytes * 100, 100.0), 1)
                health['pod_memory'].append(row)
            if POD_COVERAGE_V1_ENABLED and health['pod_memory']:
                health['pod_memory'].sort(
                    key=lambda x: x.get('memory_pct', 0) or 0, reverse=True
                )
                health['pod_memory'] = health['pod_memory'][:POD_COVERAGE_MAX_ROWS]

            # ----- Unhealthy pod states (CrashLoopBackOff, ImagePullBackOff, etc.) -----
            waiting_query = 'kube_pod_container_status_waiting_reason{reason!=""}'
            waiting_data = self._prom_query(url, waiting_query)
            health['unhealthy_pods'] = []
            for r in waiting_data:
                m = r.get('metric', {})
                val = float(r.get('value', [0, 0])[1])
                if val >= 1:
                    health['unhealthy_pods'].append({
                        'pod': m.get('pod', 'unknown'),
                        'namespace': m.get('namespace', 'unknown'),
                        'container': m.get('container', 'unknown'),
                        'reason': m.get('reason', 'unknown'),
                    })

            # ----- All termination reasons (OOMKilled, Error, Completed, etc.) -----
            term_query = 'kube_pod_container_status_last_terminated_reason'
            term_data = self._prom_query(url, term_query)
            health['terminated_containers'] = []
            for r in term_data:
                m = r.get('metric', {})
                val_pair = r.get('value', [0, 0])
                val = float(val_pair[1])
                if val >= 1:
                    ts_epoch = float(val_pair[0]) if val_pair[0] else 0
                    sampled_at = datetime.fromtimestamp(ts_epoch, tz=timezone.utc).isoformat() if ts_epoch else ''
                    health['terminated_containers'].append({
                        'pod': m.get('pod', 'unknown'),
                        'namespace': m.get('namespace', 'unknown'),
                        'container': m.get('container', 'unknown'),
                        'reason': m.get('reason', 'unknown'),
                        'sampled_at': sampled_at,
                    })

            # ----- Exit codes for terminated containers -----
            exitcode_query = 'kube_pod_container_status_last_terminated_exitcode{container!=""}'
            exitcode_data = self._prom_query(url, exitcode_query)
            exitcode_map = {}
            for r in exitcode_data:
                m = r.get('metric', {})
                code = int(float(r.get('value', [0, 0])[1]))
                key = f"{m.get('pod','')}/{m.get('namespace','')}/{m.get('container','')}"
                exitcode_map[key] = code
            for tc in health['terminated_containers']:
                key = f"{tc['pod']}/{tc['namespace']}/{tc['container']}"
                tc['exit_code'] = exitcode_map.get(key, None)

            # ----- Cumulative restart count (total restarts ever, not just last 1h) -----
            # Drop the cap so EVERY restart-bearing container shows up; the
            # ``count >= 1`` filter keeps the list bounded to interesting rows
            # and the sort+cap below keeps it browser-friendly.
            if POD_COVERAGE_V1_ENABLED:
                total_restart_query = (
                    'kube_pod_container_status_restarts_total{container!=""}'
                )
            else:
                total_restart_query = (
                    'topk(20, kube_pod_container_status_restarts_total{container!=""})'
                )
            total_restart_data = self._prom_query(url, total_restart_query)
            health['total_restarts'] = []
            for r in total_restart_data:
                m = r.get('metric', {})
                count = float(r.get('value', [0, 0])[1])
                if count >= 1:
                    health['total_restarts'].append({
                        'pod': m.get('pod', 'unknown'),
                        'namespace': m.get('namespace', 'unknown'),
                        'container': m.get('container', 'unknown'),
                        'total_restarts': int(count),
                    })
            if POD_COVERAGE_V1_ENABLED and health['total_restarts']:
                health['total_restarts'].sort(
                    key=lambda x: x.get('total_restarts', 0), reverse=True
                )
                health['total_restarts'] = health['total_restarts'][:POD_COVERAGE_MAX_ROWS]

            # ----- Pod phase distribution (Running, Pending, Failed, Succeeded) -----
            phase_query = 'kube_pod_status_phase{phase!=""}'
            phase_data = self._prom_query(url, phase_query)
            phase_counts: Dict[str, int] = defaultdict(int)
            health['problem_pods'] = []
            for r in phase_data:
                m = r.get('metric', {})
                val = float(r.get('value', [0, 0])[1])
                if val >= 1:
                    phase = m.get('phase', '')
                    phase_counts[phase] += 1
                    if phase in ('Pending', 'Failed', 'Unknown'):
                        health['problem_pods'].append({
                            'pod': m.get('pod', 'unknown'),
                            'namespace': m.get('namespace', 'unknown'),
                            'phase': phase,
                        })
            health['pod_phase_summary'] = dict(phase_counts)

            # ----- Pod not ready (readiness probe failing) -----
            not_ready_query = (
                'kube_pod_status_ready{condition="false"}'
            )
            not_ready_data = self._prom_query(url, not_ready_query)
            health['pods_not_ready'] = []
            for r in not_ready_data:
                m = r.get('metric', {})
                val = float(r.get('value', [0, 0])[1])
                if val >= 1:
                    health['pods_not_ready'].append({
                        'pod': m.get('pod', 'unknown'),
                        'namespace': m.get('namespace', 'unknown'),
                    })

            # ----- API server request latency (P99 over 5m) -----
            api_latency_query = (
                'histogram_quantile(0.99, sum(rate(apiserver_request_duration_seconds_bucket'
                '{verb!="WATCH"}[5m])) by (le, verb, resource))'
            )
            api_latency_data = self._prom_query(url, api_latency_query)
            health['api_server_latency'] = []
            for r in api_latency_data:
                m = r.get('metric', {})
                latency = float(r.get('value', [0, 0])[1])
                if latency > 1.0 and not (latency != latency):  # >1s and not NaN
                    health['api_server_latency'].append({
                        'verb': m.get('verb', ''),
                        'resource': m.get('resource', ''),
                        'p99_seconds': round(latency, 2),
                    })
            health['api_server_latency'].sort(key=lambda x: x['p99_seconds'], reverse=True)
            health['api_server_latency'] = health['api_server_latency'][:15]

            # ----- etcd health -----
            etcd_query = 'etcd_server_has_leader'
            etcd_data = self._prom_query(url, etcd_query)
            health['etcd_healthy'] = True
            for r in etcd_data:
                val = float(r.get('value', [0, 0])[1])
                if val < 1:
                    health['etcd_healthy'] = False

            # ----- Node CPU usage (sum of all pod CPU per node) -----
            node_cpu_query = (
                'sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) by (instance) '
                '/ count(node_cpu_seconds_total{mode="idle"}) by (instance) * 100'
            )
            node_cpu_data = self._prom_query(url, node_cpu_query)
            health['node_cpu'] = []
            for r in node_cpu_data:
                m = r.get('metric', {})
                pct = float(r.get('value', [0, 0])[1])
                health['node_cpu'].append({
                    'instance': m.get('instance', 'unknown'),
                    'cpu_percent': round(pct, 1),
                })

            # ----- Node memory usage -----
            node_mem_query = (
                '(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100'
            )
            node_mem_data = self._prom_query(url, node_mem_query)
            health['node_memory'] = []
            for r in node_mem_data:
                m = r.get('metric', {})
                pct = float(r.get('value', [0, 0])[1])
                health['node_memory'].append({
                    'instance': m.get('instance', 'unknown'),
                    'memory_percent': round(pct, 1),
                })

            # ----- Node filesystem usage -----
            node_disk_query = (
                '(1 - node_filesystem_avail_bytes{mountpoint="/"} '
                '/ node_filesystem_size_bytes{mountpoint="/"}) * 100'
            )
            node_disk_data = self._prom_query(url, node_disk_query)
            health['node_disk'] = []
            for r in node_disk_data:
                m = r.get('metric', {})
                pct = float(r.get('value', [0, 0])[1])
                health['node_disk'].append({
                    'instance': m.get('instance', 'unknown'),
                    'disk_percent': round(pct, 1),
                })

            # ----- Pod restart timestamps (last termination time per container) -----
            # Drop the topk(30); the post-process cap below still keeps the
            # rendered list small. The ``> 0`` filter on the join already
            # restricts the result to containers that have actually terminated.
            if POD_COVERAGE_V1_ENABLED:
                restart_ts_query = (
                    'kube_pod_container_status_restarts_total{container!=""} '
                    '* on(pod, namespace, container) group_left() '
                    '(kube_pod_container_status_last_terminated_finished_at{container!=""} > 0)'
                )
            else:
                restart_ts_query = (
                    'topk(30, kube_pod_container_status_restarts_total{container!=""}) '
                    '* on(pod, namespace, container) group_left() '
                    '(kube_pod_container_status_last_terminated_finished_at{container!=""} > 0)'
                )
            restart_ts_data = self._prom_query(url, restart_ts_query)
            health['restart_timestamps'] = []
            for r in restart_ts_data:
                m = r.get('metric', {})
                ts = float(r.get('value', [0, 0])[1])
                if ts > 0:
                    try:
                        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
                        health['restart_timestamps'].append({
                            'pod': m.get('pod', 'unknown'),
                            'namespace': m.get('namespace', 'unknown'),
                            'container': m.get('container', 'unknown'),
                            'last_terminated_at': dt.isoformat(),
                            'terminated_epoch': ts,
                        })
                    except (OSError, ValueError):
                        pass

            if not health['restart_timestamps']:
                raw_ts_query = (
                    'kube_pod_container_status_last_terminated_finished_at{container!=""} > 0'
                )
                raw_ts_data = self._prom_query(url, raw_ts_query)
                for r in raw_ts_data:
                    m = r.get('metric', {})
                    ts = float(r.get('value', [0, 0])[1])
                    if ts > 0:
                        try:
                            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
                            health['restart_timestamps'].append({
                                'pod': m.get('pod', 'unknown'),
                                'namespace': m.get('namespace', 'unknown'),
                                'container': m.get('container', 'unknown'),
                                'last_terminated_at': dt.isoformat(),
                                'terminated_epoch': ts,
                            })
                        except (OSError, ValueError):
                            pass

            health['restart_timestamps'].sort(
                key=lambda x: x.get('terminated_epoch', 0), reverse=True
            )
            _ts_cap = POD_COVERAGE_MAX_ROWS if POD_COVERAGE_V1_ENABLED else 30
            health['restart_timestamps'] = health['restart_timestamps'][:_ts_cap]

            # Build a map of pod/ns/container → last_terminated_at from restart_timestamps
            ts_map = {}
            for rt in health['restart_timestamps']:
                key = f"{rt.get('pod')}/{rt.get('namespace')}/{rt.get('container')}"
                ts_map[key] = rt.get('last_terminated_at', '')

            # Enrich terminated_containers with actual termination timestamp
            for tc in health['terminated_containers']:
                key = f"{tc.get('pod')}/{tc.get('namespace')}/{tc.get('container')}"
                tc['last_terminated_at'] = ts_map.get(key, tc.get('sampled_at', ''))

            # Enrich total_restarts with last restart timestamp
            for tr in health['total_restarts']:
                key = f"{tr.get('pod')}/{tr.get('namespace')}/{tr.get('container')}"
                tr['last_restart_at'] = ts_map.get(key, '')

            # Collect restart event history via range query (last 48h)
            restart_event_map: Dict[str, List[str]] = {}
            try:
                now_epoch = datetime.now(tz=timezone.utc).timestamp()
                start_48h = now_epoch - 48 * 3600
                range_results = self._prom_range_query(
                    url,
                    'kube_pod_container_status_restarts_total{container!=""}',
                    start_48h, now_epoch, step='120s'
                )
                restart_event_map = self._extract_restart_events(range_results)
            except Exception as e:
                logger.debug(f"Restart event range query failed: {e}")

            for tr in health['total_restarts']:
                key = f"{tr['pod']}/{tr['namespace']}/{tr['container']}"
                tr['restart_history'] = restart_event_map.get(key, [])

            for tc in health['terminated_containers']:
                key = f"{tc['pod']}/{tc['namespace']}/{tc['container']}"
                tc['restart_history'] = restart_event_map.get(key, [])

            # For CPU throttling, collect throttle history via range query (last 6h)
            throttle_history_map: Dict[str, List[dict]] = defaultdict(list)
            try:
                start_6h = now_epoch - 6 * 3600
                throttle_range_q = (
                    'rate(container_cpu_cfs_throttled_periods_total'
                    '{container!="", image!=""}[5m]) / '
                    'rate(container_cpu_cfs_periods_total'
                    '{container!="", image!=""}[5m])'
                )
                throttle_range_results = self._prom_range_query(
                    url, throttle_range_q, start_6h, now_epoch, step='300s'
                )
                for series in throttle_range_results:
                    m = series.get('metric', {})
                    key = f"{m.get('pod','')}/{m.get('namespace','')}/{m.get('container','')}"
                    for ts_epoch, val_str in series.get('values', []):
                        ratio = float(val_str)
                        if ratio > 0.01:
                            dt = datetime.fromtimestamp(float(ts_epoch), tz=timezone.utc)
                            throttle_history_map[key].append({
                                'timestamp': dt.isoformat(),
                                'throttle_pct': round(ratio * 100, 1),
                            })
            except Exception as e:
                logger.debug(f"Throttle range query failed: {e}")

            for t in health['cpu_throttling']:
                key = f"{t['pod']}/{t['namespace']}/{t['container']}"
                t['throttle_history'] = throttle_history_map.get(key, [])

            # ----- Pod-coverage v1: cluster summary, allocation, node
            # breakdown, per-container metrics, and (if a window was supplied)
            # execution-window maxes. Each sub-section is wrapped in its own
            # try/except inside the helper so a missing kube-state-metrics
            # series can't fail the whole collection.
            if POD_COVERAGE_V1_ENABLED:
                try:
                    self._collect_pod_coverage(url, health, execution_window)
                except Exception as cov_err:
                    # Never fatal — main cluster_health stays usable.
                    logger.warning(f"pod_coverage v1 collection failed: {cov_err}")
                    health['pod_coverage_collection_error'] = str(cov_err)[:300]

            health['collection_status'] = 'success'
            health['collection_reason'] = ''
        except Exception as e:
            logger.warning(f"Cluster health collection failed: {e}")
            health['collection_status'] = 'failed'
            health['collection_reason'] = str(e)[:300]

        return health

    # ------------------------------------------------------------------
    #  Pod-coverage v1 — extra Prometheus probes
    # ------------------------------------------------------------------
    def _collect_pod_coverage(
        self,
        url: str,
        health: Dict,
        execution_window: Optional[Tuple[Optional[str], Optional[str]]] = None,
    ) -> None:
        """Populate the pod-coverage v1 fields on ``health``.

        Six independent sub-collectors, each in its own try/except so a single
        missing kube-state-metrics series never breaks the others. Mutates
        ``health`` in place; never raises.
        """
        # 1. Cluster-level KPI counts (nodes / namespaces / pods / containers)
        try:
            health['cluster_summary'] = self._cov_cluster_summary(url)
        except Exception as e:
            logger.debug(f"cluster_summary skipped: {e}")

        # 2. Cluster-level CPU/Mem capacity / requests / limits / utilisation
        try:
            health['cluster_allocation'] = self._cov_cluster_allocation(url)
        except Exception as e:
            logger.debug(f"cluster_allocation skipped: {e}")

        # 3. Per-node breakdown (capacity, pods, containers, usage%)
        try:
            health['node_breakdown'] = self._cov_node_breakdown(url, health)
        except Exception as e:
            logger.debug(f"node_breakdown skipped: {e}")

        # 4. Per-container CPU + Memory tables (was only per-pod before)
        try:
            cc, cm = self._cov_container_tables(url)
            health['container_cpu'] = cc
            health['container_memory'] = cm
        except Exception as e:
            logger.debug(f"container_tables skipped: {e}")

        # 5. Execution-window enrichment (range queries — only if window given)
        start_iso, end_iso = (execution_window or (None, None))
        if start_iso and end_iso:
            try:
                start_epoch = self._iso_to_epoch(start_iso)
                end_epoch = self._iso_to_epoch(end_iso)
                if start_epoch and end_epoch and end_epoch > start_epoch:
                    health['execution_window'] = {
                        'start': start_iso, 'end': end_iso,
                        'duration_seconds': int(end_epoch - start_epoch),
                    }
                    # Build STABLE per-pod limit maps from the already-collected
                    # pod_cpu / pod_memory rows so the window peak % is computed
                    # against a fixed denominator (avoids the per-timestamp KSM
                    # limit-gap 100% artifact). pod_cpu carries cpu_limit_cores;
                    # pod_memory carries memory_limit_mb (→ bytes).
                    cpu_limits_map: Dict[Tuple[str, str], float] = {}
                    for r in (health.get('pod_cpu') or []):
                        lim = r.get('cpu_limit_cores')
                        if lim:
                            cpu_limits_map[(r.get('pod', ''), r.get('namespace', ''))] = float(lim)
                    mem_limits_map: Dict[Tuple[str, str], float] = {}
                    for r in (health.get('pod_memory') or []):
                        lim_mb = r.get('memory_limit_mb')
                        if lim_mb:
                            mem_limits_map[(r.get('pod', ''), r.get('namespace', ''))] = (
                                float(lim_mb) * 1024 * 1024
                            )
                    health['window_pod_cpu_max'] = self._cov_window_pod_cpu_max(
                        url, start_epoch, end_epoch, cpu_limits=cpu_limits_map,
                    )
                    health['window_pod_memory_max'] = self._cov_window_pod_memory_max(
                        url, start_epoch, end_epoch, mem_limits=mem_limits_map,
                    )
                    health['window_restarts'] = self._cov_window_restarts(
                        url, start_epoch, end_epoch
                    )
                    health['window_oom_events'] = self._cov_window_oom_events(
                        url, start_epoch, end_epoch
                    )
            except Exception as e:
                logger.debug(f"execution_window enrichment skipped: {e}")

    @staticmethod
    def _iso_to_epoch(iso: str) -> Optional[float]:
        if not iso:
            return None
        try:
            s = str(iso).replace('Z', '+00:00')
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp()
        except Exception:
            return None

    def _cov_cluster_summary(self, url: str) -> Dict[str, int]:
        """Counts of nodes / namespaces / pods / containers (matches the
        reference performance_report_v4.html ``Cluster Summary`` block)."""

        def _scalar(q: str) -> int:
            res = self._prom_query(url, q)
            if not res:
                return 0
            try:
                return int(float(res[0].get('value', [0, 0])[1]))
            except (TypeError, ValueError, IndexError):
                return 0

        return {
            'nodes': _scalar('count(kube_node_info)'),
            'namespaces': _scalar('count(count by (namespace) (kube_pod_info))'),
            'pods': _scalar('count(kube_pod_info)'),
            'containers': _scalar('count(kube_pod_container_info)'),
        }

    def _cov_cluster_allocation(self, url: str) -> Dict[str, float]:
        """Cluster-wide CPU and memory capacity / requests / limits / live usage.

        Returns absolute values AND percentages-of-capacity so the UI can
        render either form. Memory is reported in GiB to match the reference
        report's units.
        """

        def _sum(q: str) -> float:
            res = self._prom_query(url, q)
            if not res:
                return 0.0
            try:
                return float(res[0].get('value', [0, 0])[1])
            except (TypeError, ValueError, IndexError):
                return 0.0

        cpu_cap = _sum('sum(kube_node_status_capacity{resource="cpu"})')
        cpu_req = _sum('sum(kube_pod_container_resource_requests{resource="cpu"})')
        cpu_lim = _sum('sum(kube_pod_container_resource_limits{resource="cpu"})')
        cpu_use = _sum(
            'sum(rate(container_cpu_usage_seconds_total'
            '{container!="", container!="POD"}[5m]))'
        )

        mem_cap = _sum('sum(kube_node_status_capacity{resource="memory"})')
        mem_req = _sum('sum(kube_pod_container_resource_requests{resource="memory"})')
        mem_lim = _sum('sum(kube_pod_container_resource_limits{resource="memory"})')
        mem_use = _sum(
            'sum(container_memory_working_set_bytes'
            '{container!="", container!="POD"})'
        )

        gib = 1024 ** 3

        def _pct(num: float, denom: float) -> float:
            return round(num / denom * 100, 2) if denom > 0 else 0.0

        return {
            'cpu_capacity_cores': round(cpu_cap, 2),
            'cpu_requests_cores': round(cpu_req, 2),
            'cpu_limits_cores': round(cpu_lim, 2),
            'cpu_usage_cores': round(cpu_use, 3),
            'cpu_requests_pct': _pct(cpu_req, cpu_cap),
            'cpu_limits_pct': _pct(cpu_lim, cpu_cap),
            'cpu_utilization_pct': _pct(cpu_use, cpu_cap),
            'memory_capacity_gib': round(mem_cap / gib, 2),
            'memory_requests_gib': round(mem_req / gib, 2),
            'memory_limits_gib': round(mem_lim / gib, 2),
            'memory_usage_gib': round(mem_use / gib, 2),
            'memory_requests_pct': _pct(mem_req, mem_cap),
            'memory_limits_pct': _pct(mem_lim, mem_cap),
            'memory_utilization_pct': _pct(mem_use, mem_cap),
        }

    def _cov_node_breakdown(self, url: str, health: Dict) -> List[Dict]:
        """Per-node table: pods, containers, CPU/Mem capacity/requests/limits/usage.

        Reuses ``health['node_cpu']`` / ``health['node_memory']`` (already
        collected above) for the live usage% so we don't redundantly query
        Prometheus.
        """
        # Pod / container counts per node
        pods_per_node: Dict[str, int] = {}
        for r in self._prom_query(url, 'count by (node) (kube_pod_info)'):
            try:
                pods_per_node[r['metric'].get('node', '')] = int(float(r['value'][1]))
            except (KeyError, ValueError, TypeError):
                continue
        containers_per_node: Dict[str, int] = {}
        for r in self._prom_query(url, 'count by (node) (kube_pod_container_info)'):
            try:
                containers_per_node[r['metric'].get('node', '')] = int(float(r['value'][1]))
            except (KeyError, ValueError, TypeError):
                continue

        # Per-node capacity / requests / limits (joined via kube_pod_info)
        def _by_node_sum(q: str) -> Dict[str, float]:
            out: Dict[str, float] = {}
            for r in self._prom_query(url, q):
                try:
                    out[r['metric'].get('node', '')] = float(r['value'][1])
                except (KeyError, ValueError, TypeError):
                    continue
            return out

        cpu_cap = _by_node_sum('sum by (node) (kube_node_status_capacity{resource="cpu"})')
        cpu_req = _by_node_sum(
            'sum by (node) (kube_pod_container_resource_requests{resource="cpu"} '
            '* on(pod, namespace) group_left(node) kube_pod_info)'
        )
        cpu_lim = _by_node_sum(
            'sum by (node) (kube_pod_container_resource_limits{resource="cpu"} '
            '* on(pod, namespace) group_left(node) kube_pod_info)'
        )
        mem_cap = _by_node_sum('sum by (node) (kube_node_status_capacity{resource="memory"})')
        mem_req = _by_node_sum(
            'sum by (node) (kube_pod_container_resource_requests{resource="memory"} '
            '* on(pod, namespace) group_left(node) kube_pod_info)'
        )
        mem_lim = _by_node_sum(
            'sum by (node) (kube_pod_container_resource_limits{resource="memory"} '
            '* on(pod, namespace) group_left(node) kube_pod_info)'
        )

        # Live CPU% / Mem% from the existing arrays. Their key is ``instance``
        # (e.g. "10.0.0.1:9100"), which is rarely the same string as the K8s
        # node name. We try to map via kube_node_info; if unmapped, leave the
        # usage column as None and the UI shows "—".
        instance_to_node: Dict[str, str] = {}
        for r in self._prom_query(url, 'kube_node_info'):
            m = r.get('metric', {})
            ip = m.get('internal_ip') or m.get('node_ip') or ''
            node = m.get('node', '')
            if ip and node:
                # Match prometheus instance like "10.0.0.1:9100" → "10.0.0.1"
                instance_to_node[ip] = node
                instance_to_node[f"{ip}:9100"] = node
                instance_to_node[f"{ip}:9101"] = node

        node_cpu_usage: Dict[str, float] = {}
        for row in (health.get('node_cpu') or []):
            inst = row.get('instance', '')
            mapped = instance_to_node.get(inst) or instance_to_node.get(inst.split(':')[0])
            if mapped:
                node_cpu_usage[mapped] = row.get('cpu_percent', 0.0)
        node_mem_usage: Dict[str, float] = {}
        for row in (health.get('node_memory') or []):
            inst = row.get('instance', '')
            mapped = instance_to_node.get(inst) or instance_to_node.get(inst.split(':')[0])
            if mapped:
                node_mem_usage[mapped] = row.get('memory_percent', 0.0)

        gib = 1024 ** 3
        nodes = sorted(set(cpu_cap.keys()) | set(mem_cap.keys()) | set(pods_per_node.keys()))
        out: List[Dict] = []

        def _pct(num: float, denom: float) -> Optional[float]:
            return round(num / denom * 100, 2) if denom > 0 else None

        for node in nodes:
            if not node:
                continue
            cap_cpu = cpu_cap.get(node, 0.0)
            cap_mem = mem_cap.get(node, 0.0)
            out.append({
                'node': node,
                'pods': pods_per_node.get(node, 0),
                'containers': containers_per_node.get(node, 0),
                'cpu_capacity_cores': round(cap_cpu, 2),
                'cpu_requests_cores': round(cpu_req.get(node, 0.0), 2),
                'cpu_limits_cores': round(cpu_lim.get(node, 0.0), 2),
                'cpu_requests_pct': _pct(cpu_req.get(node, 0.0), cap_cpu),
                'cpu_limits_pct': _pct(cpu_lim.get(node, 0.0), cap_cpu),
                'cpu_usage_pct': node_cpu_usage.get(node),
                'memory_capacity_gib': round(cap_mem / gib, 2),
                'memory_requests_gib': round(mem_req.get(node, 0.0) / gib, 2),
                'memory_limits_gib': round(mem_lim.get(node, 0.0) / gib, 2),
                'memory_requests_pct': _pct(mem_req.get(node, 0.0), cap_mem),
                'memory_limits_pct': _pct(mem_lim.get(node, 0.0), cap_mem),
                'memory_usage_pct': node_mem_usage.get(node),
            })
        return out

    def _cov_container_tables(self, url: str) -> Tuple[List[Dict], List[Dict]]:
        """Per-(container, pod, namespace) CPU and Memory snapshots.

        Returns two lists (cpu_rows, memory_rows). Each row carries the
        container's current usage AND its limit/request (when defined), plus a
        ``cpu_pct`` / ``memory_pct`` of-limit percentage that the UI uses for
        threshold colour-coding (>=80% red per product doc).
        """
        # CPU usage per container
        cpu_use_q = (
            'sum(rate(container_cpu_usage_seconds_total'
            '{container!="", container!="POD"}[1m])) by (container, pod, namespace)'
        )
        cpu_lim_q = (
            'sum(kube_pod_container_resource_limits'
            '{resource="cpu", container!=""}) by (container, pod, namespace)'
        )
        cpu_req_q = (
            'sum(kube_pod_container_resource_requests'
            '{resource="cpu", container!=""}) by (container, pod, namespace)'
        )

        def _by_ckey(q: str) -> Dict[Tuple[str, str, str], float]:
            out: Dict[Tuple[str, str, str], float] = {}
            for r in self._prom_query(url, q):
                m = r.get('metric', {})
                key = (
                    m.get('container', ''),
                    m.get('pod', ''),
                    m.get('namespace', ''),
                )
                try:
                    out[key] = float(r['value'][1])
                except (KeyError, ValueError, TypeError):
                    continue
            return out

        cpu_use = _by_ckey(cpu_use_q)
        cpu_lim = _by_ckey(cpu_lim_q)
        cpu_req = _by_ckey(cpu_req_q)

        cpu_rows: List[Dict] = []
        for key, cores in cpu_use.items():
            container, pod, ns = key
            limit = cpu_lim.get(key)
            request = cpu_req.get(key)
            pct = (
                min(cores / limit * 100, 100.0)
                if (limit and limit > 0)
                else min(cores * 100, 100.0)
            )
            cpu_rows.append({
                'container': container,
                'pod': pod,
                'namespace': ns,
                'cpu_cores': round(cores, 4),
                'cpu_limit_cores': round(limit, 4) if limit else None,
                'cpu_request_cores': round(request, 4) if request else None,
                'cpu_pct': round(pct, 2),
            })
        cpu_rows.sort(key=lambda x: x.get('cpu_pct', 0), reverse=True)
        cpu_rows = cpu_rows[:POD_COVERAGE_MAX_ROWS]

        # Memory per container
        mem_use_q = (
            'sum(container_memory_working_set_bytes'
            '{container!="", container!="POD"}) by (container, pod, namespace)'
        )
        mem_lim_q = (
            'sum(kube_pod_container_resource_limits'
            '{resource="memory", container!=""}) by (container, pod, namespace)'
        )
        mem_req_q = (
            'sum(kube_pod_container_resource_requests'
            '{resource="memory", container!=""}) by (container, pod, namespace)'
        )
        mem_use = _by_ckey(mem_use_q)
        mem_lim = _by_ckey(mem_lim_q)
        mem_req = _by_ckey(mem_req_q)

        mb = 1024 * 1024
        mem_rows: List[Dict] = []
        for key, mem_bytes in mem_use.items():
            container, pod, ns = key
            limit_b = mem_lim.get(key)
            req_b = mem_req.get(key)
            pct = (
                min(mem_bytes / limit_b * 100, 100.0)
                if (limit_b and limit_b > 0)
                else 0.0
            )
            row = {
                'container': container,
                'pod': pod,
                'namespace': ns,
                'memory_mb': round(mem_bytes / mb, 1),
            }
            if limit_b:
                row['memory_limit_mb'] = round(limit_b / mb, 1)
                row['memory_pct'] = round(pct, 2)
            if req_b:
                row['memory_request_mb'] = round(req_b / mb, 1)
            mem_rows.append(row)
        mem_rows.sort(
            key=lambda x: x.get('memory_pct', 0) or 0, reverse=True
        )
        mem_rows = mem_rows[:POD_COVERAGE_MAX_ROWS]

        return cpu_rows, mem_rows

    def _cov_window_pod_cpu_max(
        self, url: str, start_epoch: float, end_epoch: float,
        cpu_limits: Optional[Dict[Tuple[str, str], float]] = None,
    ) -> List[Dict]:
        """Per-pod max CPU% (of limit) over the execution window.

        The numerator (peak CPU *usage* in cores) is queried from Prometheus;
        the percentage is computed in Python against a STABLE per-pod CPU limit
        (``cpu_limits``, captured once for the whole report). We deliberately do
        NOT divide by a per-timestamp ``sum(limits) by (pod)`` inside PromQL:
        kube-state-metrics intermittently drops a container's limit series for
        a scrape (pod churn / KSM restart), which momentarily collapses that
        denominator to whatever container survived — e.g. a tiny 26-millicore
        logging sidecar — making an idle pod read a false 100% peak (observed
        on ntnx-ncm-self-service/ncm-calm-2, idle at ~0.025c yet "100%").
        Dividing by the stable limit removes that class of artifact entirely.

        Pods with no known CPU limit are skipped (can't express "% of limit").
        """
        cpu_limits = cpu_limits or {}
        # Numerator only: peak CPU usage in cores per pod over the window.
        q = (
            'sum(rate(container_cpu_usage_seconds_total'
            '{container!="", container!="POD"}[1m])) by (pod, namespace)'
        )
        step = self._range_step_for(end_epoch - start_epoch)
        rows = self._prom_range_query(url, q, start_epoch, end_epoch, step=step)
        out: List[Dict] = []
        for series in rows:
            m = series.get('metric', {})
            pod = m.get('pod', 'unknown')
            ns = m.get('namespace', 'unknown')
            limit = cpu_limits.get((pod, ns)) or cpu_limits.get((pod, ''))
            if not limit or limit <= 0:
                continue  # no stable limit → cannot express as % of limit
            best_cores = -1.0
            best_ts = 0.0
            for ts_str, val_str in series.get('values', []):
                try:
                    v = float(val_str)
                except (TypeError, ValueError):
                    continue
                if v != v:  # skip NaN
                    continue
                if v > best_cores:
                    best_cores = v
                    try:
                        best_ts = float(ts_str)
                    except (TypeError, ValueError):
                        best_ts = 0.0
            if best_cores < 0:
                continue
            out.append({
                'pod': pod,
                'namespace': ns,
                'cpu_pct_max': round(min((best_cores / limit) * 100.0, 100.0), 2),
                'cpu_cores_max': round(best_cores, 4),
                'cpu_limit_cores': round(limit, 4),
                'cpu_pct_max_at': (
                    datetime.fromtimestamp(best_ts, tz=timezone.utc).isoformat()
                    if best_ts else ''
                ),
            })
        out.sort(key=lambda x: x.get('cpu_pct_max', 0), reverse=True)
        return out[:POD_COVERAGE_MAX_ROWS]

    def _cov_window_pod_memory_max(
        self, url: str, start_epoch: float, end_epoch: float,
        mem_limits: Optional[Dict[Tuple[str, str], float]] = None,
    ) -> List[Dict]:
        """Per-pod max Memory% (of limit) over the execution window.

        Peak working-set BYTES are queried, percentage computed in Python
        against the STABLE per-pod memory limit — same rationale as
        ``_cov_window_pod_cpu_max`` (avoids the per-timestamp KSM limit-gap
        artifact). Pods with no known memory limit are skipped.
        """
        mem_limits = mem_limits or {}
        q = (
            'sum(container_memory_working_set_bytes'
            '{container!="", container!="POD"}) by (pod, namespace)'
        )
        step = self._range_step_for(end_epoch - start_epoch)
        rows = self._prom_range_query(url, q, start_epoch, end_epoch, step=step)
        out: List[Dict] = []
        for series in rows:
            m = series.get('metric', {})
            pod = m.get('pod', 'unknown')
            ns = m.get('namespace', 'unknown')
            limit = mem_limits.get((pod, ns)) or mem_limits.get((pod, ''))
            if not limit or limit <= 0:
                continue
            best_bytes = -1.0
            best_ts = 0.0
            for ts_str, val_str in series.get('values', []):
                try:
                    v = float(val_str)
                except (TypeError, ValueError):
                    continue
                if v != v:
                    continue
                if v > best_bytes:
                    best_bytes = v
                    try:
                        best_ts = float(ts_str)
                    except (TypeError, ValueError):
                        best_ts = 0.0
            if best_bytes < 0:
                continue
            out.append({
                'pod': pod,
                'namespace': ns,
                'memory_pct_max': round(min((best_bytes / limit) * 100.0, 100.0), 2),
                'memory_pct_max_at': (
                    datetime.fromtimestamp(best_ts, tz=timezone.utc).isoformat()
                    if best_ts else ''
                ),
            })
        out.sort(key=lambda x: x.get('memory_pct_max', 0), reverse=True)
        return out[:POD_COVERAGE_MAX_ROWS]

    # ------------------------------------------------------------------
    #  v3 — per-pod sparkline series (CPU% / Mem% over execution window)
    # ------------------------------------------------------------------
    def _collect_pod_series(
        self,
        cluster_health: Dict[str, Any],
        execution_window: Tuple[Optional[str], Optional[str]],
        max_pods: int,
        points: int,
    ) -> Dict[Tuple[str, str], Dict[str, List]]:
        """Per-pod CPU% / Mem% sparkline payload for the v3 report.

        Returns ``{(namespace, pod): {'cpu': [[iso_ts, pct], …],
        'memory': [[iso_ts, pct], …]}}`` for the top ``max_pods`` non-healthy
        pods (by usage). Each series is downsampled to ~``points`` points
        (Prometheus picks the step) so the inline SVG stays tiny.

        Returning an empty dict is fine — the renderer just skips the
        sparkline section for pods with no series.
        """
        if not self.prometheus_url:
            return {}
        start_iso, end_iso = execution_window
        if not start_iso:
            return {}
        try:
            start_epoch = self._iso_to_epoch(start_iso)
            end_epoch = (
                self._iso_to_epoch(end_iso) if end_iso
                else datetime.now(tz=timezone.utc).timestamp()
            )
        except Exception:  # noqa: BLE001
            return {}
        duration = max(end_epoch - start_epoch, 60.0)
        # Pick the step so we land near the requested point count.
        step_sec = max(int(duration / max(points, 5)), 30)
        step = f'{step_sec}s'

        # Pick the candidate pods — anything in the existing cpu/mem snapshot
        # above the watch line, plus any pod that already has a window peak.
        # Falling back to the top by current usage when those are empty so
        # we still produce *something* useful for healthy clusters.
        candidates: List[Tuple[str, str, float]] = []
        seen: set = set()

        def _add(ns: str, pod: str, score: float):
            key = (ns, pod)
            if not ns or not pod or key in seen:
                return
            seen.add(key)
            candidates.append((ns, pod, score))

        for r in (cluster_health.get('window_pod_cpu_max') or []):
            _add(r.get('namespace'), r.get('pod'), float(r.get('cpu_pct_max') or 0))
        for r in (cluster_health.get('window_pod_memory_max') or []):
            _add(r.get('namespace'), r.get('pod'), float(r.get('memory_pct_max') or 0))
        for r in (cluster_health.get('pod_cpu') or []):
            _add(r.get('namespace'), r.get('pod'), float(r.get('cpu_pct') or 0))
        for r in (cluster_health.get('pod_memory') or []):
            _add(r.get('namespace'), r.get('pod'), float(r.get('memory_pct') or 0))

        candidates.sort(key=lambda c: c[2], reverse=True)
        candidates = candidates[:max_pods]
        if not candidates:
            return {}

        url = self.prometheus_url

        # Build a label-matcher that only fetches series for the chosen pods —
        # one batched range query each for CPU and Memory keeps round-trips
        # to two regardless of pod count. Escape regex specials in names.
        def _re_escape(s: str) -> str:
            return re.escape(s).replace('/', r'\/')

        pod_re = '|'.join(_re_escape(c[1]) for c in candidates)
        ns_re = '|'.join(sorted({_re_escape(c[0]) for c in candidates}))

        # max_over_time on the limit denominators — see _cov_window_pod_cpu_max
        # for the rationale (stable pod limit across transient KSM gaps).
        cpu_q = (
            f'sum(rate(container_cpu_usage_seconds_total'
            f'{{container!="",container!="POD",pod=~"{pod_re}",namespace=~"{ns_re}"}}[1m])) '
            f'by (pod, namespace) / on(pod, namespace) '
            f'sum(max_over_time(kube_pod_container_resource_limits'
            f'{{resource="cpu", container!="", pod=~"{pod_re}", namespace=~"{ns_re}"}}[10m])) '
            f'by (pod, namespace) * 100'
        )
        mem_q = (
            f'sum(container_memory_working_set_bytes'
            f'{{container!="",container!="POD",pod=~"{pod_re}",namespace=~"{ns_re}"}}) '
            f'by (pod, namespace) / on(pod, namespace) '
            f'sum(max_over_time(kube_pod_container_resource_limits'
            f'{{resource="memory", container!="", pod=~"{pod_re}", namespace=~"{ns_re}"}}[10m])) '
            f'by (pod, namespace) * 100'
        )

        cpu_rows = self._prom_range_query(url, cpu_q, start_epoch, end_epoch, step=step)
        mem_rows = self._prom_range_query(url, mem_q, start_epoch, end_epoch, step=step)

        out: Dict[Tuple[str, str], Dict[str, List]] = {}

        def _to_series(values: List) -> List[List[Any]]:
            series: List[List[Any]] = []
            for ts_str, val_str in values or []:
                try:
                    v = float(val_str)
                    if v != v:                       # skip NaN
                        continue
                    ts = float(ts_str)
                except (TypeError, ValueError):
                    continue
                series.append([
                    datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(),
                    round(min(v, 100.0), 1),
                ])
            return series

        for s in cpu_rows:
            m = s.get('metric', {})
            key = (m.get('namespace', ''), m.get('pod', ''))
            if not key[0] or not key[1]:
                continue
            out.setdefault(key, {'cpu': [], 'memory': []})['cpu'] = _to_series(s.get('values'))

        for s in mem_rows:
            m = s.get('metric', {})
            key = (m.get('namespace', ''), m.get('pod', ''))
            if not key[0] or not key[1]:
                continue
            out.setdefault(key, {'cpu': [], 'memory': []})['memory'] = _to_series(s.get('values'))

        return out

    # ------------------------------------------------------------------
    #  v4 — full-cluster pod metadata (Node, Uptime, Phase) for the table
    # ------------------------------------------------------------------
    def _collect_pod_meta(self) -> Dict[Tuple[str, str], Dict[str, Any]]:
        """One-shot Prometheus pull for every pod in the cluster.

        Returns ``{(namespace, pod): {'node': str, 'uptime_seconds': float,
        'phase': str}}``. The map is the canonical "full pod inventory"
        the v4 table uses to guarantee no missing rows — even pods with
        zero per-pod metric samples will get an entry here.

        Falls back to an empty dict on any query failure; callers treat
        an empty meta as "no metadata available, render '—' in the
        table" so the report never breaks.
        """
        if not self.prometheus_url:
            return {}
        # ``_prom_query`` expects the fully-qualified ``/api/v1/query`` URL,
        # not the base host. Earlier we passed the base URL by mistake which
        # silently returned 0 rows because Prometheus rejected the request.
        url = urljoin(self.prometheus_url.rstrip('/') + '/', 'api/v1/query')
        out: Dict[Tuple[str, str], Dict[str, Any]] = {}

        # 1. kube_pod_info → pod ↔ node mapping (and seeds the inventory).
        try:
            for r in (self._prom_query(url, 'kube_pod_info') or []):
                m = r.get('metric', {})
                ns = m.get('namespace')
                pod = m.get('pod')
                if not ns or not pod:
                    continue
                out.setdefault((ns, pod), {})['node'] = m.get('node') or m.get('host_ip') or None
        except Exception as exc:  # noqa: BLE001
            logger.debug("kube_pod_info query failed: %s", exc)

        # 2. kube_pod_start_time (epoch seconds) → uptime.
        try:
            now_ts = datetime.now(tz=timezone.utc).timestamp()
            for r in (self._prom_query(url, 'kube_pod_start_time') or []):
                m = r.get('metric', {})
                ns = m.get('namespace')
                pod = m.get('pod')
                if not ns or not pod:
                    continue
                val = (r.get('value') or [None, None])[1]
                try:
                    start_epoch = float(val)
                except (TypeError, ValueError):
                    continue
                uptime = max(now_ts - start_epoch, 0.0)
                slot = out.setdefault((ns, pod), {})
                slot['uptime_seconds'] = round(uptime, 1)
        except Exception as exc:  # noqa: BLE001
            logger.debug("kube_pod_start_time query failed: %s", exc)

        # 3. kube_pod_status_phase{phase=…}=1 → current phase.
        try:
            for r in (self._prom_query(url, 'kube_pod_status_phase == 1') or []):
                m = r.get('metric', {})
                ns = m.get('namespace')
                pod = m.get('pod')
                phase = m.get('phase')
                if not ns or not pod or not phase:
                    continue
                slot = out.setdefault((ns, pod), {})
                # Last writer wins, but Prometheus only emits the row whose
                # value is 1 so there's effectively just one phase per pod.
                slot['phase'] = phase
        except Exception as exc:  # noqa: BLE001
            logger.debug("kube_pod_status_phase query failed: %s", exc)

        return out

    @staticmethod
    def _iso_to_epoch(iso: str) -> float:
        """ISO 8601 → Unix epoch (UTC). Naive-aware safe."""
        dt = datetime.fromisoformat(iso.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()

    def _cov_window_restarts(
        self, url: str, start_epoch: float, end_epoch: float
    ) -> List[Dict]:
        """Restart events that happened DURING the execution window only.

        Range-queries the cumulative restart counter and detects upward steps
        in the series (delta > 0). Output: one row per (pod, ns, container)
        that restarted at least once in the window, with first/last restart
        timestamps and the count.
        """
        step = self._range_step_for(end_epoch - start_epoch, prefer_dense=True)
        rows = self._prom_range_query(
            url,
            'kube_pod_container_status_restarts_total{container!=""}',
            start_epoch, end_epoch, step=step,
        )
        out: List[Dict] = []
        for series in rows:
            m = series.get('metric', {})
            values = series.get('values', [])
            timestamps: List[float] = []
            prev: Optional[float] = None
            for ts_str, val_str in values:
                try:
                    cur = float(val_str)
                    ts = float(ts_str)
                except (TypeError, ValueError):
                    continue
                if prev is not None and cur > prev:
                    timestamps.append(ts)
                prev = cur
            if not timestamps:
                continue
            out.append({
                'pod': m.get('pod', 'unknown'),
                'namespace': m.get('namespace', 'unknown'),
                'container': m.get('container', 'unknown'),
                'restarts_in_window': len(timestamps),
                'first_restart_at': datetime.fromtimestamp(
                    min(timestamps), tz=timezone.utc).isoformat(),
                'last_restart_at': datetime.fromtimestamp(
                    max(timestamps), tz=timezone.utc).isoformat(),
            })
        out.sort(key=lambda x: x.get('restarts_in_window', 0), reverse=True)
        return out[:POD_COVERAGE_MAX_ROWS]

    def _cov_window_oom_events(
        self, url: str, start_epoch: float, end_epoch: float
    ) -> List[Dict]:
        """OOMKilled events whose ``last_terminated_finished_at`` falls inside
        the execution window. (Prometheus doesn't expose a counter of OOM
        events, only the ``last_terminated_reason``, so we filter by the
        sampled timestamp on each series.)
        """
        rows = self._prom_query(
            url,
            'kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}',
        )
        if not rows:
            return []
        ts_rows = self._prom_query(
            url,
            'kube_pod_container_status_last_terminated_finished_at{container!=""} > 0',
        )
        ts_map: Dict[str, float] = {}
        for r in ts_rows:
            m = r.get('metric', {})
            try:
                ts_map[
                    f"{m.get('pod','')}/{m.get('namespace','')}/{m.get('container','')}"
                ] = float(r['value'][1])
            except (KeyError, ValueError, TypeError):
                continue
        out: List[Dict] = []
        for r in rows:
            m = r.get('metric', {})
            try:
                val = float(r['value'][1])
            except (KeyError, ValueError, TypeError):
                continue
            if val < 1:
                continue
            key = f"{m.get('pod','')}/{m.get('namespace','')}/{m.get('container','')}"
            ts = ts_map.get(key)
            if ts is None or not (start_epoch <= ts <= end_epoch):
                continue
            out.append({
                'pod': m.get('pod', 'unknown'),
                'namespace': m.get('namespace', 'unknown'),
                'container': m.get('container', 'unknown'),
                'oom_at': datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(),
            })
        out.sort(key=lambda x: x.get('oom_at', ''), reverse=True)
        return out

    @staticmethod
    def _range_step_for(duration_sec: float, prefer_dense: bool = False) -> str:
        """Pick a sane Prometheus step for a range query.

        The Prometheus default series cap is 11 000 samples per series, so we
        size the step to keep us under it. Short runs (<1 h) use 30 s for
        smooth max-detection; multi-hour runs scale up to 60 s/5 m/15 m.
        ``prefer_dense=True`` pushes one notch finer (used for restart-event
        detection where missing a step can lose a restart).
        """
        if duration_sec <= 60 * 60:           # ≤1 h
            return '30s' if prefer_dense else '60s'
        if duration_sec <= 6 * 3600:          # ≤6 h
            return '60s' if prefer_dense else '120s'
        if duration_sec <= 24 * 3600:         # ≤1 d
            return '120s' if prefer_dense else '300s'
        if duration_sec <= 72 * 3600:         # ≤3 d
            return '300s' if prefer_dense else '600s'
        return '600s' if prefer_dense else '900s'

    def _prom_query(self, url: str, query: str) -> List:
        try:
            resp = requests.get(url, params={'query': query}, verify=False, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                if data.get('status') == 'success':
                    return data.get('data', {}).get('result', [])
        except Exception as e:
            logger.debug(f"Prometheus query failed ({query[:60]}...): {e}")
        return []

    def _prom_range_query(self, base_url: str, query: str,
                          start_epoch: float, end_epoch: float,
                          step: str = '60s') -> List:
        """Prometheus range query (/api/v1/query_range)."""
        range_url = base_url.replace('/api/v1/query', '/api/v1/query_range')
        try:
            resp = requests.get(range_url, params={
                'query': query,
                'start': start_epoch,
                'end': end_epoch,
                'step': step,
            }, verify=False, timeout=20)
            if resp.status_code == 200:
                data = resp.json()
                if data.get('status') == 'success':
                    return data.get('data', {}).get('result', [])
        except Exception as e:
            logger.debug(f"Prometheus range query failed ({query[:60]}...): {e}")
        return []

    def _extract_restart_events(self, range_results: List) -> Dict[str, List[str]]:
        """Given range query results for kube_pod_container_status_restarts_total,
        find timestamps where the counter incremented (i.e. a restart occurred).
        Returns {pod/namespace/container: [iso_timestamps]}."""
        events: Dict[str, List[str]] = defaultdict(list)
        for series in range_results:
            m = series.get('metric', {})
            key = f"{m.get('pod','')}/{m.get('namespace','')}/{m.get('container','')}"
            values = series.get('values', [])
            prev_val = None
            for ts_epoch, val_str in values:
                cur_val = float(val_str)
                if prev_val is not None and cur_val > prev_val:
                    dt = datetime.fromtimestamp(float(ts_epoch), tz=timezone.utc)
                    events[key].append(dt.isoformat())
                prev_val = cur_val
        return dict(events)

    # ------------------------------------------------------------------
    #  3. FAILURE ROOT CAUSE GROUPING
    # ------------------------------------------------------------------
    def _group_failures(self, operations_history: List) -> Dict:
        """Group failed operations by normalized error pattern.

        Each group now includes ``sample_failures`` (first 5 individual
        failures with full API details for drill-down) and
        ``http_status_distribution`` (count of each HTTP status code).
        """
        failed_ops = [op for op in operations_history if op.get('status') == 'FAILED']
        if not failed_ops:
            return {'groups': [], 'total_failures': 0, 'unique_patterns': 0}

        groups: Dict[str, list] = defaultdict(list)
        for op in failed_ops:
            error = op.get('error', '') or op.get('error_message', '') or 'Unknown error'
            key = self._normalize_error(error)
            groups[key].append(op)

        result_groups = []
        for error_pattern, ops in sorted(groups.items(), key=lambda x: -len(x[1])):
            entity_types = list({op.get('entity_type', 'unknown') for op in ops})
            operations = list({op.get('operation', 'unknown') for op in ops})
            timestamps = [op.get('start_time') or op.get('timestamp', '') for op in ops
                          if op.get('start_time') or op.get('timestamp')]

            first_ts = min(timestamps) if timestamps else ''
            last_ts = max(timestamps) if timestamps else ''

            # HTTP status distribution across this failure group
            status_counter: Dict[str, int] = defaultdict(int)
            for op in ops:
                code = op.get('http_status_code')
                status_counter[str(code) if code else 'N/A'] += 1

            # ALL failures with full API details for triage drill-down
            sample_failures = []
            for op in ops:
                sample_failures.append({
                    'entity_type': op.get('entity_type'),
                    'operation': op.get('operation'),
                    'entity_name': op.get('entity_name'),
                    'api_url': op.get('api_url'),
                    'http_method': op.get('http_method'),
                    'http_status_code': op.get('http_status_code'),
                    'request_payload': op.get('request_payload'),
                    'response_body': op.get('response_body'),
                    'error': (op.get('error') or '')[:500],
                    'timestamp': op.get('start_time') or op.get('timestamp', ''),
                    'duration_seconds': op.get('duration_seconds'),
                    'iteration': op.get('iteration'),
                })

            result_groups.append({
                'error_pattern': error_pattern,
                'count': len(ops),
                'entity_types': entity_types,
                'operations': operations,
                'first_occurrence': first_ts,
                'last_occurrence': last_ts,
                'sample_error': (ops[0].get('error', '') or ops[0].get('error_message', ''))[:300],
                'root_cause_hint': self._infer_root_cause(error_pattern, ops),
                'http_status_distribution': dict(status_counter),
                'sample_failures': sample_failures,
                'retryable': self._is_retryable(error_pattern),
            })

        # Failure timeline: when bursts happened
        failure_timeline = []
        for op in failed_ops:
            ts = op.get('start_time') or op.get('timestamp', '')
            if ts:
                failure_timeline.append({
                    'timestamp': ts,
                    'entity_type': op.get('entity_type'),
                    'operation': op.get('operation'),
                    'error_pattern': self._normalize_error(op.get('error', '') or '')[:80],
                    'iteration': op.get('iteration'),
                })

        return {
            'groups': result_groups,
            'total_failures': len(failed_ops),
            'unique_patterns': len(result_groups),
            'failure_timeline': failure_timeline,
        }

    def _is_retryable(self, pattern: str) -> bool:
        """Heuristic: is this error pattern likely retryable?"""
        p = pattern.lower()
        retryable_hints = ['timeout', 'timed out', 'connection refused',
                           'service unavailable', '503', '502', '429',
                           'too many requests', 'temporary', 'retry']
        return any(h in p for h in retryable_hints)

    def _normalize_error(self, error: str) -> str:
        error = re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<UUID>', error)
        error = re.sub(r'smart-\w+-\d+-\w+', '<ENTITY_NAME>', error)
        error = re.sub(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}', '<TIMESTAMP>', error)
        error = re.sub(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', '<IP>', error)
        return error[:200].strip()

    def _infer_root_cause(self, pattern: str, ops: List) -> str:
        p = pattern.lower()
        entity_types = {op.get('entity_type', '').lower() for op in ops}

        if 'kcanceled' in p or 'kcancelled' in p:
            return 'NCM task was cancelled by the system — Prism Central may be overloaded or restarting services'
        if 'task timed out' in p or 'task_timeout' in p:
            return 'NCM async task did not complete in time — check Prism Central task queue depth and Ergon service'
        if '429' in p or 'rate limit' in p or 'too many requests' in p:
            return 'Prism Central API rate limit hit — reduce parallel operations or add entity cooldown'
        if 'timeout' in p or 'timed out' in p or 'connecttimeouterror' in p:
            return 'API response time degraded under high cluster load — check PC/NCM pod resource limits'
        if 'connection' in p and ('refused' in p or 'reset' in p):
            return 'Service endpoint became unavailable — possible pod restart or OOMKill (check cluster_health tab)'
        if 'ssl' in p or 'certificate' in p or 'handshake' in p:
            return 'TLS/SSL error connecting to Prism Central — certificate or port mismatch'
        if 'not found' in p or '404' in p:
            if any(et in ('blueprint', 'application', 'marketplace item') for et in entity_types):
                return 'Blueprint/App not found — likely deleted during concurrent operations or IDF sync lag'
            return 'Dependent entity was deleted or never created successfully — check cascade failures'
        if 'quota' in p or 'limit' in p or 'insufficient' in p:
            return 'Resource quota or capacity limit reached — check project quotas and AHV host resources'
        if 'already exists' in p or 'duplicate' in p or 'unique constraint' in p:
            return 'Entity name collision from a previous failed cleanup — run cleanup before re-executing'
        if 'unauthorized' in p or '401' in p or '403' in p or 'forbidden' in p:
            return 'Authentication / authorization issue — verify PC credentials and RBAC role assignments'
        if 'validation' in p or 'invalid' in p or 'spec validation' in p:
            return 'NCM API spec validation error — entity payload has missing or invalid fields'
        if '500' in p or 'internal server' in p or 'internal_error' in p:
            if any(et in ('blueprint', 'application') for et in entity_types):
                return 'Calm engine internal error under load — check xi-calm-app pod logs and memory'
            return 'Server-side error under load — infrastructure service degradation'
        if '503' in p or 'service unavailable' in p:
            return 'NCM service temporarily unavailable — pods may be restarting or under memory pressure'
        if 'power' in p and ('already' in p or 'invalid state' in p):
            return 'VM power state conflict — VM already in requested state or mid-transition'
        if 'disk' in p and ('space' in p or 'capacity' in p or 'full' in p):
            return 'Storage capacity exhausted — check AHV storage containers and CVM disk usage'
        if 'subnet' in p and ('ip' in p or 'address' in p or 'exhausted' in p):
            return 'Subnet IP address pool exhausted — expand the IP range or use a different subnet'
        if 'image' in p and ('not found' in p or 'unavailable' in p):
            return 'Disk image not found on cluster — ensure image is uploaded and available on target cluster'
        if 'cluster' in p and ('unreachable' in p or 'offline' in p):
            return 'Target AHV cluster is unreachable from Prism Central — check network connectivity'
        return 'Review error details for specific root cause'

    # ------------------------------------------------------------------
    #  4. OPERATION TIMING HEATMAP
    # ------------------------------------------------------------------
    def _build_operation_heatmap(self, operations_history: List) -> Dict:
        if not operations_history:
            return {'buckets': [], 'entity_ops': [], 'data': {}, 'row_totals': {}}

        timestamps = []
        for op in operations_history:
            ts = op.get('timestamp') or op.get('started_at') or op.get('start_time')
            if ts:
                try:
                    timestamps.append(datetime.fromisoformat(ts.replace('Z', '+00:00')))
                except Exception:
                    pass

        if not timestamps:
            return {'buckets': [], 'entity_ops': [], 'data': {}, 'row_totals': {}}

        start = min(timestamps)
        end = max(timestamps)
        total_minutes = max((end - start).total_seconds() / 60, 1)
        bucket_minutes = max(30, int(total_minutes / 12))

        buckets = []
        t = start
        while t <= end:
            buckets.append(t)
            t += timedelta(minutes=bucket_minutes)

        entity_ops = set()
        for op in operations_history:
            key = f"{op.get('entity_type', '?')}.{op.get('operation', '?')}"
            entity_ops.add(key)
        entity_ops = sorted(entity_ops)

        data = {}
        for eo in entity_ops:
            data[eo] = {}
            for bi, b in enumerate(buckets):
                data[eo][bi] = {'count': 0, 'avg_duration': 0, 'failures': 0, 'durations': []}

        for op in operations_history:
            ts = op.get('timestamp') or op.get('started_at') or op.get('start_time')
            if not ts:
                continue
            try:
                op_time = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            except Exception:
                continue

            key = f"{op.get('entity_type', '?')}.{op.get('operation', '?')}"
            bi = min(int((op_time - start).total_seconds() / 60 / bucket_minutes), len(buckets) - 1)
            cell = data[key][bi]
            cell['count'] += 1
            cell['durations'].append(op.get('duration_seconds', 0))
            if op.get('status') == 'FAILED':
                cell['failures'] += 1

        for eo in entity_ops:
            for bi in data[eo]:
                cell = data[eo][bi]
                if cell['durations']:
                    cell['avg_duration'] = round(sum(cell['durations']) / len(cell['durations']), 1)
                    cell['failure_rate'] = round(cell['failures'] / cell['count'] * 100, 1) if cell['count'] else 0
                del cell['durations']

        bucket_labels = []
        for b in buckets:
            minutes_from_start = (b - start).total_seconds() / 60
            if minutes_from_start < 60:
                bucket_labels.append(f"{int(minutes_from_start)}m")
            else:
                bucket_labels.append(f"{minutes_from_start / 60:.1f}h")

        row_totals: Dict[str, int] = {}
        for eo in entity_ops:
            row_totals[eo] = sum(data[eo][bi]['count'] for bi in data[eo])

        return {
            'buckets': bucket_labels,
            'entity_ops': entity_ops,
            'data': data,
            'bucket_minutes': bucket_minutes,
            'row_totals': row_totals,
        }

    # ------------------------------------------------------------------
    #  5. POD STABILITY SCORING
    # ------------------------------------------------------------------
    def _compute_pod_stability(self, pod_correlation: Dict, cluster_health: Dict) -> List[Dict]:
        pod_map = defaultdict(lambda: {
            'cpu_max': 0, 'memory_max_mb': 0,
            'impact_events': 0, 'total_cpu_delta': 0,
            'cpu_cores': 0, 'cpu_limit_cores': None,
        })

        for op_data in pod_correlation.get('operations', []):
            for pod in op_data.get('pods', []):
                name = pod.get('pod_name', 'unknown')
                p = pod_map[name]
                p['namespace'] = pod.get('namespace', 'unknown')
                raw_cpu = pod.get('cpu_after', 0)
                # Pre-upgrade data stored raw cores×100; normalize to bounded percentage
                if raw_cpu > 100:
                    p['cpu_cores'] = max(p['cpu_cores'], round(raw_cpu / 100, 3))
                    raw_cpu = 100.0
                p['cpu_max'] = max(p['cpu_max'], raw_cpu)
                p['memory_max_mb'] = max(p['memory_max_mb'], pod.get('memory_after', 0))
                p['impact_events'] += 1
                p['total_cpu_delta'] += abs(pod.get('cpu_delta', 0))

        def _ensure_pod(name: str, namespace: str) -> None:
            if not name or name == 'unknown':
                return
            if name not in pod_map:
                pod_map[name] = {
                    'namespace': namespace or 'unknown',
                    'cpu_max': 0, 'memory_max_mb': 0,
                    'impact_events': 0, 'total_cpu_delta': 0,
                    'cpu_cores': 0, 'cpu_limit_cores': None,
                }

        for r in cluster_health.get('container_restarts', []):
            _ensure_pod(r.get('pod'), r.get('namespace', 'unknown'))
        for t in cluster_health.get('cpu_throttling', []):
            _ensure_pod(t.get('pod'), t.get('namespace', 'unknown'))
        for o in cluster_health.get('oom_killed', []):
            _ensure_pod(o.get('pod'), o.get('namespace', 'unknown'))
        for u in cluster_health.get('unhealthy_pods', []):
            _ensure_pod(u.get('pod'), u.get('namespace', 'unknown'))
        for tr in cluster_health.get('total_restarts', []):
            _ensure_pod(tr.get('pod'), tr.get('namespace', 'unknown'))
        for pp in cluster_health.get('problem_pods', []):
            _ensure_pod(pp.get('pod'), pp.get('namespace', 'unknown'))

        # Enrich from live Prometheus pod_cpu and pod_memory data
        cpu_map: Dict[str, Dict] = {}
        for entry in cluster_health.get('pod_cpu', []):
            pod = entry.get('pod', '')
            if pod:
                cpu_map[pod] = entry
                _ensure_pod(pod, entry.get('namespace', 'unknown'))

        mem_map: Dict[str, float] = {}
        for entry in cluster_health.get('pod_memory', []):
            pod = entry.get('pod', '')
            if pod:
                mem_map[pod] = entry.get('memory_mb', 0)
                _ensure_pod(pod, entry.get('namespace', 'unknown'))

        # Fill cpu_max/memory_max_mb from Prometheus when pod_correlation didn't provide values.
        # cpu_pct may now be None when the pod has neither limit nor request set
        # (cpu_basis='unspecified') — preserve None so the report can render
        # "1.02 cores (no limit)" instead of fabricating a misleading "100%".
        for pod_name, info in pod_map.items():
            if info['cpu_max'] == 0 and pod_name in cpu_map:
                info['cpu_max'] = cpu_map[pod_name].get('cpu_pct')  # may be None
                info['cpu_cores'] = cpu_map[pod_name].get('cpu_cores', 0)
                info['cpu_limit_cores'] = cpu_map[pod_name].get('cpu_limit_cores')
                info['cpu_basis'] = cpu_map[pod_name].get('cpu_basis', 'limit')
            if info['memory_max_mb'] == 0 and pod_name in mem_map:
                info['memory_max_mb'] = mem_map[pod_name]

        # Recent restarts (increase in last 1h) per pod
        restart_map: Dict[str, int] = defaultdict(int)
        for r in cluster_health.get('container_restarts', []):
            restart_map[r['pod']] += r.get('restart_count', 0)

        # Total cumulative restarts (ever) per pod
        total_restart_map: Dict[str, int] = defaultdict(int)
        for tr in cluster_health.get('total_restarts', []):
            total_restart_map[tr['pod']] = max(total_restart_map[tr['pod']], tr.get('total_restarts', 0))

        # Usage-weighted pod throttle — v2 (bug fix 2026-06-03).
        #
        # CPU throttling is per-CONTAINER in the source data. Old code took
        # ``max()`` across containers — let a 26m sidecar at 99% poison a
        # 1.4-core main container at 0%.
        #
        # Aggregation:
        #
        #   throttle_pod = Σ(throttle_i × cores_i) / Σ(cores_i)
        #
        # CRITICAL — the sum has to span EVERY container in the pod, not
        # only the throttled ones. cAdvisor only emits
        # ``container_cpu_cfs_throttled_periods_total`` for containers
        # that have throttled at least once. v1 of this fix iterated only
        # ``cpu_throttling``, so the unthrottled main container's
        # 0% × big-cores never entered the denominator and the weighted
        # average collapsed back to ~max(). Example caught on
        # ncm-policy-7ffc9994f9-2khr2:
        #   sidecar: 1.1m cores, 81.8% throttled (1 row)
        #   main:    4.2m cores,  0% throttled (NO row)
        #   v1 said: (81.8×1.1)/1.1 = 81.8%   (sidecar-only denominator)
        #   v2 says: (81.8×1.1 + 0×4.2)/5.3 = 17.0%   (correct)
        #
        # v2 algorithm:
        #   1. Build full per-pod container roster from container_cpu
        #      (every container's cores, throttled or not).
        #   2. Look up throttle ratio per container; default 0 when no row.
        #   3. weight_sum = Σ(cores_i) over ALL containers in the pod.
        #   4. weighted_sum = Σ(ratio_i × cores_i) over ALL containers.
        # Fallback to max() only when container_cpu is empty (no usage
        # data) so idle pods with cAdvisor-reported throttling still
        # surface a non-zero signal.
        pod_containers: Dict[str, Dict[str, float]] = defaultdict(dict)
        for entry in cluster_health.get('container_cpu', []) or []:
            try:
                cores = float(entry.get('cpu_cores') or 0)
            except (TypeError, ValueError):
                continue
            pod_containers[entry.get('pod', '')][entry.get('container', '')] = cores

        throttle_for_pod: Dict[str, Dict[str, float]] = defaultdict(dict)
        for t in cluster_health.get('cpu_throttling', []):
            pod = t.get('pod', '')
            container = t.get('container', '')
            ratio = float(t.get('throttle_ratio') or 0)
            throttle_for_pod[pod][container] = ratio

        throttle_map: Dict[str, float] = {}
        throttle_top: Dict[str, Dict[str, Any]] = {}
        for pod, throttles in throttle_for_pod.items():
            containers = pod_containers.get(pod, {})

            weighted_sum = 0.0
            weight_sum = 0.0
            max_ratio = 0.0
            top_info: Optional[Dict[str, Any]] = None

            if containers:
                # Primary path: weight every container by its cores so an
                # unthrottled main container correctly dilutes a tiny
                # over-throttled sidecar.
                for container, cores in containers.items():
                    ratio = throttles.get(container, 0.0)
                    weighted_sum += ratio * cores
                    weight_sum += cores
                    if ratio > max_ratio:
                        max_ratio = ratio
                        top_info = {
                            'container': container,
                            'throttle_ratio': round(ratio, 1),
                            'cpu_cores': round(cores, 3),
                        }
                # Pick up containers with throttling but no container_cpu
                # row (rare collection race) — for "top container"
                # provenance only; they have 0 weight.
                for container, ratio in throttles.items():
                    if container not in containers and ratio > max_ratio:
                        max_ratio = ratio
                        top_info = {
                            'container': container,
                            'throttle_ratio': round(ratio, 1),
                            'cpu_cores': 0.0,
                        }
            else:
                # No container_cpu data — fall back to max() so we don't
                # silently drop signals for idle pods.
                for container, ratio in throttles.items():
                    if ratio > max_ratio:
                        max_ratio = ratio
                        top_info = {
                            'container': container,
                            'throttle_ratio': round(ratio, 1),
                            'cpu_cores': 0.0,
                        }
                weighted_sum = max_ratio
                weight_sum = 1.0

            throttle_map[pod] = weighted_sum / weight_sum if weight_sum > 0 else max_ratio
            if top_info is not None:
                throttle_top[pod] = top_info

        oom_set = {o['pod'] for o in cluster_health.get('oom_killed', [])}

        # Unhealthy state map (CrashLoopBackOff, ImagePullBackOff, etc.)
        unhealthy_map: Dict[str, str] = {}
        for u in cluster_health.get('unhealthy_pods', []):
            pod = u.get('pod', '')
            if pod:
                existing = unhealthy_map.get(pod, '')
                reason = u.get('reason', '')
                unhealthy_map[pod] = f"{existing}, {reason}" if existing else reason

        # All termination reasons per pod
        termination_map: Dict[str, List[str]] = defaultdict(list)
        for tc in cluster_health.get('terminated_containers', []):
            pod = tc.get('pod', '')
            reason = tc.get('reason', '')
            if pod and reason and reason not in termination_map[pod]:
                termination_map[pod].append(reason)

        # Problem pods (Pending/Failed phase)
        problem_phase_map: Dict[str, str] = {}
        for pp in cluster_health.get('problem_pods', []):
            pod = pp.get('pod', '')
            if pod:
                problem_phase_map[pod] = pp.get('phase', 'Unknown')

        # Pods not ready
        not_ready_set = {nr.get('pod', '') for nr in cluster_health.get('pods_not_ready', [])}

        # Last termination timestamps per pod
        last_terminated_map: Dict[str, str] = {}
        for rt in cluster_health.get('restart_timestamps', []):
            pod = rt.get('pod', '')
            if pod and pod not in last_terminated_map:
                last_terminated_map[pod] = rt.get('last_terminated_at', '')

        results = []
        for pod_name, info in pod_map.items():
            restarts = restart_map.get(pod_name, 0)
            total_restarts = total_restart_map.get(pod_name, 0)
            throttle = throttle_map.get(pod_name, 0)
            oom = pod_name in oom_set
            unhealthy_reason = unhealthy_map.get(pod_name, '')
            term_reasons = termination_map.get(pod_name, [])
            phase = problem_phase_map.get(pod_name, '')
            not_ready = pod_name in not_ready_set

            score = 100
            score -= min(restarts * 10, 30)
            score -= min(throttle * 0.5, 20)
            if oom:
                score -= 25
            if 'CrashLoopBackOff' in unhealthy_reason:
                score -= 30
            elif unhealthy_reason:
                score -= 15
            if phase in ('Failed', 'Unknown'):
                score -= 20
            if not_ready:
                score -= 10
            # cpu_max may be None when the pod has no CPU limit/request
            # (cpu_basis='unspecified'). In that case we genuinely don't know
            # whether the pod is overloaded — don't dock the score on a guess.
            cpu_max_val = info.get('cpu_max')
            if cpu_max_val is not None:
                if cpu_max_val > 90:
                    score -= 10
                elif cpu_max_val > 70:
                    score -= 5
            score = max(0, round(score))

            results.append({
                'pod_name': pod_name,
                'namespace': info.get('namespace', 'unknown'),
                'stability_score': score,
                'restarts': restarts,
                'total_restarts': total_restarts,
                'cpu_throttle_pct': round(throttle, 1),
                # Per-container provenance for the pod-level throttle value.
                # Empty when no container in this pod has throttling > 1%.
                'throttle_top_container': throttle_top.get(pod_name),
                'oom_killed': oom,
                'unhealthy_reason': unhealthy_reason,
                'termination_reasons': term_reasons,
                'pod_phase': phase,
                'not_ready': not_ready,
                'max_cpu_pct': round(cpu_max_val, 1) if cpu_max_val is not None else None,
                'cpu_basis': info.get('cpu_basis'),
                'cpu_cores': round(info.get('cpu_cores', 0), 3),
                'cpu_limit_cores': info.get('cpu_limit_cores'),
                'max_memory_mb': round(info['memory_max_mb'], 1),
                'impact_events': info['impact_events'],
                'last_terminated_at': last_terminated_map.get(pod_name, ''),
            })

        results.sort(key=lambda x: x['stability_score'])
        return results[:40]

    # ------------------------------------------------------------------
    #  5b. NODE STABILITY SCORING
    # ------------------------------------------------------------------
    def _compute_node_stability(self, cluster_health: Dict) -> List[Dict]:
        """Score each Kubernetes node 0-100 based on conditions, CPU, memory, disk."""
        node_map: Dict[str, Dict] = {}

        for nc in cluster_health.get('node_conditions', []):
            node = nc.get('node', 'unknown')
            node_map[node] = {
                'ready': nc.get('Ready', False),
                'disk_pressure': nc.get('disk_pressure', nc.get('DiskPressure', False)),
                'memory_pressure': nc.get('memory_pressure', nc.get('MemoryPressure', False)),
                'pid_pressure': nc.get('pid_pressure', nc.get('PIDPressure', False)),
                'cpu_percent': 0,
                'memory_percent': 0,
                'disk_percent': 0,
                'pod_count': 0,
                'restart_count': 0,
                'oom_count': 0,
            }

        if not node_map:
            return []

        def _match_node(instance: str) -> Optional[str]:
            """Match a Prometheus instance label to a known node name."""
            for name in node_map:
                if name in instance or instance.split(':')[0] in name:
                    return name
            if len(node_map) == 1:
                return next(iter(node_map))
            return None

        for entry in cluster_health.get('node_cpu', []):
            n = _match_node(entry.get('instance', ''))
            if n:
                node_map[n]['cpu_percent'] = entry.get('cpu_percent', 0)

        for entry in cluster_health.get('node_memory', []):
            n = _match_node(entry.get('instance', ''))
            if n:
                node_map[n]['memory_percent'] = entry.get('memory_percent', 0)

        for entry in cluster_health.get('node_disk', []):
            n = _match_node(entry.get('instance', ''))
            if n:
                node_map[n]['disk_percent'] = entry.get('disk_percent', 0)

        results = []
        for node_name, info in node_map.items():
            score = 100

            if not info['ready']:
                score -= 30
            if info['disk_pressure']:
                score -= 15
            if info['memory_pressure']:
                score -= 15
            if info['pid_pressure']:
                score -= 10

            cpu = info['cpu_percent']
            if cpu > 90:
                score -= 15
            elif cpu > 80:
                score -= 10
            elif cpu > 70:
                score -= 5

            mem = info['memory_percent']
            if mem > 90:
                score -= 15
            elif mem > 80:
                score -= 10
            elif mem > 70:
                score -= 5

            disk = info['disk_percent']
            if disk > 90:
                score -= 15
            elif disk > 80:
                score -= 10
            elif disk > 70:
                score -= 5

            score = max(0, round(score))

            pressures = []
            if info['disk_pressure']:
                pressures.append('Disk')
            if info['memory_pressure']:
                pressures.append('Memory')
            if info['pid_pressure']:
                pressures.append('PID')

            results.append({
                'node_name': node_name,
                'stability_score': score,
                'ready': info['ready'],
                'cpu_percent': round(cpu, 1),
                'memory_percent': round(mem, 1),
                'disk_percent': round(disk, 1),
                'pressures': pressures,
                'pressure_summary': ', '.join(pressures) if pressures else 'None',
            })

        results.sort(key=lambda x: x['stability_score'])
        return results

    # ------------------------------------------------------------------
    #  6. HISTORICAL COMPARISON
    # ------------------------------------------------------------------
    def _get_historical_comparison(self, testbed_id: Optional[str], current_execution_id: str) -> Dict:
        if not testbed_id:
            return {'available': False, 'reason': 'No testbed ID'}

        try:
            from database import SessionLocal
            from sqlalchemy import text

            session = SessionLocal()
            try:
                # metrics_history in Python — works on PostgreSQL and avoids jsonb-only functions in SQL
                query = text("""
                    SELECT execution_id, status, duration_minutes, total_operations,
                           successful_operations, failed_operations, success_rate,
                           start_time, end_time,
                           baseline_metrics, final_metrics, metrics_history
                    FROM smart_executions
                    WHERE testbed_id = :testbed_id
                      AND execution_id != :current_id
                      AND status IN ('COMPLETED', 'TIMEOUT', 'STOPPED', 'LONGEVITY_SUSTAINING')
                    ORDER BY start_time DESC
                    LIMIT 5
                """)
                rows = session.execute(query, {
                    'testbed_id': testbed_id,
                    'current_id': current_execution_id
                }).fetchall()
            finally:
                session.close()

            if not rows:
                return {'available': False, 'reason': 'No previous executions on this testbed'}

            history = []
            for r in rows:
                baseline = r[9] if r[9] else {}
                final = r[10] if r[10] else {}
                mh = r[11] if len(r) > 11 else None
                if isinstance(baseline, str):
                    try:
                        baseline = json.loads(baseline)
                    except Exception:
                        baseline = {}
                if isinstance(final, str):
                    try:
                        final = json.loads(final)
                    except Exception:
                        final = {}
                if isinstance(mh, str):
                    try:
                        mh = json.loads(mh)
                    except Exception:
                        mh = []
                iter_count = len(mh) if isinstance(mh, list) else 0

                history.append({
                    'execution_id': r[0],
                    'status': r[1],
                    'duration_minutes': round(r[2], 1) if r[2] else 0,
                    'total_operations': r[3] or 0,
                    'iterations': iter_count,
                    'success_rate': round(r[6], 1) if r[6] else 0,
                    'start_time': r[7].isoformat() if r[7] else '',
                    'baseline_cpu': baseline.get('cpu_percent', 0) if isinstance(baseline, dict) else 0,
                    'final_cpu': final.get('cpu_percent', 0) if isinstance(final, dict) else 0,
                })

            return {
                'available': True,
                'previous_executions': history,
                'count': len(history),
            }

        except Exception as e:
            logger.debug(f"Historical comparison unavailable: {e}")
            return {'available': False, 'reason': str(e)}

    # ------------------------------------------------------------------
    #  7. CAPACITY PLANNING
    # ------------------------------------------------------------------
    def _estimate_capacity(self, operations_history: List, metrics_history: List,
                           baseline_metrics: Dict, final_metrics: Dict,
                           report_data: Dict) -> Dict:
        if not operations_history or not metrics_history:
            return {'available': False}

        total_ops = len(operations_history)
        real_ops = sum(1 for op in operations_history if op.get('mode') == 'REAL')
        simulated_ops = total_ops - real_ops
        baseline_cpu = baseline_metrics.get('cpu_percent', 0)
        final_cpu = final_metrics.get('cpu_percent', 0)
        baseline_mem = baseline_metrics.get('memory_percent', 0)
        final_mem = final_metrics.get('memory_percent', 0)

        cpu_delta = final_cpu - baseline_cpu
        mem_delta = final_mem - baseline_mem

        # Use positive delta when load increased; fall back to step-change accumulation
        cpu_per_op = (max(cpu_delta, 0) / total_ops) if total_ops > 0 and cpu_delta > 0 else 0
        mem_per_op = (max(mem_delta, 0) / total_ops) if total_ops > 0 and mem_delta > 0 else 0

        # If net deltas are zero/negative (load dropped or flat), use step-change accumulation
        if total_ops > 0 and cpu_per_op == 0 and mem_per_op == 0 and len(metrics_history) >= 2:
            cpu_move = sum(
                abs(
                    float(metrics_history[i + 1].get('cpu_percent') or 0)
                    - float(metrics_history[i].get('cpu_percent') or 0)
                )
                for i in range(len(metrics_history) - 1)
            )
            mem_move = sum(
                abs(
                    float(metrics_history[i + 1].get('memory_percent') or 0)
                    - float(metrics_history[i].get('memory_percent') or 0)
                )
                for i in range(len(metrics_history) - 1)
            )
            cpu_per_op = cpu_move / total_ops
            mem_per_op = mem_move / total_ops

        target_cpu = report_data.get('target_config', {}).get('cpu_threshold', 80)
        target_mem = report_data.get('target_config', {}).get('memory_threshold', 80)

        remaining_cpu = max(0, target_cpu - final_cpu)
        remaining_mem = max(0, target_mem - final_mem)

        additional_ops_cpu = int(remaining_cpu / cpu_per_op) if cpu_per_op > 0 else 999
        additional_ops_mem = int(remaining_mem / mem_per_op) if mem_per_op > 0 else 999

        bottleneck = 'cpu' if additional_ops_cpu < additional_ops_mem else 'memory'
        max_additional = min(additional_ops_cpu, additional_ops_mem)

        entity_counts = defaultdict(int)
        for op in operations_history:
            if _op_succeeded(op) and op.get('operation', '').lower() == 'create':
                entity_counts[op.get('entity_type', 'unknown')] += 1

        result = {
            'available': True,
            'total_ops_executed': total_ops,
            'real_ops': real_ops,
            'simulated_ops': simulated_ops,
            'cpu_per_operation': round(cpu_per_op, 3),
            'memory_per_operation': round(mem_per_op, 3),
            'cpu_delta_direction': 'increased' if cpu_delta > 0 else ('decreased' if cpu_delta < 0 else 'flat'),
            'memory_delta_direction': 'increased' if mem_delta > 0 else ('decreased' if mem_delta < 0 else 'flat'),
            'estimated_max_additional_ops': max_additional if max_additional < 999 else None,
            'estimated_total_capacity_ops': total_ops + max_additional if max_additional < 999 else None,
            'bottleneck': bottleneck,
            'entities_created': dict(entity_counts),
            'recommendation': self._capacity_recommendation(cpu_per_op, mem_per_op, final_cpu, final_mem, bottleneck),
        }
        if simulated_ops > 0:
            result['simulation_warning'] = (
                f'{simulated_ops}/{total_ops} operations were SIMULATED '
                f'(NCM client unavailable). Capacity estimates may be inaccurate.'
            )
        return result

    def _capacity_recommendation(self, cpu_per_op: float, mem_per_op: float,
                                 final_cpu: float, final_mem: float, bottleneck: str) -> str:
        if final_cpu > 90 or final_mem > 90:
            return 'Cluster is near saturation. Scale up (add nodes) before running more workloads.'
        if final_cpu > 75 or final_mem > 75:
            return f'Approaching limits. Bottleneck is {bottleneck.upper()}. Consider scaling before production use.'
        return 'Cluster has headroom. Current workload profile is sustainable.'

    # ------------------------------------------------------------------
    #  8. ML INSIGHTS FOR REPORT
    # ------------------------------------------------------------------
    def _get_ml_report_insights(self, testbed_id: Optional[str]) -> Dict:
        try:
            from services.ml_training_service import get_ml_insights
            return get_ml_insights(testbed_id)
        except Exception as e:
            logger.debug(f"ML insights unavailable: {e}")
            return {'model_status': 'unavailable'}

    # ------------------------------------------------------------------
    #  9. VERDICT
    # ------------------------------------------------------------------
    def _compute_verdict(self, report_data: Dict, status_data: Dict,
                         spike_analysis: Dict, cluster_health: Dict,
                         failure_groups: Dict, operations_history: List,
                         metrics_history: List) -> Dict:
        status = report_data.get('status') or status_data.get('status', 'UNKNOWN')
        total_ops = len(operations_history)
        skipped_ops = sum(1 for op in operations_history if op.get('status') == 'SKIPPED')
        failed_ops = failure_groups.get('total_failures', 0)
        countable_ops = total_ops - skipped_ops
        if countable_ops > 0:
            success_rate = ((countable_ops - failed_ops) / countable_ops * 100)
        else:
            stored_rate = float(status_data.get('success_rate') or report_data.get('success_rate') or 0)
            success_rate = stored_rate if stored_rate > 0 else 100

        threshold_reached = report_data.get('threshold_reached', False) or status_data.get('threshold_reached', False)
        oom_count = len(cluster_health.get('oom_killed', []))
        if oom_count == 0:
            prt = report_data.get('pod_restart_tracking') or status_data.get('pod_restart_tracking') or {}
            for rev in (prt.get('restart_events') or []):
                if rev.get('restart_reason') == 'OOMKilled' or rev.get('exit_code') == 137:
                    oom_count += 1
        restart_count = sum(r.get('restart_count', 0) for r in cluster_health.get('container_restarts', []))
        high_risk_spikes = spike_analysis.get('high_risk_count', 0)

        issues = []

        if status == 'FAILED':
            verdict = 'FAIL'
            issues.append('Execution crashed or encountered a fatal error')
        elif status == 'COMPLETED' and threshold_reached:
            verdict = 'PASS'
        elif status == 'TIMEOUT':
            verdict = 'WARN'
            issues.append('Execution timed out before reaching target threshold')
        elif status == 'STOPPED':
            verdict = 'WARN'
            issues.append('Execution was manually stopped')
        elif status == 'THRESHOLD_REACHED':
            verdict = 'PASS'
        else:
            verdict = 'PASS' if success_rate > 80 else 'WARN'

        if oom_count > 0:
            verdict = 'WARN' if verdict == 'PASS' else verdict
            issues.append(f'{oom_count} container(s) OOMKilled during execution')
        prt = (report_data.get('pod_restart_tracking')
               or status_data.get('pod_restart_tracking')
               or (report_data.get('full_execution_data', {}) or {}).get('pod_restart_tracking')
               or {})
        continuous_restarts = prt.get('total_restarts_during_execution', 0)
        effective_restart_count = max(restart_count, continuous_restarts)
        if effective_restart_count > 3:
            verdict = 'WARN' if verdict == 'PASS' else verdict
            if continuous_restarts > 0:
                issues.append(f'{continuous_restarts} container restarts during execution '
                              f'({prt.get("pods_restarted", 0)} pods affected)')
            else:
                issues.append(f'{restart_count} container restarts detected')
        if success_rate < 70:
            verdict = 'FAIL'
            issues.append(f'Low success rate: {success_rate:.1f}%')
        elif success_rate < 85:
            verdict = 'WARN' if verdict == 'PASS' else verdict
            issues.append(f'Below-target success rate: {success_rate:.1f}%')
        if high_risk_spikes > 3:
            verdict = 'WARN' if verdict == 'PASS' else verdict
            issues.append(f'{high_risk_spikes} high-risk metric spikes detected')

        node_pressure = any(
            n.get('disk_pressure') or n.get('memory_pressure') or n.get('pid_pressure')
            for n in cluster_health.get('node_conditions', [])
        )
        if node_pressure:
            verdict = 'WARN' if verdict == 'PASS' else verdict
            issues.append('Node pressure condition detected (Disk/Memory/PID)')

        crashloop_pods = [u for u in cluster_health.get('unhealthy_pods', []) if u.get('reason') == 'CrashLoopBackOff']
        if crashloop_pods:
            verdict = 'FAIL' if len(crashloop_pods) > 2 else ('WARN' if verdict == 'PASS' else verdict)
            issues.append(f'{len(crashloop_pods)} pod(s) in CrashLoopBackOff')
        imgpull_pods = [u for u in cluster_health.get('unhealthy_pods', []) if u.get('reason') == 'ImagePullBackOff']
        if imgpull_pods:
            verdict = 'WARN' if verdict == 'PASS' else verdict
            issues.append(f'{len(imgpull_pods)} pod(s) stuck in ImagePullBackOff')

        failed_pods = [pp for pp in cluster_health.get('problem_pods', []) if pp.get('phase') == 'Failed']
        if failed_pods:
            verdict = 'WARN' if verdict == 'PASS' else verdict
            issues.append(f'{len(failed_pods)} pod(s) in Failed phase')
        pending_pods = [pp for pp in cluster_health.get('problem_pods', []) if pp.get('phase') == 'Pending']
        if len(pending_pods) > 2:
            verdict = 'WARN' if verdict == 'PASS' else verdict
            issues.append(f'{len(pending_pods)} pod(s) stuck in Pending phase')

        if cluster_health.get('etcd_healthy') is False:
            verdict = 'FAIL'
            issues.append('etcd cluster has no leader — critical infrastructure failure')

        slow_apis = [a for a in cluster_health.get('api_server_latency', []) if a.get('p99_seconds', 0) > 5]
        if slow_apis:
            verdict = 'WARN' if verdict == 'PASS' else verdict
            worst = max(a.get('p99_seconds', 0) for a in slow_apis)
            issues.append(f'{len(slow_apis)} API endpoint(s) with P99 latency > 5s (worst: {worst:.1f}s)')

        not_ready_count = len(cluster_health.get('pods_not_ready', []))
        if not_ready_count > 3:
            verdict = 'WARN' if verdict == 'PASS' else verdict
            issues.append(f'{not_ready_count} pods not ready (readiness probe failing)')

        if not threshold_reached and status == 'COMPLETED':
            issues.append('Execution completed but threshold was not reached — consider adding more entity types')

        simulated_count = sum(1 for op in operations_history if op.get('mode') == 'SIMULATED')
        if simulated_count > 0:
            sim_pct = round(simulated_count / max(1, total_ops) * 100, 1)
            issues.append(f'{simulated_count} operations ({sim_pct}%) were SIMULATED — results may not reflect real NCM behavior')
            if sim_pct > 50:
                verdict = 'WARN' if verdict == 'PASS' else verdict

        summary_line = ''
        if verdict == 'PASS':
            summary_line = f'Cluster sustained target load with {success_rate:.0f}% success rate and no service disruptions.'
        elif verdict == 'WARN':
            summary_line = f'Execution completed with warnings — {len(issues)} issue(s) require attention.'
        else:
            summary_line = f'Execution encountered critical issues — {len(issues)} issue(s) need investigation.'

        # QA-specific entity breakdown for the verdict
        entity_qa: Dict[str, Dict[str, int]] = defaultdict(lambda: {'ok': 0, 'fail': 0, 'skip': 0})
        for op in operations_history:
            key = f"{op.get('entity_type', '?')}.{op.get('operation', '?')}"
            s = (op.get('status') or '').upper()
            if _op_succeeded(op):
                entity_qa[key]['ok'] += 1
            elif s == 'FAILED':
                entity_qa[key]['fail'] += 1
            else:
                entity_qa[key]['skip'] += 1

        qa_entity_results = []
        for key, v in sorted(entity_qa.items()):
            attempted = v['ok'] + v['fail']
            rate = round((v['ok'] / attempted * 100) if attempted else 0, 1)
            qa_entity_results.append({
                'operation': key,
                'success': v['ok'],
                'failed': v['fail'],
                'skipped': v['skip'],
                'pass_rate': rate,
                'verdict': 'PASS' if rate >= 80 else ('WARN' if rate >= 50 else 'FAIL'),
            })

        target_config = report_data.get('target_config') or status_data.get('target_config') or {}
        final_cpu = 0
        final_mem = 0
        if metrics_history:
            last = metrics_history[-1]
            final_cpu = last.get('cpu_percent', 0)
            final_mem = last.get('memory_percent', 0)

        return {
            'result': verdict,
            'summary': summary_line,
            'issues': issues,
            'success_rate': round(success_rate, 1),
            'threshold_reached': threshold_reached,
            'oom_kills': oom_count,
            'container_restarts': restart_count,
            'high_risk_spikes': high_risk_spikes,
            'qa_summary': {
                'total_operations': total_ops or int(status_data.get('total_operations') or report_data.get('total_operations') or 0),
                'successful': (total_ops - failed_ops - skipped_ops) or int(status_data.get('successful_operations') or report_data.get('successful_operations') or 0),
                'failed': failed_ops or int(status_data.get('failed_operations') or report_data.get('failed_operations') or 0),
                'skipped': skipped_ops,
                'target_cpu': target_config.get('cpu_threshold'),
                'target_memory': target_config.get('memory_threshold'),
                'final_cpu': round(final_cpu, 1),
                'final_memory': round(final_mem, 1),
                'entity_results': qa_entity_results,
            },
        }

    # ------------------------------------------------------------------
    #  10. LATENCY REPORT
    # ------------------------------------------------------------------
    def _build_latency_report(self, status_data: Dict) -> Dict:
        """Extract latency percentiles from execution status for the report."""
        ls = status_data.get('latency_summary') or {}
        overall = ls.get('overall', {})
        per_op = ls.get('per_operation', {})

        if not overall:
            return {'available': False}

        # Find slowest and fastest operations
        slowest_op = max(per_op.items(), key=lambda x: x[1].get('avg', 0)) if per_op else (None, {})
        fastest_op = min(per_op.items(), key=lambda x: x[1].get('avg', float('inf'))) if per_op else (None, {})

        return {
            'available': True,
            'overall': overall,
            'per_operation': per_op,
            'slowest_operation': {'name': slowest_op[0], **slowest_op[1]} if slowest_op[0] else None,
            'fastest_operation': {'name': fastest_op[0], **fastest_op[1]} if fastest_op[0] else None,
            'degradation_detected': self._detect_latency_degradation(status_data),
        }

    def _detect_latency_degradation(self, status_data: Dict) -> bool:
        """Check if API latency increased significantly over the execution."""
        ops = status_data.get('operations_history') or []
        if len(ops) < 10:
            return False
        early = [o.get('duration_seconds', 0) for o in ops[:len(ops)//3] if o.get('duration_seconds')]
        late = [o.get('duration_seconds', 0) for o in ops[-len(ops)//3:] if o.get('duration_seconds')]
        if not early or not late:
            return False
        early_avg = sum(early) / len(early)
        late_avg = sum(late) / len(late)
        return late_avg > early_avg * 1.5

    # ------------------------------------------------------------------
    #  11a. PER-ENTITY-TYPE LATENCY BREAKDOWN
    # ------------------------------------------------------------------
    def _build_entity_latency_breakdown(self, operations_history: List) -> Dict:
        """Latency stats per entity_type — helps QA identify which NCM service is bottlenecked."""
        if not operations_history:
            return {'available': False}

        buckets: Dict[str, List[float]] = defaultdict(list)
        for op in operations_history:
            dur = op.get('duration_seconds')
            if dur is None or dur <= 0:
                continue
            key = f"{op.get('entity_type', '?')}.{op.get('operation', '?')}"
            buckets[key].append(dur)

        rows = []
        for key, durations in sorted(buckets.items(), key=lambda x: -(sum(x[1]) / len(x[1]))):
            durations_sorted = sorted(durations)
            n = len(durations_sorted)
            p50 = durations_sorted[n // 2] if n else 0
            p95 = durations_sorted[int(n * 0.95)] if n >= 2 else durations_sorted[-1]
            avg = sum(durations_sorted) / n
            early_avg = sum(durations_sorted[:max(1, n // 3)]) / max(1, n // 3)
            late_avg = sum(durations_sorted[-(max(1, n // 3)):]) / max(1, n // 3)
            degraded = late_avg > early_avg * 1.5 if early_avg > 0 and n >= 6 else False
            rows.append({
                'entity_operation': key,
                'count': n,
                'avg_seconds': round(avg, 2),
                'p50_seconds': round(p50, 2),
                'p95_seconds': round(p95, 2),
                'min_seconds': round(durations_sorted[0], 2),
                'max_seconds': round(durations_sorted[-1], 2),
                'degradation_detected': degraded,
            })

        return {'available': True, 'entity_latencies': rows}

    # ------------------------------------------------------------------
    #  11b. HTTP ERROR CODE BREAKDOWN
    # ------------------------------------------------------------------
    def _build_error_code_breakdown(self, operations_history: List) -> Dict:
        """Group failures by HTTP status code and NCM error type for QA triage."""
        failed = [op for op in operations_history if (op.get('status') or '').upper() == 'FAILED']
        if not failed:
            return {'available': False}

        by_http_code: Dict[str, int] = defaultdict(int)
        by_error_type: Dict[str, int] = defaultdict(int)
        ncm_errors: List[Dict] = []

        for op in failed:
            code = op.get('http_status_code') or op.get('error_code')
            etype = op.get('error_type') or 'Unknown'
            err_msg = op.get('error') or ''

            code_key = str(code) if code else 'unknown'
            by_http_code[code_key] += 1
            by_error_type[etype] += 1

            ncm_errors.append({
                'entity_type': op.get('entity_type', '?'),
                'operation': op.get('operation', '?'),
                'http_code': code_key,
                'error_type': etype,
                'error_snippet': (err_msg or '')[:200],
                'iteration': op.get('iteration'),
            })

        code_distribution = [
            {'code': k, 'count': v, 'category': 'client_error' if k.startswith('4') else ('server_error' if k.startswith('5') else 'other')}
            for k, v in sorted(by_http_code.items(), key=lambda x: -x[1])
        ]
        type_distribution = [
            {'error_type': k, 'count': v}
            for k, v in sorted(by_error_type.items(), key=lambda x: -x[1])
        ]

        return {
            'available': True,
            'total_failures': len(failed),
            'http_code_distribution': code_distribution,
            'error_type_distribution': type_distribution,
            'sample_errors': ncm_errors[:20],
        }

    # ------------------------------------------------------------------
    #  11c. DEPENDENCY CASCADE DETECTION
    # ------------------------------------------------------------------
    def _detect_dependency_cascades(self, operations_history: List) -> Dict:
        """Detect patterns where one entity type's failures cascade to dependents."""
        DEPENDENCY_MAP = {
            'Application': ['Blueprint', 'Project'],
            'Blueprint': ['Project', 'Image', 'Subnet'],
            'Blueprint (Single VM)': ['Project', 'Image', 'Subnet'],
            'Blueprint (Multi VM)': ['Project', 'Image', 'Subnet'],
            'Marketplace Item': ['Blueprint', 'Project'],
            'VM': ['Image', 'Subnet', 'Cluster'],
            'Runbook': ['Endpoint'],
            'Playbook': ['Category'],
            'Scenario': ['VM'],
            'Budget Alert': ['Budget'],
            'Environment': ['Project', 'Subnet'],
        }
        failed = [op for op in operations_history if (op.get('status') or '').upper() == 'FAILED']
        if not failed:
            return {'available': False, 'cascades': []}

        failed_entities: Dict[str, int] = defaultdict(int)
        for op in failed:
            failed_entities[op.get('entity_type', '')] += 1

        cascades = []
        for entity_type, deps in DEPENDENCY_MAP.items():
            if entity_type not in failed_entities:
                continue
            failing_deps = [d for d in deps if d in failed_entities]
            if failing_deps:
                cascades.append({
                    'entity_type': entity_type,
                    'failure_count': failed_entities[entity_type],
                    'failed_dependencies': [
                        {'entity_type': d, 'failure_count': failed_entities[d]}
                        for d in failing_deps
                    ],
                    'likely_cascade': True,
                    'hint': f'{entity_type} failures may be caused by upstream {", ".join(failing_deps)} failures',
                })

        return {
            'available': bool(cascades),
            'cascades': cascades,
            'total_cascade_patterns': len(cascades),
        }

    # ------------------------------------------------------------------
    #  11d. EXECUTION MODE SUMMARY (REAL vs SIMULATED)
    # ------------------------------------------------------------------
    def _build_execution_mode_summary(self, operations_history: List) -> Dict:
        """Summarize how many operations were real vs simulated for trust scoring."""
        total = len(operations_history)
        real = sum(1 for op in operations_history if op.get('mode') == 'REAL')
        simulated = sum(1 for op in operations_history if op.get('mode') == 'SIMULATED')
        unknown = total - real - simulated

        if total == 0:
            return {'available': False}

        real_pct = round(real / total * 100, 1) if total else 0
        trust_level = 'HIGH' if real_pct >= 90 else ('MEDIUM' if real_pct >= 50 else 'LOW')

        warning = None
        if simulated > 0:
            warning = (
                f'{simulated} of {total} operations were SIMULATED (NCM client unavailable). '
                f'Report data reflects random simulation, not real NCM behavior.'
            )
        elif unknown > 0 and real == 0:
            warning = (
                f'{unknown} of {total} operations have unknown execution mode '
                f'(pre-upgrade data). Re-run to get accurate real/simulated tracking.'
            )

        return {
            'available': True,
            'total_operations': total,
            'real_operations': real,
            'simulated_operations': simulated,
            'unknown_mode': unknown,
            'real_percentage': real_pct,
            'trust_level': trust_level,
            'warning': warning,
        }

    # ------------------------------------------------------------------
    #  11e. QA HEALTH ASSESSMENT (automated tester insights)
    # ------------------------------------------------------------------
    def _build_health_assessment(self, cluster_health: Dict, pod_stability: List,
                                    node_stability: Optional[List] = None) -> Dict:
        """Auto-generate a QA-focused health assessment from all collected signals."""
        findings: List[Dict] = []
        severity_order = {'critical': 0, 'warning': 1, 'info': 2}

        # Check etcd
        if cluster_health.get('etcd_healthy') is False:
            findings.append({
                'severity': 'critical',
                'category': 'Infrastructure',
                'finding': 'etcd cluster has no leader — K8s control plane is unstable',
                'recommendation': 'Investigate etcd pods immediately; check disk I/O and memory on master nodes',
            })

        # Node pressure
        for nc in cluster_health.get('node_conditions', []):
            pressures = []
            if nc.get('disk_pressure'):
                pressures.append('Disk')
            if nc.get('memory_pressure'):
                pressures.append('Memory')
            if nc.get('pid_pressure'):
                pressures.append('PID')
            if pressures:
                findings.append({
                    'severity': 'warning',
                    'category': 'Node Health',
                    'finding': f'Node {nc["node"]} under {", ".join(pressures)} pressure',
                    'recommendation': f'Check resource consumption; {"clean disk space" if "Disk" in pressures else "reduce workload or increase node resources"}',
                })

        # CrashLoopBackOff
        crashloops = [u for u in cluster_health.get('unhealthy_pods', []) if u.get('reason') == 'CrashLoopBackOff']
        if crashloops:
            pods = ', '.join(set(u['pod'] for u in crashloops))
            findings.append({
                'severity': 'critical',
                'category': 'Pod Health',
                'finding': f'{len(crashloops)} pod(s) in CrashLoopBackOff: {pods}',
                'recommendation': 'Check pod logs (kubectl logs <pod> --previous) for crash reason',
            })

        # ImagePullBackOff
        imgpulls = [u for u in cluster_health.get('unhealthy_pods', []) if u.get('reason') == 'ImagePullBackOff']
        if imgpulls:
            pods = ', '.join(set(u['pod'] for u in imgpulls))
            findings.append({
                'severity': 'warning',
                'category': 'Pod Health',
                'finding': f'{len(imgpulls)} pod(s) stuck in ImagePullBackOff: {pods}',
                'recommendation': 'Check image name/tag, registry credentials, and network connectivity',
            })

        # High cumulative restarts
        high_restarts = [r for r in cluster_health.get('total_restarts', []) if r.get('total_restarts', 0) > 10]
        if high_restarts:
            worst = sorted(high_restarts, key=lambda x: x.get('total_restarts', 0), reverse=True)[:5]
            detail = '; '.join(f'{r["pod"]}/{r["container"]}={r["total_restarts"]}' for r in worst)
            findings.append({
                'severity': 'warning',
                'category': 'Stability',
                'finding': f'{len(high_restarts)} container(s) with >10 cumulative restarts: {detail}',
                'recommendation': 'Investigate why these containers keep restarting; check resource limits, probes, and application logs',
            })

        # Terminated with Error
        error_terms = [t for t in cluster_health.get('terminated_containers', []) if t.get('reason') == 'Error']
        if error_terms:
            pods = ', '.join(set(f'{t["pod"]}/{t["container"]}' for t in error_terms))
            findings.append({
                'severity': 'warning',
                'category': 'Stability',
                'finding': f'{len(error_terms)} container(s) last terminated with Error: {pods}',
                'recommendation': 'Review container exit codes and logs for root cause',
            })

        # OOM killed
        oom = cluster_health.get('oom_killed', [])
        if oom:
            pods = ', '.join(set(f'{o["pod"]}/{o["container"]}' for o in oom))
            findings.append({
                'severity': 'critical',
                'category': 'Resources',
                'finding': f'{len(oom)} container(s) OOMKilled: {pods}',
                'recommendation': 'Increase memory limits for affected containers or optimize memory usage',
            })

        # Pods not ready
        not_ready = cluster_health.get('pods_not_ready', [])
        if not_ready:
            pods = ', '.join(nr['pod'] for nr in not_ready[:5])
            findings.append({
                'severity': 'warning',
                'category': 'Availability',
                'finding': f'{len(not_ready)} pod(s) not ready (readiness probe failing): {pods}',
                'recommendation': 'Check readiness probe configuration and application health endpoints',
            })

        # Failed or Pending pods
        problem_pods = cluster_health.get('problem_pods', [])
        failed_pods = [p for p in problem_pods if p.get('phase') == 'Failed']
        pending_pods = [p for p in problem_pods if p.get('phase') == 'Pending']
        if failed_pods:
            findings.append({
                'severity': 'warning',
                'category': 'Pod Health',
                'finding': f'{len(failed_pods)} pod(s) in Failed phase',
                'recommendation': 'Check pod events (kubectl describe pod) for failure reason',
            })
        if len(pending_pods) > 2:
            findings.append({
                'severity': 'warning',
                'category': 'Scheduling',
                'finding': f'{len(pending_pods)} pod(s) stuck in Pending phase',
                'recommendation': 'Check node resources, taints/tolerations, and scheduler events',
            })

        # Slow API server
        slow_apis = cluster_health.get('api_server_latency', [])
        if slow_apis:
            worst = max(a.get('p99_seconds', 0) for a in slow_apis)
            findings.append({
                'severity': 'critical' if worst > 10 else 'warning',
                'category': 'Performance',
                'finding': f'{len(slow_apis)} API endpoint(s) with P99 latency > 1s (worst: {worst:.1f}s)',
                'recommendation': 'Check API server resource usage, etcd performance, and audit log overhead',
            })

        # High throttling pods
        high_throttle = [p for p in pod_stability if p.get('cpu_throttle_pct', 0) > 50]
        if high_throttle:
            findings.append({
                'severity': 'info',
                'category': 'Performance',
                'finding': f'{len(high_throttle)} pod(s) with CPU throttle > 50%',
                'recommendation': 'Consider increasing CPU limits for affected pods if performance is impacted',
            })

        # Node stability issues
        if node_stability:
            degraded_nodes = [n for n in node_stability if n.get('stability_score', 100) < 70]
            if degraded_nodes:
                names = ', '.join(n['node_name'] for n in degraded_nodes)
                worst = min(n['stability_score'] for n in degraded_nodes)
                findings.append({
                    'severity': 'critical' if worst < 50 else 'warning',
                    'category': 'Node Health',
                    'finding': f'{len(degraded_nodes)} node(s) with stability score < 70: {names} (lowest: {worst}/100)',
                    'recommendation': 'Investigate resource exhaustion, pressure conditions, and running workloads on affected nodes',
                })

            high_cpu_nodes = [n for n in node_stability if n.get('cpu_percent', 0) > 85]
            if high_cpu_nodes:
                details = ', '.join(f'{n["node_name"]}={n["cpu_percent"]}%' for n in high_cpu_nodes)
                findings.append({
                    'severity': 'warning',
                    'category': 'Node Resources',
                    'finding': f'{len(high_cpu_nodes)} node(s) with CPU > 85%: {details}',
                    'recommendation': 'Consider scaling out or reducing workload on CPU-saturated nodes',
                })

            high_mem_nodes = [n for n in node_stability if n.get('memory_percent', 0) > 85]
            if high_mem_nodes:
                details = ', '.join(f'{n["node_name"]}={n["memory_percent"]}%' for n in high_mem_nodes)
                findings.append({
                    'severity': 'warning',
                    'category': 'Node Resources',
                    'finding': f'{len(high_mem_nodes)} node(s) with memory > 85%: {details}',
                    'recommendation': 'Increase node memory or migrate workloads to reduce memory pressure',
                })

        # No issues
        if not findings:
            findings.append({
                'severity': 'info',
                'category': 'Overall',
                'finding': 'No significant health issues detected',
                'recommendation': 'Cluster appears healthy — continue monitoring',
            })

        findings.sort(key=lambda x: severity_order.get(x['severity'], 9))

        critical_count = sum(1 for f in findings if f['severity'] == 'critical')
        warning_count = sum(1 for f in findings if f['severity'] == 'warning')
        if critical_count > 0:
            overall = 'CRITICAL'
        elif warning_count > 2:
            overall = 'DEGRADED'
        elif warning_count > 0:
            overall = 'ATTENTION'
        else:
            overall = 'HEALTHY'

        return {
            'overall_status': overall,
            'findings': findings,
            'critical_count': critical_count,
            'warning_count': warning_count,
            'info_count': sum(1 for f in findings if f['severity'] == 'info'),
        }

    # ------------------------------------------------------------------
    #  12. ITERATION TIMELINE (all iterations with operations & spike flag)
    # ------------------------------------------------------------------
    def _build_iteration_timeline(self, metrics_history: List, operations_history: List,
                                   spike_analysis: Dict) -> Dict:
        if not metrics_history:
            return {'iterations': [], 'total_iterations': 0}

        spike_iters = set()
        spike_map = {}
        for s in spike_analysis.get('spikes', []):
            spike_iters.add(s.get('iteration', -1))
            spike_map[s.get('iteration', -1)] = s

        iterations = []
        for mi in metrics_history:
            iteration_num = mi.get('iteration', 0)
            cpu = mi.get('cpu_percent', 0) or mi.get('cpu', 0)
            memory = mi.get('memory_percent', 0) or mi.get('memory', 0)
            ts = mi.get('timestamp', '')

            iter_ops = [
                op for op in operations_history
                if self._op_iteration_matches(op, iteration_num)
            ]
            if not iter_ops:
                iter_ops = self._find_ops_near_timestamp(ts, operations_history)

            ops_count = len(iter_ops)
            ops_success = sum(1 for op in iter_ops if _op_succeeded(op))
            ops_failed = sum(1 for op in iter_ops if (op.get('status') or '').upper() == 'FAILED')

            create_count = sum(1 for op in iter_ops if 'create' in (op.get('operation', '') or '').lower())
            delete_count = sum(1 for op in iter_ops if 'delete' in (op.get('operation', '') or '').lower())

            is_spike = iteration_num in spike_iters
            spike_info = spike_map.get(iteration_num)

            prev_mi = metrics_history[max(0, metrics_history.index(mi) - 1)] if metrics_history.index(mi) > 0 else mi
            prev_cpu = (prev_mi.get('cpu_percent', 0) or prev_mi.get('cpu', 0)) if metrics_history.index(mi) > 0 else cpu
            prev_mem = (prev_mi.get('memory_percent', 0) or prev_mi.get('memory', 0)) if metrics_history.index(mi) > 0 else memory
            cpu_delta = round(cpu - prev_cpu, 2)
            mem_delta = round(memory - prev_mem, 2)

            op_summary = {}
            for op in iter_ops:
                key = f"{op.get('entity_type', '?')}.{op.get('operation', '?')}"
                if key not in op_summary:
                    op_summary[key] = {'count': 0, 'success': 0, 'failed': 0, 'avg_duration': 0, 'durations': []}
                op_summary[key]['count'] += 1
                if _op_succeeded(op):
                    op_summary[key]['success'] += 1
                elif (op.get('status') or '').upper() == 'FAILED':
                    op_summary[key]['failed'] += 1
                if op.get('duration_seconds'):
                    op_summary[key]['durations'].append(op['duration_seconds'])

            for key in op_summary:
                d = op_summary[key]['durations']
                op_summary[key]['avg_duration'] = round(sum(d) / len(d), 2) if d else 0
                del op_summary[key]['durations']

            iterations.append({
                'iteration': iteration_num,
                'timestamp': ts,
                'cpu': round(cpu, 1),
                'memory': round(memory, 1),
                'cpu_delta': cpu_delta,
                'memory_delta': mem_delta,
                'operations_count': ops_count,
                'operations_success': ops_success,
                'operations_failed': ops_failed,
                'creates': create_count,
                'deletes': delete_count,
                'is_spike': is_spike,
                'spike_risk': spike_info.get('risk_level') if spike_info else None,
                'operation_breakdown': op_summary,
                'operations': [{
                    'entity_type': op.get('entity_type', '?'),
                    'operation': op.get('operation', '?'),
                    'entity_name': op.get('entity_name', '?'),
                    'status': op.get('status', '?'),
                    'duration': round(op.get('duration_seconds', 0), 2),
                } for op in iter_ops[:20]],
            })

        return {
            'iterations': iterations,
            'total_iterations': len(iterations),
            'total_spikes': len(spike_iters),
            'summary': {
                'total_creates': sum(i['creates'] for i in iterations),
                'total_deletes': sum(i['deletes'] for i in iterations),
                'total_ops': sum(i['operations_count'] for i in iterations),
                'avg_ops_per_iteration': round(sum(i['operations_count'] for i in iterations) / max(len(iterations), 1), 1),
            }
        }

    @staticmethod
    def _op_iteration_matches(op: Dict, iteration_num: Any) -> bool:
        oi = op.get('iteration')
        if oi is None:
            return False
        try:
            return int(oi) == int(iteration_num)
        except (TypeError, ValueError):
            return False

    def _find_ops_near_timestamp(self, ts: str, operations_history: List) -> List:
        """Fallback when operations lack iteration: match ops whose start is near the metric sample."""
        if not ts or not operations_history:
            return []
        try:
            target_time = datetime.fromisoformat(ts.replace('Z', '+00:00'))
        except Exception:
            return []
        nearby = []
        for op in operations_history:
            op_ts = op.get('timestamp') or op.get('started_at') or op.get('start_time', '')
            if not op_ts:
                continue
            try:
                op_time = datetime.fromisoformat(op_ts.replace('Z', '+00:00'))
                if abs((target_time - op_time).total_seconds()) <= 120:
                    nearby.append(op)
            except Exception:
                continue
        return nearby
