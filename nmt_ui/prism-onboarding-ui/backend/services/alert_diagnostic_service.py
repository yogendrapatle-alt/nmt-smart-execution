"""
Alert Diagnostic Service

Generates rich diagnostic context for each alert type so testers can
understand what happened, why, when, and whether action is needed.

Reuses Prometheus queries proven in enhanced_report_service._collect_cluster_health().
"""

import json
import logging
import re
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import requests
from urllib.parse import urljoin

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _prom_query(prom_url: str, query: str, timeout: float = 12.0) -> List[Dict]:
    try:
        url = urljoin(prom_url.rstrip('/') + '/', 'api/v1/query')
        resp = requests.get(url, params={'query': query}, verify=False, timeout=timeout)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('status') == 'success':
                return data.get('data', {}).get('result', [])
    except Exception as e:
        logger.debug(f"Prometheus query failed ({query[:60]}...): {e}")
    return []


def _resolve_prom_url_for_testbed(testbed_id: str) -> Optional[str]:
    """Resolve a working Prometheus URL for a testbed."""
    try:
        import psycopg2
        conn = psycopg2.connect(dbname="alerts", user="alertuser",
                                password="alertpass", host="localhost", port="5432")
        cur = conn.cursor()
        cur.execute("SELECT ncm_ip, testbed_json FROM testbeds WHERE unique_testbed_id = %s", (testbed_id,))
        row = cur.fetchone()
        cur.close()
        conn.close()
        if not row:
            return None
        ncm_ip = row[0]
        testbed_json = row[1]
        if isinstance(testbed_json, str):
            testbed_json = json.loads(testbed_json)
        prom_ep = None
        if isinstance(testbed_json, dict):
            prom_ep = testbed_json.get('prometheus_endpoint')
            if not prom_ep and ncm_ip:
                port = testbed_json.get('prometheus_port', 31943)
                prom_ep = f"https://{ncm_ip}:{port}"
        if not prom_ep and ncm_ip:
            prom_ep = f"https://{ncm_ip}:31943"
        if prom_ep:
            from services.prometheus_url import resolve_working_prometheus_url
            return resolve_working_prometheus_url(prom_ep)
        return None
    except Exception as e:
        logger.debug(f"Could not resolve Prometheus URL for testbed {testbed_id}: {e}")
        return None


