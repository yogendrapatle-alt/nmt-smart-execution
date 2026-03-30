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
"""

import logging
import math
import re
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import requests
from urllib.parse import urljoin

logger = logging.getLogger(__name__)

SPIKE_WINDOW_SECONDS = 90
RECOVERY_THRESHOLD_PERCENT = 2.0
MIN_SPIKE_DELTA = 5.0


class EnhancedReportService:

    def __init__(self, prometheus_url: Optional[str] = None):
        self.prometheus_url = prometheus_url

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

        spike_analysis = self._analyze_spikes(metrics_history, operations_history, pod_correlation, detected_anomalies)
        cluster_health = self._collect_cluster_health()
        # Use persisted cluster health if live collection failed
        if cluster_health.get('collection_status') != 'success':
            persisted_health = report_data.get('cluster_health_snapshot') or status_data.get('cluster_health_snapshot')
            if persisted_health and isinstance(persisted_health, dict) and persisted_health.get('collection_status') == 'success':
                cluster_health = persisted_health
        failure_groups = self._group_failures(operations_history)
        heatmap = self._build_operation_heatmap(operations_history)
        pod_stability = self._compute_pod_stability(pod_correlation, cluster_health)
        historical = self._get_historical_comparison(testbed_id, execution_id)
        capacity = self._estimate_capacity(operations_history, metrics_history, baseline_metrics, final_metrics, report_data)
        ml_insights = self._get_ml_report_insights(testbed_id)
        iteration_timeline = self._build_iteration_timeline(metrics_history, operations_history, spike_analysis)
        entity_operation_counts = self._entity_operation_counts(operations_history)
        verdict = self._compute_verdict(
            report_data, status_data, spike_analysis, cluster_health,
            failure_groups, operations_history, metrics_history
        )

        latency_report = self._build_latency_report(status_data)
        learning = status_data.get('learning_summary') or report_data.get('learning_summary') or ''

        return {
            'verdict': verdict,
            'spike_analysis': spike_analysis,
            'cluster_health': cluster_health,
            'failure_analysis': failure_groups,
            'operation_heatmap': heatmap,
            'pod_stability': pod_stability,
            'historical_comparison': historical,
            'capacity_planning': capacity,
            'ml_report_insights': ml_insights,
            'latency_report': latency_report,
            'learning_summary': learning,
            'iteration_timeline': iteration_timeline,
            'entity_operation_counts': entity_operation_counts,
            'effective_metrics': {
                'baseline': baseline_metrics,
                'final': final_metrics,
                'resolution_note': metrics_resolution_note,
            },
        }

    def _entity_operation_counts(self, operations_history: List) -> List[Dict[str, Any]]:
        """Sorted list of { 'key': 'Entity.operation', 'count': n } for report tables."""
        counts: Dict[str, int] = defaultdict(int)
        for op in operations_history:
            key = f"{op.get('entity_type', '?')}.{op.get('operation', '?')}"
            counts[key] += 1
        ordered = sorted(counts.items(), key=lambda x: (-x[1], x[0]))
        return [{'key': k, 'count': c} for k, c in ordered]

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
                        pod_correlation: Dict, detected_anomalies: List) -> Dict:
        spikes = []
        if len(metrics_history) < 3:
            return {'spikes': [], 'total_spikes': 0, 'avg_recovery_minutes': 0}

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
                'cpu_after': curr.get('cpu_percent', 0),
                'cpu_delta': round(cpu_delta, 2),
                'memory_before': prev.get('memory_percent', 0),
                'memory_after': curr.get('memory_percent', 0),
                'memory_delta': round(mem_delta, 2),
                'risk_level': risk,
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
    def _collect_cluster_health(self) -> Dict:
        health = {
            'cpu_throttling': [],
            'container_restarts': [],
            'oom_killed': [],
            'node_conditions': [],
            'pvc_health': [],
            'collection_status': 'unavailable',
        }
        if not self.prometheus_url:
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

            health['collection_status'] = 'success'
        except Exception as e:
            logger.warning(f"Cluster health collection failed: {e}")
            health['collection_status'] = f'error: {str(e)}'

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
        failed_ops = [op for op in operations_history if op.get('status') == 'FAILED']
        if not failed_ops:
            return {'groups': [], 'total_failures': 0}

        groups = defaultdict(list)
        for op in failed_ops:
            error = op.get('error', '') or op.get('error_message', '') or 'Unknown error'
            key = self._normalize_error(error)
            groups[key].append(op)

        result_groups = []
        for error_pattern, ops in sorted(groups.items(), key=lambda x: -len(x[1])):
            entity_types = list({op.get('entity_type', 'unknown') for op in ops})
            operations = list({op.get('operation', 'unknown') for op in ops})
            timestamps = [op.get('timestamp', '') for op in ops if op.get('timestamp')]

            first_ts = min(timestamps) if timestamps else ''
            last_ts = max(timestamps) if timestamps else ''

            result_groups.append({
                'error_pattern': error_pattern,
                'count': len(ops),
                'entity_types': entity_types,
                'operations': operations,
                'first_occurrence': first_ts,
                'last_occurrence': last_ts,
                'sample_error': (ops[0].get('error', '') or ops[0].get('error_message', ''))[:300],
                'root_cause_hint': self._infer_root_cause(error_pattern, ops),
            })

        return {
            'groups': result_groups,
            'total_failures': len(failed_ops),
            'unique_patterns': len(result_groups),
        }

    def _normalize_error(self, error: str) -> str:
        error = re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<UUID>', error)
        error = re.sub(r'smart-\w+-\d+-\w+', '<ENTITY_NAME>', error)
        error = re.sub(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}', '<TIMESTAMP>', error)
        error = re.sub(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', '<IP>', error)
        return error[:200].strip()

    def _infer_root_cause(self, pattern: str, ops: List) -> str:
        pattern_lower = pattern.lower()
        if 'timeout' in pattern_lower or 'timed out' in pattern_lower:
            return 'API response time degraded under high cluster load'
        if 'connection' in pattern_lower and ('refused' in pattern_lower or 'reset' in pattern_lower):
            return 'Service endpoint became unavailable — possible pod restart'
        if 'not found' in pattern_lower or '404' in pattern_lower:
            return 'Dependent entity was deleted or never created successfully'
        if 'quota' in pattern_lower or 'limit' in pattern_lower:
            return 'Resource quota or API rate limit reached'
        if 'already exists' in pattern_lower or 'duplicate' in pattern_lower:
            return 'Entity name collision from a previous failed cleanup'
        if 'unauthorized' in pattern_lower or '401' in pattern_lower or '403' in pattern_lower:
            return 'Authentication / authorization issue'
        if '500' in pattern_lower or 'internal server' in pattern_lower:
            return 'Server-side error under load — infrastructure service degradation'
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
        })

        for op_data in pod_correlation.get('operations', []):
            for pod in op_data.get('pods', []):
                name = pod.get('pod_name', 'unknown')
                p = pod_map[name]
                p['namespace'] = pod.get('namespace', 'unknown')
                p['cpu_max'] = max(p['cpu_max'], pod.get('cpu_after', 0))
                p['memory_max_mb'] = max(p['memory_max_mb'], pod.get('memory_after', 0))
                p['impact_events'] += 1
                p['total_cpu_delta'] += abs(pod.get('cpu_delta', 0))

        restart_map = {}
        for r in cluster_health.get('container_restarts', []):
            restart_map[r['pod']] = r.get('restart_count', 0)

        throttle_map = {}
        for t in cluster_health.get('cpu_throttling', []):
            throttle_map[t['pod']] = t.get('throttle_ratio', 0)

        oom_set = {o['pod'] for o in cluster_health.get('oom_killed', [])}

        results = []
        for pod_name, info in pod_map.items():
            restarts = restart_map.get(pod_name, 0)
            throttle = throttle_map.get(pod_name, 0)
            oom = pod_name in oom_set

            score = 100
            score -= min(restarts * 10, 30)
            score -= min(throttle * 0.5, 20)
            if oom:
                score -= 25
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
                'cpu_throttle_pct': round(throttle, 1),
                'oom_killed': oom,
                'max_cpu_pct': round(info['cpu_max'], 1),
                'max_memory_mb': round(info['memory_max_mb'], 1),
                'impact_events': info['impact_events'],
            })

        results.sort(key=lambda x: x['stability_score'])
        return results[:30]

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
                query = text("""
                    SELECT execution_id, status, duration_minutes, total_operations,
                           successful_operations, failed_operations, success_rate,
                           start_time, end_time,
                           baseline_metrics, final_metrics,
                           jsonb_array_length(COALESCE(metrics_history, '[]'::jsonb)) as iterations
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
                if isinstance(baseline, str):
                    import json
                    try:
                        baseline = json.loads(baseline)
                    except Exception:
                        baseline = {}
                if isinstance(final, str):
                    import json
                    try:
                        final = json.loads(final)
                    except Exception:
                        final = {}

                history.append({
                    'execution_id': r[0],
                    'status': r[1],
                    'duration_minutes': round(r[2], 1) if r[2] else 0,
                    'total_operations': r[3] or 0,
                    'iterations': r[11] if len(r) > 11 and r[11] else 0,
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
        baseline_cpu = baseline_metrics.get('cpu_percent', 0)
        final_cpu = final_metrics.get('cpu_percent', 0)
        baseline_mem = baseline_metrics.get('memory_percent', 0)
        final_mem = final_metrics.get('memory_percent', 0)

        cpu_delta = final_cpu - baseline_cpu
        mem_delta = final_mem - baseline_mem

        # Average magnitude of net change per op (not only positive deltas — avoids bogus 0% when usage dropped)
        cpu_per_op = (abs(cpu_delta) / total_ops) if total_ops > 0 else 0
        mem_per_op = (abs(mem_delta) / total_ops) if total_ops > 0 else 0

        # If start/end metrics cancel out but samples moved during the run, apportion step changes across ops
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

        return {
            'available': True,
            'total_ops_executed': total_ops,
            'cpu_per_operation': round(cpu_per_op, 3),
            'memory_per_operation': round(mem_per_op, 3),
            'estimated_max_additional_ops': max_additional if max_additional < 999 else None,
            'estimated_total_capacity_ops': total_ops + max_additional if max_additional < 999 else None,
            'bottleneck': bottleneck,
            'entities_created': dict(entity_counts),
            'recommendation': self._capacity_recommendation(cpu_per_op, mem_per_op, final_cpu, final_mem, bottleneck),
        }

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
        success_rate = ((countable_ops - failed_ops) / countable_ops * 100) if countable_ops > 0 else 100

        threshold_reached = report_data.get('threshold_reached', False) or status_data.get('threshold_reached', False)
        oom_count = len(cluster_health.get('oom_killed', []))
        restart_count = sum(r.get('restart_count', 0) for r in cluster_health.get('container_restarts', []))
        high_risk_spikes = spike_analysis.get('high_risk_count', 0)

        issues = []

        if status == 'COMPLETED' and threshold_reached:
            verdict = 'PASS'
        elif status == 'TIMEOUT':
            verdict = 'WARN'
            issues.append('Execution timed out before reaching target threshold')
        elif status == 'STOPPED':
            verdict = 'WARN'
            issues.append('Execution was manually stopped')
        else:
            verdict = 'PASS' if success_rate > 80 else 'WARN'

        if oom_count > 0:
            verdict = 'WARN' if verdict == 'PASS' else verdict
            issues.append(f'{oom_count} container(s) OOMKilled during execution')
        if restart_count > 3:
            verdict = 'WARN' if verdict == 'PASS' else verdict
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

        if not threshold_reached and status == 'COMPLETED':
            issues.append('Execution completed but threshold was not reached — consider adding more entity types')

        summary_line = ''
        if verdict == 'PASS':
            summary_line = f'Cluster sustained target load with {success_rate:.0f}% success rate and no service disruptions.'
        elif verdict == 'WARN':
            summary_line = f'Execution completed with warnings — {len(issues)} issue(s) require attention.'
        else:
            summary_line = f'Execution encountered critical issues — {len(issues)} issue(s) need investigation.'

        return {
            'result': verdict,
            'summary': summary_line,
            'issues': issues,
            'success_rate': round(success_rate, 1),
            'threshold_reached': threshold_reached,
            'oom_kills': oom_count,
            'container_restarts': restart_count,
            'high_risk_spikes': high_risk_spikes,
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
    #  11. ITERATION TIMELINE (all iterations with operations & spike flag)
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
            cpu = mi.get('cpu_percent', 0)
            memory = mi.get('memory_percent', 0)
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

            prev_cpu = metrics_history[max(0, metrics_history.index(mi) - 1)].get('cpu_percent', 0) if metrics_history.index(mi) > 0 else cpu
            prev_mem = metrics_history[max(0, metrics_history.index(mi) - 1)].get('memory_percent', 0) if metrics_history.index(mi) > 0 else memory
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
