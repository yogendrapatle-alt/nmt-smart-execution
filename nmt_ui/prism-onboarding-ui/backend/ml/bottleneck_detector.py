"""
Automatic Bottleneck Discovery for Smart Execution

Identifies which Nutanix services are causing system bottlenecks during
load execution by correlating cluster-level CPU/memory spikes with
per-service Prometheus metrics.

Detection approach:
    1. After each operation batch, compute cluster CPU delta.
    2. If delta exceeds a threshold, query per-service pod metrics.
    3. Score each service:
        score = 0.5 * norm_cpu + 0.3 * latency_score + 0.2 * restart_activity
    4. The highest-scoring service is the detected bottleneck.

All Prometheus calls are wrapped in try/except so a missing metric never
crashes the execution loop.
"""

import logging
import time
import requests
from typing import Dict, List, Optional, Tuple
from urllib.parse import urljoin
from collections import defaultdict

logger = logging.getLogger(__name__)

TARGET_SERVICES = [
    'ntnx-aplos',
    'ntnx-calm',
    'ntnx-prism',
    'etcd',
    'api-gateway',
]

# Minimum cluster CPU delta (%) to trigger bottleneck analysis
DEFAULT_CPU_DELTA_THRESHOLD = 3.0


class BottleneckDetector:
    """
    Correlates cluster-level metric spikes with per-service pod metrics
    to identify which Nutanix service is causing the bottleneck.

    Thread-safe: each public method is stateless except for
    ``detection_history`` which is append-only.
    """

    def __init__(
        self,
        prometheus_url: str,
        target_services: Optional[List[str]] = None,
        cpu_delta_threshold: float = DEFAULT_CPU_DELTA_THRESHOLD,
        prometheus_timeout: int = 8,
    ):
        self.prometheus_url = prometheus_url
        self.target_services = target_services or list(TARGET_SERVICES)
        self.cpu_delta_threshold = cpu_delta_threshold
        self._timeout = prometheus_timeout
        self.detection_history: List[Dict] = []
        self._service_regex = '|'.join(self.target_services)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def detect(
        self,
        metrics_before: Dict,
        metrics_after: Dict,
    ) -> Optional[Dict]:
        """
        Run bottleneck detection if cluster CPU delta exceeds threshold.

        Args:
            metrics_before: {'cpu_percent': float, 'memory_percent': float, ...}
            metrics_after:  same shape

        Returns:
            Detection result dict or None if delta below threshold.
        """
        cpu_before = metrics_before.get('cpu_percent', 0)
        cpu_after = metrics_after.get('cpu_percent', 0)
        cpu_delta = cpu_after - cpu_before

        if cpu_delta < self.cpu_delta_threshold:
            return None

        logger.info(
            f"Bottleneck detection triggered: CPU delta={cpu_delta:.1f}% "
            f"(threshold={self.cpu_delta_threshold}%)"
        )

        service_metrics = self._collect_service_metrics()
        if not service_metrics:
            logger.debug("No service metrics available, skipping bottleneck detection")
            return None

        scored = self._score_services(service_metrics, cpu_delta)
        if not scored:
            return None

        top_service, top_score, evidence = scored[0]

        result = {
            'detected': True,
            'bottleneck_service': top_service,
            'confidence': round(min(top_score, 1.0), 2),
            'cpu_delta': round(cpu_delta, 2),
            'reason': self._build_reason(top_service, evidence),
            'evidence': evidence,
            'all_services': [
                {
                    'service': svc,
                    'score': round(sc, 3),
                    'evidence': ev,
                }
                for svc, sc, ev in scored
            ],
            'timestamp': time.time(),
        }

        self.detection_history.append(result)
        if len(self.detection_history) > 100:
            self.detection_history = self.detection_history[-100:]

        logger.info(
            f"Bottleneck detected: {top_service} "
            f"(confidence={result['confidence']}, reason={result['reason']})"
        )
        return result

    def get_summary(self) -> Dict:
        """Return a summary of all detections for reporting."""
        if not self.detection_history:
            return {'detected': False, 'total_detections': 0}

        service_counts: Dict[str, int] = defaultdict(int)
        for det in self.detection_history:
            service_counts[det['bottleneck_service']] += 1

        most_frequent = max(service_counts.items(), key=lambda x: x[1])
        latest = self.detection_history[-1]

        return {
            'detected': True,
            'total_detections': len(self.detection_history),
            'most_frequent_bottleneck': most_frequent[0],
            'most_frequent_count': most_frequent[1],
            'latest': latest,
            'service_frequency': dict(service_counts),
        }

    # ------------------------------------------------------------------
    # Prometheus collection
    # ------------------------------------------------------------------

    def _collect_service_metrics(self) -> Dict[str, Dict]:
        """
        Query Prometheus for per-service CPU, memory, latency, restarts.
        Returns {service_name: {cpu, memory_mb, latency_seconds, restarts}}.
        """
        results: Dict[str, Dict] = {}
        for svc in self.target_services:
            results[svc] = {
                'cpu': 0.0,
                'memory_mb': 0.0,
                'latency_seconds': 0.0,
                'restarts': 0,
            }

        self._fill_cpu(results)
        self._fill_memory(results)
        self._fill_latency(results)
        self._fill_restarts(results)

        # Only keep services with at least one non-zero metric
        active = {
            svc: m for svc, m in results.items()
            if m['cpu'] > 0 or m['memory_mb'] > 0 or m['latency_seconds'] > 0 or m['restarts'] > 0
        }
        return active

    def _prom_query(self, query: str) -> List[Dict]:
        """Execute a PromQL query and return the result list."""
        if not self.prometheus_url:
            return []
        try:
            url = urljoin(self.prometheus_url, '/api/v1/query')
            resp = requests.get(
                url, params={'query': query},
                verify=False, timeout=self._timeout,
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get('status') == 'success':
                    return data.get('data', {}).get('result', [])
        except Exception as e:
            logger.debug(f"Prometheus query failed ({query[:60]}...): {e}")
        return []

    def _match_service(self, pod_name: str) -> Optional[str]:
        """Map a pod name to one of the target services."""
        pod_lower = pod_name.lower()
        for svc in self.target_services:
            if svc.replace('-', '') in pod_lower.replace('-', ''):
                return svc
        return None

    def _fill_cpu(self, results: Dict[str, Dict]):
        query = (
            'sum(rate(container_cpu_usage_seconds_total'
            '{container!="",container!="POD"}[2m])) by (pod) * 100'
        )
        for item in self._prom_query(query):
            pod = item.get('metric', {}).get('pod', '')
            svc = self._match_service(pod)
            if svc and svc in results:
                val = float(item.get('value', [0, 0])[1])
                results[svc]['cpu'] = max(results[svc]['cpu'], val)

    def _fill_memory(self, results: Dict[str, Dict]):
        query = (
            'sum(container_memory_working_set_bytes'
            '{container!="",container!="POD"}) by (pod)'
        )
        for item in self._prom_query(query):
            pod = item.get('metric', {}).get('pod', '')
            svc = self._match_service(pod)
            if svc and svc in results:
                val = float(item.get('value', [0, 0])[1]) / (1024 * 1024)
                results[svc]['memory_mb'] = max(results[svc]['memory_mb'], val)

    def _fill_latency(self, results: Dict[str, Dict]):
        query = (
            'histogram_quantile(0.95, '
            'sum(rate(http_request_duration_seconds_bucket[2m])) by (le, pod))'
        )
        for item in self._prom_query(query):
            pod = item.get('metric', {}).get('pod', '')
            svc = self._match_service(pod)
            if svc and svc in results:
                val = float(item.get('value', [0, 0])[1])
                if not (val != val):  # guard against NaN
                    results[svc]['latency_seconds'] = max(
                        results[svc]['latency_seconds'], val
                    )

    def _fill_restarts(self, results: Dict[str, Dict]):
        query = (
            'sum(increase(kube_pod_container_status_restarts_total[5m])) by (pod)'
        )
        for item in self._prom_query(query):
            pod = item.get('metric', {}).get('pod', '')
            svc = self._match_service(pod)
            if svc and svc in results:
                val = float(item.get('value', [0, 0])[1])
                results[svc]['restarts'] = max(results[svc]['restarts'], int(val))

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------

    def _score_services(
        self,
        service_metrics: Dict[str, Dict],
        cpu_delta: float,
    ) -> List[Tuple[str, float, Dict]]:
        """
        Score each service and return sorted list of (service, score, evidence).

        Scoring formula:
            score = 0.5 * normalized_cpu + 0.3 * latency_score + 0.2 * restart_score
        """
        if not service_metrics:
            return []

        max_cpu = max((m['cpu'] for m in service_metrics.values()), default=1.0) or 1.0
        max_latency = max(
            (m['latency_seconds'] for m in service_metrics.values()), default=1.0
        ) or 1.0

        scored: List[Tuple[str, float, Dict]] = []

        for svc, m in service_metrics.items():
            norm_cpu = min(m['cpu'] / max_cpu, 1.0) if max_cpu > 0 else 0
            latency_score = min(m['latency_seconds'] / max_latency, 1.0) if max_latency > 0 else 0
            restart_score = min(m['restarts'] / 3.0, 1.0)

            score = 0.5 * norm_cpu + 0.3 * latency_score + 0.2 * restart_score

            evidence = {
                'service_cpu': round(m['cpu'], 2),
                'service_memory_mb': round(m['memory_mb'], 1),
                'api_latency_seconds': round(m['latency_seconds'], 3),
                'restarts': m['restarts'],
                'normalized_cpu': round(norm_cpu, 3),
                'latency_score': round(latency_score, 3),
                'restart_score': round(restart_score, 3),
            }

            scored.append((svc, score, evidence))

        scored.sort(key=lambda x: x[1], reverse=True)
        return scored

    def _build_reason(self, service: str, evidence: Dict) -> str:
        parts = []
        cpu = evidence.get('service_cpu', 0)
        lat = evidence.get('api_latency_seconds', 0)
        restarts = evidence.get('restarts', 0)

        if cpu > 50:
            parts.append(f"high CPU ({cpu:.0f}%)")
        if lat > 1.0:
            parts.append(f"high API latency ({lat:.1f}s)")
        if restarts > 0:
            parts.append(f"{restarts} restart(s)")

        if not parts:
            parts.append("highest correlation with cluster CPU spike")

        return f"{service}: " + ", ".join(parts)