def _format_duration(minutes: Optional[float]) -> str:
    if minutes is None:
        return "Still active"
    m = abs(minutes)
    if m < 1:
        return f"{int(m * 60)}s"
    if m < 60:
        return f"{int(m)}m"
    h = int(m // 60)
    rm = int(m % 60)
    if h < 24:
        return f"{h}h {rm}m" if rm else f"{h}h"
    d = h // 24
    rh = h % 24
    return f"{d}d {rh}h"


def _get_related_alerts(alert_id: int, testbed_id: str, created_at: datetime,
                        window_minutes: int = 30) -> List[Dict]:
    """Find other alerts on the same testbed within a time window."""
    try:
        import psycopg2
        conn = psycopg2.connect(dbname="alerts", user="alertuser",
                                password="alertpass", host="localhost", port="5432")
        cur = conn.cursor()
        start = created_at - timedelta(minutes=window_minutes)
        end = created_at + timedelta(minutes=window_minutes)
        cur.execute("""
            SELECT a.id, a.alert_type, a.severity, a.status, a.message,
                   a.created_at, t.testbed_label
            FROM alert_summaries a
            LEFT JOIN testbeds t ON a.testbed_id = t.unique_testbed_id
            WHERE a.testbed_id = %s AND a.id != %s
              AND a.created_at BETWEEN %s AND %s
            ORDER BY a.created_at
            LIMIT 10
        """, (testbed_id, alert_id, start, end))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return [{
            'id': r[0], 'alert_type': r[1], 'severity': r[2], 'status': r[3],
            'message': r[4],
            'timestamp': r[5].isoformat() + 'Z' if r[5] else None,
        } for r in rows]
    except Exception as e:
        logger.debug(f"Error fetching related alerts: {e}")
        return []


def _get_running_executions(testbed_id: str, at_time: datetime) -> List[Dict]:
    """Check if a smart execution was running on this testbed at the alert time."""
    try:
        import psycopg2
        conn = psycopg2.connect(dbname="alerts", user="alertuser",
                                password="alertpass", host="localhost", port="5432")
        cur = conn.cursor()
        cur.execute("""
            SELECT execution_id, status, start_time, end_time
            FROM smart_executions
            WHERE testbed_id = %s
              AND start_time <= %s
              AND (end_time IS NULL OR end_time >= %s)
            ORDER BY start_time DESC
            LIMIT 3
        """, (testbed_id, at_time, at_time - timedelta(minutes=10)))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return [{
            'execution_id': r[0], 'status': r[1],
            'start_time': r[2].isoformat() + 'Z' if r[2] else None,
            'end_time': r[3].isoformat() + 'Z' if r[3] else None,
        } for r in rows]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Short Diagnosis Generator (for list view)
# ---------------------------------------------------------------------------

def generate_short_diagnosis(alert_type: str, metric_value: Optional[float],
                             threshold_value: Optional[float],
                             duration_minutes: Optional[float],
                             status: str,
                             diagnostic_context: Optional[Dict] = None) -> str:
    """One-line tester-friendly explanation for the alert list view."""
    if metric_value is None or threshold_value is None:
        return f"{alert_type} detected"

    dur = _format_duration(duration_minutes)
    val = f"{metric_value:.1f}"
    thr = f"{threshold_value:.1f}"
    active = status.lower() in ('active', 'firing', 'acknowledged')
    ctx = diagnostic_context or {}

    if alert_type == 'High CPU Usage':
        if active:
            return f"CPU at {val}% (threshold {thr}%) -- active, check for resource-heavy pods"
        return f"CPU spiked to {val}% (threshold {thr}%), lasted {dur} then recovered"

    if alert_type == 'High Memory Usage':
        if active:
            return f"Memory at {val}% (threshold {thr}%) -- active, OOM risk if it climbs further"
        return f"Memory peaked at {val}% (threshold {thr}%), recovered after {dur}"

    if alert_type == 'High Disk Usage':
        if active:
            return f"Disk at {val}% (threshold {thr}%) -- active, check PVC usage and logs"
        return f"Disk usage hit {val}% (threshold {thr}%), resolved after {dur}"

    if alert_type == 'Pod Restarts':
        count = int(abs(metric_value)) if metric_value else 0
        pods = ctx.get('affected_pods', [])
        pod_info = ''
        if pods:
            pod_names = [p.get('pod', '') for p in pods[:3] if p.get('pod')]
            reasons = set(p.get('reason', '') for p in pods if p.get('reason'))
            if pod_names:
                pod_info = f" — pods: {', '.join(pod_names)}"
            if reasons - {''}:
                pod_info += f" ({', '.join(reasons - {''})})"
        if active:
            return f"{count} pod restarts detected (threshold {thr}){pod_info}"
        return f"{count} pod restarts detected, lasted {dur}{pod_info}"

    if alert_type == 'Network Latency':
        if active:
            return f"Latency at {val}ms (threshold {thr}ms) -- active, check API server and network"
        return f"Latency spiked to {val}ms (threshold {thr}ms), recovered after {dur}"

    if alert_type == 'Operation Failures':
        if active:
            return f"Failure rate at {val}% (threshold {thr}%) -- operations failing, check NCM logs"
        return f"Failure rate was {val}% (threshold {thr}%), recovered after {dur}"

    return f"{alert_type}: value {val} vs threshold {thr}"


def is_actionable(alert_type: str, severity: str, status: str,
                  metric_value: Optional[float], threshold_value: Optional[float]) -> bool:
    """Determine if an alert requires tester attention."""
    active = status.lower() in ('active', 'firing', 'acknowledged')
    if not active:
        return False
    if severity.lower() == 'critical':
        return True
    if metric_value and threshold_value and threshold_value > 0:
        ratio = metric_value / threshold_value
        if ratio > 1.2:
            return True
    if alert_type == 'Pod Restarts' and metric_value and metric_value > 3:
        return True
    return False


# ---------------------------------------------------------------------------
# Full Diagnostic Detail (for detail modal)
# ---------------------------------------------------------------------------

class AlertDiagnosticService:
    """Generates rich diagnostic detail for a single alert."""

    def __init__(self, prom_url: Optional[str] = None):
        self.prom_url = prom_url

    def diagnose(self, alert: Dict) -> Dict:
        """
        Generate full diagnostic for an alert.
        Returns: {timeline, root_cause, impact_assessment, recommendation,
                  related_alerts, live_data, metric_context}
        """
        alert_type = alert.get('alert_type', '')
        testbed_id = alert.get('testbed_id', '')
        metric_value = alert.get('metric_value')
        threshold_value = alert.get('threshold_value')
        created_at = alert.get('created_at')
        acknowledged_at = alert.get('acknowledged_at')
        resolved_at = alert.get('resolved_at')
        status = alert.get('status', '')
        alert_id = alert.get('id', 0)
        duration_minutes = alert.get('duration_minutes')

        if isinstance(created_at, str):
            try:
                created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            except Exception:
                created_at = datetime.now(timezone.utc)

        timeline = self._build_timeline(alert_type, created_at, acknowledged_at,
                                         resolved_at, status)

        related = _get_related_alerts(alert_id, testbed_id, created_at)
        running_execs = _get_running_executions(testbed_id, created_at)

        live_data = {}
        if self.prom_url:
            live_data = self._fetch_live_data(alert_type)

        metric_context = self._build_metric_context(
            alert_type, metric_value, threshold_value, duration_minutes)

        root_cause = self._infer_root_cause(
            alert_type, metric_value, threshold_value, live_data, running_execs, related)

        impact = self._assess_impact(
            alert_type, status, metric_value, threshold_value, live_data, related)

        recommendation = self._generate_recommendation(
            alert_type, status, metric_value, threshold_value, live_data, running_execs)

        if running_execs:
            timeline.append({
                'timestamp': running_execs[0].get('start_time', ''),
                'event': f"Smart Execution {running_execs[0]['execution_id']} was running on this testbed",
                'type': 'context',
            })
            timeline.sort(key=lambda x: x.get('timestamp', ''))

        return {
            'timeline': timeline,
            'root_cause': root_cause,
            'impact_assessment': impact,
            'recommendation': recommendation,
            'related_alerts': related,
            'running_executions': running_execs,
            'live_data': live_data,
            'metric_context': metric_context,
            'prometheus_available': bool(self.prom_url and live_data),
        }

    def _build_timeline(self, alert_type: str, created_at, acknowledged_at,
                        resolved_at, status: str) -> List[Dict]:
        events = []

        def _ts(dt):
            if dt is None:
                return None
            if isinstance(dt, str):
                return dt
            return dt.isoformat() + 'Z' if dt.tzinfo is None else dt.isoformat()

        events.append({
            'timestamp': _ts(created_at),
            'event': f'{alert_type} alert triggered',
            'type': 'fired',
        })

        if acknowledged_at:
            events.append({
                'timestamp': _ts(acknowledged_at),
                'event': 'Alert acknowledged',
                'type': 'acknowledged',
            })

        if resolved_at:
            events.append({
                'timestamp': _ts(resolved_at),
                'event': 'Alert resolved -- metrics returned below threshold',
                'type': 'resolved',
            })
        elif status.lower() in ('active', 'firing'):
            events.append({
                'timestamp': _ts(datetime.now(timezone.utc)),
                'event': 'Alert is still active',
                'type': 'active',
            })

        return events

    def _build_metric_context(self, alert_type: str, value: Optional[float],
                               threshold: Optional[float],
                               duration_minutes: Optional[float]) -> Dict:
        if value is None or threshold is None:
            return {}
        exceeded_by = value - threshold
        exceeded_pct = (exceeded_by / threshold * 100) if threshold > 0 else 0
        units = {
            'High CPU Usage': '%', 'High Memory Usage': '%', 'High Disk Usage': '%',
            'Pod Restarts': ' restarts', 'Network Latency': 'ms',
            'Operation Failures': '% failure rate',
        }
        unit = units.get(alert_type, '')
        return {
            'value': round(value, 1),
            'threshold': round(threshold, 1),
            'unit': unit,
            'exceeded_by': round(abs(exceeded_by), 1),
            'exceeded_pct': round(exceeded_pct, 1),
            'duration': _format_duration(duration_minutes),
            'over_threshold': value > threshold,
        }

    def _fetch_live_data(self, alert_type: str) -> Dict:
        """Fetch relevant live Prometheus data based on alert type."""
        if not self.prom_url:
            return {}
        data: Dict[str, Any] = {}
        try:
            if alert_type == 'Pod Restarts':
                data['recent_restarts'] = self._query_restarts()
                data['termination_reasons'] = self._query_termination_reasons()
                data['oom_killed'] = self._query_oom()
            elif alert_type == 'High CPU Usage':
                data['top_cpu_pods'] = self._query_top_cpu()
                data['cpu_throttling'] = self._query_throttle()
            elif alert_type == 'High Memory Usage':
                data['top_memory_pods'] = self._query_top_memory()
                data['oom_killed'] = self._query_oom()
            elif alert_type == 'High Disk Usage':
                data['pvc_usage'] = self._query_pvc()
            elif alert_type == 'Network Latency':
                data['api_latency'] = self._query_api_latency()
            elif alert_type == 'Operation Failures':
                data['unhealthy_pods'] = self._query_unhealthy_pods()
                data['recent_restarts'] = self._query_restarts()
        except Exception as e:
            logger.debug(f"Live data fetch error: {e}")
        return data

    def _query_restarts(self) -> List[Dict]:
        results = _prom_query(self.prom_url,
            'topk(15, increase(kube_pod_container_status_restarts_total{container!=""}[1h]))')
        out = []
        for r in results:
            m = r.get('metric', {})
            count = float(r.get('value', [0, 0])[1])
            if count >= 1:
                out.append({
                    'pod': m.get('pod', 'unknown'), 'namespace': m.get('namespace', 'unknown'),
                    'container': m.get('container', 'unknown'), 'restart_count_1h': int(count),
                })
        return out

    def _query_termination_reasons(self) -> List[Dict]:
        results = _prom_query(self.prom_url,
            'kube_pod_container_status_last_terminated_reason')
        out = []
        for r in results:
            m = r.get('metric', {})
            val = float(r.get('value', [0, 0])[1])
            if val >= 1:
                out.append({
                    'pod': m.get('pod', 'unknown'), 'namespace': m.get('namespace', 'unknown'),
                    'container': m.get('container', 'unknown'), 'reason': m.get('reason', 'unknown'),
                })
        return out

    def _query_oom(self) -> List[Dict]:
        results = _prom_query(self.prom_url,
            'kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}')
        out = []
        for r in results:
            m = r.get('metric', {})
            val = float(r.get('value', [0, 0])[1])
            if val >= 1:
                out.append({
                    'pod': m.get('pod', 'unknown'), 'namespace': m.get('namespace', 'unknown'),
                    'container': m.get('container', 'unknown'),
                })
        return out

    def _query_top_cpu(self) -> List[Dict]:
        results = _prom_query(self.prom_url,
            'topk(10, sum(rate(container_cpu_usage_seconds_total{container!="", container!="POD"}[1m])) by (pod, namespace))')
        out = []
        for r in results:
            m = r.get('metric', {})
            cores = float(r.get('value', [0, 0])[1])
            out.append({
                'pod': m.get('pod', 'unknown'), 'namespace': m.get('namespace', 'unknown'),
                'cpu_cores': round(cores, 3), 'cpu_pct': round(min(cores * 100, 100), 1),
            })
        return out

    def _query_throttle(self) -> List[Dict]:
        results = _prom_query(self.prom_url,
            'topk(10, rate(container_cpu_cfs_throttled_periods_total{container!="", image!=""}[5m]) / rate(container_cpu_cfs_periods_total{container!="", image!=""}[5m]))')
        out = []
        for r in results:
            m = r.get('metric', {})
            ratio = float(r.get('value', [0, 0])[1])
            if ratio > 0.01:
                out.append({
                    'pod': m.get('pod', 'unknown'), 'namespace': m.get('namespace', 'unknown'),
                    'container': m.get('container', 'unknown'),
                    'throttle_pct': round(ratio * 100, 1),
                })
        return out

    def _query_top_memory(self) -> List[Dict]:
        results = _prom_query(self.prom_url,
            'topk(10, sum(container_memory_working_set_bytes{container!="", container!="POD"}) by (pod, namespace))')
        out = []
        for r in results:
            m = r.get('metric', {})
            mem = float(r.get('value', [0, 0])[1])
            out.append({
                'pod': m.get('pod', 'unknown'), 'namespace': m.get('namespace', 'unknown'),
                'memory_mb': round(mem / (1024 * 1024), 1),
            })
        return out

    def _query_pvc(self) -> List[Dict]:
        cap_data = _prom_query(self.prom_url, 'kubelet_volume_stats_capacity_bytes')
        used_data = _prom_query(self.prom_url, 'kubelet_volume_stats_used_bytes')
        used_map = {}
        for r in used_data:
            m = r.get('metric', {})
            key = (m.get('namespace', ''), m.get('persistentvolumeclaim', ''))
            used_map[key] = float(r.get('value', [0, 0])[1])
        out = []
        for r in cap_data:
            m = r.get('metric', {})
            ns = m.get('namespace', '')
            pvc = m.get('persistentvolumeclaim', '')
            cap = float(r.get('value', [0, 0])[1])
            used = used_map.get((ns, pvc), 0)
            pct = (used / cap * 100) if cap > 0 else 0
            if pct > 30:
                out.append({
                    'namespace': ns, 'pvc_name': pvc,
                    'capacity_gb': round(cap / (1024**3), 2),
                    'used_gb': round(used / (1024**3), 2),
                    'usage_pct': round(pct, 1),
                })
        return sorted(out, key=lambda x: x['usage_pct'], reverse=True)[:10]

    def _query_api_latency(self) -> List[Dict]:
        results = _prom_query(self.prom_url,
            'histogram_quantile(0.99, sum(rate(apiserver_request_duration_seconds_bucket{verb!="WATCH"}[5m])) by (le, verb, resource))')
        out = []
        for r in results:
            m = r.get('metric', {})
            latency = float(r.get('value', [0, 0])[1])
            if latency > 0.5 and latency == latency:
                out.append({
                    'verb': m.get('verb', ''), 'resource': m.get('resource', ''),
                    'p99_seconds': round(latency, 2),
                })
        return sorted(out, key=lambda x: x['p99_seconds'], reverse=True)[:10]

    def _query_unhealthy_pods(self) -> List[Dict]:
        results = _prom_query(self.prom_url,
            'kube_pod_container_status_waiting_reason{reason!=""}')
        out = []
        for r in results:
            m = r.get('metric', {})
            val = float(r.get('value', [0, 0])[1])
            if val >= 1:
                out.append({
                    'pod': m.get('pod', 'unknown'), 'namespace': m.get('namespace', 'unknown'),
                    'container': m.get('container', 'unknown'), 'reason': m.get('reason', 'unknown'),
                })
        return out

    # ------------------------------------------------------------------
    # Root cause inference
    # ------------------------------------------------------------------
    def _infer_root_cause(self, alert_type: str, value, threshold,
                          live_data: Dict, execs: List, related: List) -> str:
        exec_note = ""
        if execs:
            exec_note = (f" This correlates with Smart Execution "
                        f"{execs[0]['execution_id']} running on the testbed at the time.")

        if alert_type == 'Pod Restarts':
            restarts = live_data.get('recent_restarts', [])
            ooms = live_data.get('oom_killed', [])
            reasons = live_data.get('termination_reasons', [])
            if ooms:
                pods = ', '.join(set(o['pod'] for o in ooms[:3]))
                return (f"Pods were OOMKilled (out of memory): {pods}. "
                        f"Memory usage exceeded container limits under load.{exec_note}")
            if reasons:
                reason_summary = defaultdict(list)
                for r in reasons:
                    reason_summary[r['reason']].append(r['pod'])
                parts = [f"{reason}: {', '.join(set(pods[:2]))}"
                         for reason, pods in reason_summary.items()]
                return f"Container terminations detected -- {'; '.join(parts)}.{exec_note}"
            if restarts:
                pods = ', '.join(set(r['pod'] for r in restarts[:3]))
                total = sum(r.get('restart_count_1h', 0) for r in restarts)
                return (f"{total} restarts across pods: {pods} in the last hour. "
                        f"Check pod logs for crash reasons.{exec_note}")
            count = int(abs(value)) if value else 0
            return (f"{count} container restarts detected. Pods may be crashing due to "
                    f"resource limits, configuration errors, or dependency failures.{exec_note}")

        if alert_type == 'High CPU Usage':
            top_pods = live_data.get('top_cpu_pods', [])
            throttled = live_data.get('cpu_throttling', [])
            if top_pods:
                top = top_pods[0]
                top_list = ', '.join(f"{p['pod']} ({p['cpu_pct']}%)" for p in top_pods[:3])
                cause = f"Top CPU consumers: {top_list}."
                if throttled:
                    cause += f" {len(throttled)} containers are being CPU-throttled."
                return cause + exec_note
            return (f"CPU reached {value:.1f}% (threshold {threshold:.1f}%). "
                    f"High cluster load from running workloads.{exec_note}")

        if alert_type == 'High Memory Usage':
            top_pods = live_data.get('top_memory_pods', [])
            ooms = live_data.get('oom_killed', [])
            if ooms:
                pods = ', '.join(set(o['pod'] for o in ooms[:3]))
                return (f"OOMKilled containers detected: {pods}. Memory pressure is causing "
                        f"container kills.{exec_note}")
            if top_pods:
                top_list = ', '.join(f"{p['pod']} ({p['memory_mb']:.0f}MB)" for p in top_pods[:3])
                return f"Top memory consumers: {top_list}.{exec_note}"
            return (f"Memory at {value:.1f}% (threshold {threshold:.1f}%). "
                    f"Cluster under memory pressure.{exec_note}")

        if alert_type == 'High Disk Usage':
            pvcs = live_data.get('pvc_usage', [])
            if pvcs:
                top = pvcs[0]
                return (f"PVC {top['pvc_name']} in {top['namespace']} is at "
                        f"{top['usage_pct']}% ({top['used_gb']:.1f}GB / {top['capacity_gb']:.1f}GB). "
                        f"Log accumulation or data growth.{exec_note}")
            return (f"Disk usage at {value:.1f}% (threshold {threshold:.1f}%). "
                    f"Check log files and PVC usage.{exec_note}")

        if alert_type == 'Network Latency':
            latencies = live_data.get('api_latency', [])
            if latencies:
                top = latencies[0]
                return (f"API server P99 latency is {top['p99_seconds']}s for "
                        f"{top['verb']} {top['resource']}. High cluster load "
                        f"is degrading API responsiveness.{exec_note}")
            return (f"Network latency at {value:.1f}ms (threshold {threshold:.1f}ms). "
                    f"API server or network under stress.{exec_note}")

        if alert_type == 'Operation Failures':
            unhealthy = live_data.get('unhealthy_pods', [])
            restarts = live_data.get('recent_restarts', [])
            parts = []
            if unhealthy:
                reasons = set(u['reason'] for u in unhealthy)
                parts.append(f"Unhealthy pods detected ({', '.join(reasons)})")
            if restarts:
                parts.append(f"{len(restarts)} pods restarting")
            if parts:
                return (f"Operation failure rate at {value:.1f}%. "
                        f"Likely caused by: {'; '.join(parts)}.{exec_note}")
            return (f"Operation failure rate at {value:.1f}% (threshold {threshold:.1f}%). "
                    f"NCM operations failing under load.{exec_note}")

        return f"{alert_type}: value {value} exceeded threshold {threshold}.{exec_note}"

    # ------------------------------------------------------------------
    # Impact assessment
    # ------------------------------------------------------------------
    def _assess_impact(self, alert_type: str, status: str, value, threshold,
                       live_data: Dict, related: List) -> str:
        active = status.lower() in ('active', 'firing', 'acknowledged')
        severity = "ACTIVE" if active else "RESOLVED"
        related_count = len(related)
        related_note = (f" {related_count} other alerts fired on this testbed in "
                       f"the same time window.") if related_count else ""

        if alert_type == 'Pod Restarts':
            ooms = live_data.get('oom_killed', [])
            restarts = live_data.get('recent_restarts', [])
            if ooms:
                return (f"{severity} -- OOMKilled pods disrupt NCM services. "
                        f"Blueprint and application operations will fail during restarts.{related_note}")
            if restarts and len(restarts) > 2:
                return (f"{severity} -- Multiple pod restarts indicate instability. "
                        f"This can cause intermittent operation failures.{related_note}")
            return f"{severity} -- Pod restarts detected. Monitor for recurring crashes.{related_note}"

        if alert_type == 'High CPU Usage':
            if value and value > 90:
                return (f"{severity} -- CPU at {value:.0f}% is critically high. "
                        f"Operations will timeout or fail. Immediate attention needed.{related_note}")
            return (f"{severity} -- Elevated CPU usage may slow API responses "
                    f"and operation throughput.{related_note}")

        if alert_type == 'High Memory Usage':
            if value and value > 90:
                return (f"{severity} -- Memory at {value:.0f}% risks OOMKill of critical pods. "
                        f"Services may become unavailable.{related_note}")
            return (f"{severity} -- Elevated memory usage. If it continues climbing, "
                    f"pods may be OOMKilled.{related_note}")

        if alert_type == 'High Disk Usage':
            return (f"{severity} -- High disk usage can prevent log writes and "
                    f"cause service failures.{related_note}")

        if alert_type == 'Network Latency':
            return (f"{severity} -- High latency degrades all API operations and "
                    f"may cause timeouts in NCM workflows.{related_note}")

        if alert_type == 'Operation Failures':
            return (f"{severity} -- Operations failing at {value:.1f}% rate. "
                    f"This indicates NCM service degradation under load.{related_note}")

        return f"{severity} -- {alert_type} detected.{related_note}"

    # ------------------------------------------------------------------
    # Recommendation
    # ------------------------------------------------------------------
    def _generate_recommendation(self, alert_type: str, status: str,
                                 value, threshold,
                                 live_data: Dict, execs: List) -> str:
        active = status.lower() in ('active', 'firing', 'acknowledged')
        exec_note = ""
        if execs:
            exec_note = (f" A smart execution was running -- this may be expected "
                        f"load-test behavior. Review the execution report for details.")

        if alert_type == 'Pod Restarts':
            ooms = live_data.get('oom_killed', [])
            if ooms:
                pods = ', '.join(set(o['pod'] for o in ooms[:2]))
                return (f"ACTION: Increase memory limits for {pods}. "
                        f"Check NCM pod resource requests/limits in Kubernetes.{exec_note}")
            if active:
                return (f"ACTION: Check pod logs with 'kubectl logs <pod> --previous' "
                        f"to identify crash reason. Look for OOMKill, CrashLoopBackOff, "
                        f"or application errors.{exec_note}")
            return (f"RESOLVED: Pods recovered. Review restart history to identify "
                    f"if this is a recurring pattern.{exec_note}")

        if alert_type == 'High CPU Usage':
            if active and value and value > 90:
                return (f"ACTION: Identify top CPU consumers and consider scaling down "
                        f"workload intensity or increasing node resources.{exec_note}")
            if active:
                return (f"MONITOR: CPU elevated but manageable. Watch for sustained "
                        f"increase that could impact operations.{exec_note}")
            return f"RESOLVED: CPU recovered. No action needed.{exec_note}"

        if alert_type == 'High Memory Usage':
            ooms = live_data.get('oom_killed', [])
            if ooms:
                return (f"ACTION: OOMKills detected. Increase memory limits for affected pods "
                        f"or reduce workload intensity.{exec_note}")
            if active:
                return (f"MONITOR: Memory elevated. If it continues climbing, "
                        f"consider reducing concurrent operations.{exec_note}")
            return f"RESOLVED: Memory pressure subsided.{exec_note}"

        if alert_type == 'High Disk Usage':
            if active:
                return (f"ACTION: Check PVC usage, clean old logs, and verify no "
                        f"runaway log files. Consider expanding PVCs.{exec_note}")
            return f"RESOLVED: Disk usage decreased.{exec_note}"

        if alert_type == 'Network Latency':
            if active:
                return (f"ACTION: Check API server health, etcd performance, and "
                        f"network connectivity between components.{exec_note}")
            return f"RESOLVED: Latency returned to normal.{exec_note}"

        if alert_type == 'Operation Failures':
            if active:
                return (f"ACTION: Check NCM pod health and logs. Look for connection "
                        f"timeouts, rate limiting (429), or service unavailable (503).{exec_note}")
            return f"RESOLVED: Operation success rate recovered.{exec_note}"

        return f"Review alert details and cluster state.{exec_note}"
