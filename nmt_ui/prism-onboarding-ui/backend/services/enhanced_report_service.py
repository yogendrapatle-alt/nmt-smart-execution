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

logger = logging.getLogger(__name__)

SPIKE_WINDOW_SECONDS = 90
RECOVERY_THRESHOLD_PERCENT = 2.0
MIN_SPIKE_DELTA = 5.0


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
        live_cluster_health = self._collect_cluster_health()
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
                             'node_cpu', 'node_memory', 'node_disk', 'restart_timestamps'):
                if live_key in live_cluster_health:
                    cluster_health[live_key] = live_cluster_health[live_key]
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
        health_assessment['_deprecated'] = True

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

        return {
            'verdict': verdict,
            'spike_analysis': spike_analysis,
            'cluster_health': cluster_health,
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
            if status == 'SUCCESS':
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
            ops_success = sum(1 for op in ops_in_window if op.get('status') == 'SUCCESS')
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

    def _collect_cluster_health(self) -> Dict:
        health = {
            'cpu_throttling': [],
            'container_restarts': [],
            'oom_killed': [],
            'node_conditions': [],
            'pvc_health': [],
            'collection_status': 'unavailable',
            'collection_reason': 'prometheus_url_not_configured',
        }
        if not self.prometheus_url:
            return health

        ok, reason = self._probe_prometheus()
        if not ok:
            health['collection_status'] = 'failed'
            health['collection_reason'] = reason or 'prometheus_unreachable'
            return health

        try:
            url = urljoin(self.prometheus_url, '/api/v1/query')

            throttle_query = (
                'topk(20, rate(container_cpu_cfs_throttled_periods_total'
                '{container!="", image!=""}[5m]) / '
                'rate(container_cpu_cfs_periods_total'
                '{container!="", image!=""}[5m]))'
            )
            throttle_data = self._prom_query(url, throttle_query)
            for r in throttle_data:
                m = r.get('metric', {})
                ratio = float(r.get('value', [0, 0])[1])
                if ratio > 0.01:
                    health['cpu_throttling'].append({
                        'pod': m.get('pod', 'unknown'),
                        'namespace': m.get('namespace', 'unknown'),
                        'container': m.get('container', 'unknown'),
                        'throttle_ratio': round(ratio * 100, 1),
                    })

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
            pod_cpu_cores_query = (
                'topk(30, sum(rate(container_cpu_usage_seconds_total'
                '{container!="", container!="POD"}[1m])) by (pod, namespace))'
            )
            pod_cpu_limit_query = (
                'sum(kube_pod_container_resource_limits'
                '{resource="cpu", container!=""}) by (pod, namespace)'
            )
            cpu_cores_data = self._prom_query(url, pod_cpu_cores_query)
            cpu_limit_data = self._prom_query(url, pod_cpu_limit_query)
            cpu_limits = {}
            for r in cpu_limit_data:
                m = r.get('metric', {})
                limit_cores = float(r.get('value', [0, 0])[1])
                if limit_cores > 0:
                    cpu_limits[m.get('pod', '')] = limit_cores

            health['pod_cpu'] = []
            for r in cpu_cores_data:
                m = r.get('metric', {})
                pod = m.get('pod', 'unknown')
                cores = float(r.get('value', [0, 0])[1])
                limit = cpu_limits.get(pod)
                pct = min((cores / limit) * 100, 100.0) if (limit and limit > 0) else min(cores * 100, 100.0)
                health['pod_cpu'].append({
                    'pod': pod,
                    'namespace': m.get('namespace', 'unknown'),
                    'cpu_cores': round(cores, 3),
                    'cpu_limit_cores': round(limit, 3) if limit else None,
                    'cpu_pct': round(pct, 1),
                })

            # Per-pod Memory usage
            pod_mem_query = (
                'topk(30, sum(container_memory_working_set_bytes'
                '{container!="", container!="POD"}) by (pod, namespace))'
            )
            pod_mem_data = self._prom_query(url, pod_mem_query)
            health['pod_memory'] = []
            for r in pod_mem_data:
                m = r.get('metric', {})
                mem_bytes = float(r.get('value', [0, 0])[1])
                health['pod_memory'].append({
                    'pod': m.get('pod', 'unknown'),
                    'namespace': m.get('namespace', 'unknown'),
                    'memory_mb': round(mem_bytes / (1024 * 1024), 1),
                })

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
                val = float(r.get('value', [0, 0])[1])
                if val >= 1:
                    health['terminated_containers'].append({
                        'pod': m.get('pod', 'unknown'),
                        'namespace': m.get('namespace', 'unknown'),
                        'container': m.get('container', 'unknown'),
                        'reason': m.get('reason', 'unknown'),
                    })

            # ----- Cumulative restart count (total restarts ever, not just last 1h) -----
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
            health['restart_timestamps'] = health['restart_timestamps'][:30]

            health['collection_status'] = 'success'
            health['collection_reason'] = ''
        except Exception as e:
            logger.warning(f"Cluster health collection failed: {e}")
            health['collection_status'] = 'failed'
            health['collection_reason'] = str(e)[:300]

        return health

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

            # First 5 failures with full API details for triage drill-down
            sample_failures = []
            for op in ops[:5]:
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

        # Fill cpu_max/memory_max_mb from Prometheus when pod_correlation didn't provide values
        for pod_name, info in pod_map.items():
            if info['cpu_max'] == 0 and pod_name in cpu_map:
                info['cpu_max'] = cpu_map[pod_name].get('cpu_pct', 0)
                info['cpu_cores'] = cpu_map[pod_name].get('cpu_cores', 0)
                info['cpu_limit_cores'] = cpu_map[pod_name].get('cpu_limit_cores')
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

        # Use max throttle ratio across all containers in the same pod
        throttle_map: Dict[str, float] = defaultdict(float)
        for t in cluster_health.get('cpu_throttling', []):
            throttle_map[t['pod']] = max(throttle_map[t['pod']], t.get('throttle_ratio', 0))

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
            if info['cpu_max'] > 90:
                score -= 10
            elif info['cpu_max'] > 70:
                score -= 5
            score = max(0, round(score))

            results.append({
                'pod_name': pod_name,
                'namespace': info.get('namespace', 'unknown'),
                'stability_score': score,
                'restarts': restarts,
                'total_restarts': total_restarts,
                'cpu_throttle_pct': round(throttle, 1),
                'oom_killed': oom,
                'unhealthy_reason': unhealthy_reason,
                'termination_reasons': term_reasons,
                'pod_phase': phase,
                'not_ready': not_ready,
                'max_cpu_pct': round(info['cpu_max'], 1),
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
            if op.get('status') == 'SUCCESS' and op.get('operation', '').lower() == 'create':
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
            if s == 'SUCCESS':
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
            ops_success = sum(1 for op in iter_ops if op.get('status') == 'SUCCESS')
            ops_failed = sum(1 for op in iter_ops if op.get('status') == 'FAILED')

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
                if op.get('status') == 'SUCCESS':
                    op_summary[key]['success'] += 1
                elif op.get('status') == 'FAILED':
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
