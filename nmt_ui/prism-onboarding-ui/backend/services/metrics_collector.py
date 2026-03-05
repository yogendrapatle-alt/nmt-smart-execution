"""
Metrics Collector Service
Collects system metrics from Prometheus during execution for analysis and reporting
Enhanced with pod-level metrics and entity-level operation tracking
"""

import requests
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import urllib3

# Disable SSL warnings for self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger(__name__)

class MetricsCollector:
    """Collects and stores metrics from Prometheus during execution"""
    
    def __init__(self, prometheus_url: str, ncm_ip: Optional[str] = None):
        """
        Initialize metrics collector
        
        Args:
            prometheus_url: Full Prometheus endpoint URL (e.g., https://10.115.150.47:31943)
            ncm_ip: NCM IP address for pod-specific queries
        """
        # Auto-correct HTTP to HTTPS if needed (Prometheus typically uses HTTPS)
        if prometheus_url.startswith('http://'):
            prometheus_url = prometheus_url.replace('http://', 'https://')
            logger.info(f"Auto-corrected Prometheus URL to HTTPS: {prometheus_url}")
        
        self.prometheus_url = prometheus_url.rstrip('/')
        self.api_url = f"{self.prometheus_url}/api/v1"
        self.ncm_ip = ncm_ip
        logger.info(f"MetricsCollector initialized with Prometheus: {self.prometheus_url}, NCM IP: {ncm_ip}")
    
    def query_prometheus(self, query: str, time: Optional[str] = None) -> Optional[Dict]:
        """
        Query Prometheus with a PromQL expression
        
        Args:
            query: PromQL query string
            time: Optional timestamp for query (default: current time)
            
        Returns:
            Query result or None if failed
        """
        try:
            params = {'query': query}
            if time:
                params['time'] = time
            
            response = requests.get(
                f"{self.api_url}/query",
                params=params,
                verify=False,
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            
            if data.get('status') == 'success':
                return data.get('data', {})
            else:
                logging.error(f"Prometheus query failed: {data.get('error')}")
                return None
                
        except Exception as e:
            logging.error(f"Error querying Prometheus: {e}")
            return None
    
    def query_range(self, query: str, start: datetime, end: datetime, step: str = '15s') -> Optional[Dict]:
        """
        Query Prometheus for a time range
        
        Args:
            query: PromQL query string
            start: Start time
            end: End time
            step: Query resolution (default: 15s)
            
        Returns:
            Range query result or None if failed
        """
        try:
            params = {
                'query': query,
                'start': start.isoformat(),
                'end': end.isoformat(),
                'step': step
            }
            
            response = requests.get(
                f"{self.api_url}/query_range",
                params=params,
                verify=False,
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            
            if data.get('status') == 'success':
                return data.get('data', {})
            else:
                logging.error(f"Prometheus range query failed: {data.get('error')}")
                return None
                
        except Exception as e:
            logging.error(f"Error querying Prometheus range: {e}")
            return None
    
    def collect_cpu_metrics(self, start: datetime, end: datetime) -> Dict:
        """Collect CPU metrics for the execution period"""
        try:
            # Average CPU usage across all nodes
            avg_cpu_query = '100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)'
            avg_cpu_data = self.query_range(avg_cpu_query, start, end)
            
            # Max CPU usage
            max_cpu_query = '100 - (min by(instance) (rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)'
            max_cpu_data = self.query_range(max_cpu_query, start, end)
            
            # Process CPU usage metrics
            cpu_metrics = {
                'average': self._process_metric_values(avg_cpu_data),
                'maximum': self._process_metric_values(max_cpu_data),
                'summary': self._calculate_summary(avg_cpu_data)
            }
            
            logging.info(f"Collected CPU metrics: avg={cpu_metrics['summary'].get('avg', 0):.2f}%, max={cpu_metrics['summary'].get('max', 0):.2f}%")
            return cpu_metrics
            
        except Exception as e:
            logging.error(f"Error collecting CPU metrics: {e}")
            return {'error': str(e)}
    
    def collect_memory_metrics(self, start: datetime, end: datetime) -> Dict:
        """Collect memory metrics for the execution period"""
        try:
            # Memory usage percentage
            memory_query = '(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100'
            memory_data = self.query_range(memory_query, start, end)
            
            # Memory available
            mem_available_query = 'node_memory_MemAvailable_bytes / 1024 / 1024 / 1024'  # Convert to GB
            mem_available_data = self.query_range(mem_available_query, start, end)
            
            memory_metrics = {
                'usage_percentage': self._process_metric_values(memory_data),
                'available_gb': self._process_metric_values(mem_available_data),
                'summary': self._calculate_summary(memory_data)
            }
            
            logging.info(f"Collected Memory metrics: avg={memory_metrics['summary'].get('avg', 0):.2f}%, max={memory_metrics['summary'].get('max', 0):.2f}%")
            return memory_metrics
            
        except Exception as e:
            logging.error(f"Error collecting memory metrics: {e}")
            return {'error': str(e)}
    
    def collect_latency_metrics(self, start: datetime, end: datetime) -> Dict:
        """Collect API latency metrics for the execution period"""
        try:
            # API response time (if available)
            latency_query = 'histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[1m]))'
            latency_data = self.query_range(latency_query, start, end)
            
            # Fallback to network latency if API metrics not available
            if not latency_data or not latency_data.get('result'):
                latency_query = 'rate(node_network_receive_bytes_total[1m])'
                latency_data = self.query_range(latency_query, start, end)
            
            latency_metrics = {
                'p95_ms': self._process_metric_values(latency_data),
                'summary': self._calculate_summary(latency_data)
            }
            
            logging.info(f"Collected Latency metrics: avg={latency_metrics['summary'].get('avg', 0):.2f}ms")
            return latency_metrics
            
        except Exception as e:
            logging.error(f"Error collecting latency metrics: {e}")
            return {'error': str(e)}
    
    def collect_disk_metrics(self, start: datetime, end: datetime) -> Dict:
        """Collect disk I/O metrics for the execution period"""
        try:
            # Disk usage
            disk_query = '(node_filesystem_size_bytes - node_filesystem_free_bytes) / node_filesystem_size_bytes * 100'
            disk_data = self.query_range(disk_query, start, end)
            
            # Disk I/O
            disk_io_query = 'rate(node_disk_io_time_seconds_total[1m])'
            disk_io_data = self.query_range(disk_io_query, start, end)
            
            disk_metrics = {
                'usage_percentage': self._process_metric_values(disk_data),
                'io_time': self._process_metric_values(disk_io_data),
                'summary': self._calculate_summary(disk_data)
            }
            
            logging.info(f"Collected Disk metrics: avg={disk_metrics['summary'].get('avg', 0):.2f}%")
            return disk_metrics
            
        except Exception as e:
            logging.error(f"Error collecting disk metrics: {e}")
            return {'error': str(e)}
    
    def collect_network_metrics(self, start: datetime, end: datetime) -> Dict:
        """Collect network metrics for the execution period"""
        try:
            # Network receive
            net_rx_query = 'rate(node_network_receive_bytes_total[1m]) / 1024 / 1024'  # MB/s
            net_rx_data = self.query_range(net_rx_query, start, end)
            
            # Network transmit
            net_tx_query = 'rate(node_network_transmit_bytes_total[1m]) / 1024 / 1024'  # MB/s
            net_tx_data = self.query_range(net_tx_query, start, end)
            
            network_metrics = {
                'receive_mbps': self._process_metric_values(net_rx_data),
                'transmit_mbps': self._process_metric_values(net_tx_data),
                'summary': {
                    'rx': self._calculate_summary(net_rx_data),
                    'tx': self._calculate_summary(net_tx_data)
                }
            }
            
            logging.info(f"Collected Network metrics: RX avg={network_metrics['summary']['rx'].get('avg', 0):.2f} MB/s")
            return network_metrics
            
        except Exception as e:
            logging.error(f"Error collecting network metrics: {e}")
            return {'error': str(e)}
    
    def collect_alerts_during_execution(self, start: datetime, end: datetime) -> List[Dict]:
        """Collect alerts that fired during execution"""
        try:
            response = requests.get(
                f"{self.api_url}/alerts",
                verify=False,
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            
            if data.get('status') == 'success':
                alerts = data.get('data', {}).get('alerts', [])
                
                # Filter alerts that were active during execution
                execution_alerts = []
                for alert in alerts:
                    alert_time = datetime.fromisoformat(alert.get('activeAt', '').replace('Z', '+00:00'))
                    if start <= alert_time <= end:
                        execution_alerts.append({
                            'name': alert.get('labels', {}).get('alertname', 'Unknown'),
                            'severity': alert.get('labels', {}).get('severity', 'unknown'),
                            'state': alert.get('state', 'unknown'),
                            'activeAt': alert.get('activeAt'),
                            'value': alert.get('value'),
                            'annotations': alert.get('annotations', {})
                        })
                
                logging.info(f"Collected {len(execution_alerts)} alerts during execution")
                return execution_alerts
            
            return []
            
        except Exception as e:
            logging.error(f"Error collecting alerts: {e}")
            return []
    
    def collect_all_metrics(self, start: datetime, end: datetime) -> Dict:
        """
        Collect all available metrics for the execution period
        
        Args:
            start: Execution start time
            end: Execution end time
            
        Returns:
            Dictionary with all collected metrics
        """
        logging.info(f"Collecting metrics from {start} to {end}")
        
        metrics = {
            'collection_time': datetime.now().isoformat(),
            'execution_start': start.isoformat(),
            'execution_end': end.isoformat(),
            'duration_minutes': (end - start).total_seconds() / 60,
            'cpu': self.collect_cpu_metrics(start, end),
            'memory': self.collect_memory_metrics(start, end),
            'latency': self.collect_latency_metrics(start, end),
            'disk': self.collect_disk_metrics(start, end),
            'network': self.collect_network_metrics(start, end),
            'alerts': self.collect_alerts_during_execution(start, end)
        }
        
        logging.info(f"Metrics collection complete: {len(metrics)} categories")
        return metrics
    
    def collect_pod_metrics(self, pod_name: Optional[str] = None, namespace: str = 'ntnx-system') -> Dict[str, Any]:
        """
        Collect pod-level metrics for specific pods or all pods in namespace
        
        Args:
            pod_name: Specific pod name (optional, collects all if None)
            namespace: Kubernetes namespace (default: ntnx-system)
            
        Returns:
            Dictionary with pod-level metrics
        """
        try:
            # Build filters properly to avoid trailing commas
            if pod_name:
                label_filter = f'namespace="{namespace}",pod="{pod_name}"'
            else:
                label_filter = f'namespace="{namespace}"'
            
            # CPU usage per pod
            cpu_query = f'rate(container_cpu_usage_seconds_total{{{label_filter}}}[1m]) * 100'
            cpu_data = self.query_prometheus(cpu_query)
            
            # Memory usage per pod (in MB)
            memory_query = f'container_memory_working_set_bytes{{{label_filter}}} / 1024 / 1024'
            memory_data = self.query_prometheus(memory_query)
            
            # Network I/O per pod
            net_rx_query = f'rate(container_network_receive_bytes_total{{{label_filter}}}[1m]) / 1024 / 1024'
            net_tx_query = f'rate(container_network_transmit_bytes_total{{{label_filter}}}[1m]) / 1024 / 1024'
            net_rx_data = self.query_prometheus(net_rx_query)
            net_tx_data = self.query_prometheus(net_tx_query)
            
            # Process results
            pod_metrics = {}
            
            # Parse CPU data
            if cpu_data and 'result' in cpu_data:
                for result in cpu_data['result']:
                    pod = result.get('metric', {}).get('pod', 'unknown')
                    if pod not in pod_metrics:
                        pod_metrics[pod] = {}
                    pod_metrics[pod]['cpu_percent'] = float(result.get('value', [0, 0])[1])
            
            # Parse Memory data
            if memory_data and 'result' in memory_data:
                for result in memory_data['result']:
                    pod = result.get('metric', {}).get('pod', 'unknown')
                    if pod not in pod_metrics:
                        pod_metrics[pod] = {}
                    pod_metrics[pod]['memory_mb'] = float(result.get('value', [0, 0])[1])
            
            # Parse Network data
            if net_rx_data and 'result' in net_rx_data:
                for result in net_rx_data['result']:
                    pod = result.get('metric', {}).get('pod', 'unknown')
                    if pod not in pod_metrics:
                        pod_metrics[pod] = {}
                    pod_metrics[pod]['network_rx_mbps'] = float(result.get('value', [0, 0])[1])
            
            if net_tx_data and 'result' in net_tx_data:
                for result in net_tx_data['result']:
                    pod = result.get('metric', {}).get('pod', 'unknown')
                    if pod not in pod_metrics:
                        pod_metrics[pod] = {}
                    pod_metrics[pod]['network_tx_mbps'] = float(result.get('value', [0, 0])[1])
            
            logger.info(f"Collected metrics for {len(pod_metrics)} pods")
            return {
                'pods': pod_metrics,
                'namespace': namespace,
                'collected_at': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error collecting pod metrics: {e}")
            return {'error': str(e), 'pods': {}}
    
    def get_instant_metrics_snapshot(self) -> Dict[str, Any]:
        """
        Get an instant snapshot of current metrics (for entity operation tracking)
        
        Returns:
            Dictionary with current metric values
        """
        try:
            snapshot = {
                'timestamp': datetime.now().isoformat(),
                'cpu': {},
                'memory': {},
                'network': {},
                'disk': {}
            }
            
            # CPU
            cpu_query = '100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)'
            cpu_data = self.query_prometheus(cpu_query)
            if cpu_data and 'result' in cpu_data and cpu_data['result']:
                snapshot['cpu']['percent'] = float(cpu_data['result'][0].get('value', [0, 0])[1])
            
            # Memory
            mem_query = '(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100'
            mem_data = self.query_prometheus(mem_query)
            if mem_data and 'result' in mem_data and mem_data['result']:
                snapshot['memory']['percent'] = float(mem_data['result'][0].get('value', [0, 0])[1])
            
            # Network
            net_rx_query = 'rate(node_network_receive_bytes_total{device!="lo"}[1m]) / 1024 / 1024'
            net_tx_query = 'rate(node_network_transmit_bytes_total{device!="lo"}[1m]) / 1024 / 1024'
            
            net_rx_data = self.query_prometheus(net_rx_query)
            if net_rx_data and 'result' in net_rx_data and net_rx_data['result']:
                snapshot['network']['rx_mbps'] = float(net_rx_data['result'][0].get('value', [0, 0])[1])
            
            net_tx_data = self.query_prometheus(net_tx_query)
            if net_tx_data and 'result' in net_tx_data and net_tx_data['result']:
                snapshot['network']['tx_mbps'] = float(net_tx_data['result'][0].get('value', [0, 0])[1])
            
            # Disk
            disk_query = '(node_filesystem_size_bytes - node_filesystem_free_bytes) / node_filesystem_size_bytes * 100'
            disk_data = self.query_prometheus(disk_query)
            if disk_data and 'result' in disk_data and disk_data['result']:
                snapshot['disk']['percent'] = float(disk_data['result'][0].get('value', [0, 0])[1])
            
            return snapshot
            
        except Exception as e:
            logger.error(f"Error getting instant metrics snapshot: {e}")
            return {
                'timestamp': datetime.now().isoformat(),
                'error': str(e)
            }
    
    def get_all_pods_metrics_snapshot(self, namespace: str = 'ntnx-system') -> Dict[str, Dict]:
        """
        Get snapshot of ALL pods with full metrics (CPU, memory, network, namespace, node)
        Similar to Smart Execution's pod metrics snapshot
        
        Args:
            namespace: Kubernetes namespace to query (default: ntnx-system)
            
        Returns:
            Dictionary keyed by pod_name with full pod metrics
        """
        try:
            import requests
            
            url = f"{self.api_url}/query"
            pods_dict = {}
            
            # Query for pod info (includes namespace and node)
            pod_info_query = 'kube_pod_info'
            try:
                response = requests.get(url, params={'query': pod_info_query}, verify=False, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if data.get('status') == 'success':
                        for result in data.get('data', {}).get('result', []):
                            metric = result.get('metric', {})
                            pod_name = metric.get('pod', metric.get('exported_pod', 'unknown'))
                            pod_namespace = metric.get('namespace', metric.get('exported_namespace', namespace))
                            pod_node = metric.get('node', 'unknown')
                            
                            # Filter by namespace if specified
                            if namespace and pod_namespace != namespace:
                                continue
                            
                            if pod_name not in pods_dict:
                                pods_dict[pod_name] = {
                                    'namespace': pod_namespace,
                                    'node': pod_node,
                                    'cpu_usage': 0,
                                    'memory_mb': 0,
                                    'network_rx_mbps': 0,
                                    'network_tx_mbps': 0
                                }
            except Exception as e:
                logger.debug(f"Pod info query failed: {e}")
            
            # Get CPU usage per pod
            cpu_query = f'sum(rate(container_cpu_usage_seconds_total{{container!="",container!="POD",namespace="{namespace}"}}[1m])) by (pod, namespace) * 100'
            try:
                response = requests.get(url, params={'query': cpu_query}, verify=False, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if data.get('status') == 'success':
                        for result in data.get('data', {}).get('result', []):
                            metric = result.get('metric', {})
                            pod_name = metric.get('pod', 'unknown')
                            cpu_value = float(result.get('value', [0, 0])[1])
                            if pod_name in pods_dict:
                                pods_dict[pod_name]['cpu_usage'] = cpu_value
            except Exception as e:
                logger.debug(f"CPU query failed: {e}")
            
            # Get memory usage per pod
            memory_query = f'sum(container_memory_working_set_bytes{{container!="",container!="POD",namespace="{namespace}"}}) by (pod, namespace) / 1024 / 1024'
            try:
                response = requests.get(url, params={'query': memory_query}, verify=False, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if data.get('status') == 'success':
                        for result in data.get('data', {}).get('result', []):
                            metric = result.get('metric', {})
                            pod_name = metric.get('pod', 'unknown')
                            memory_mb = float(result.get('value', [0, 0])[1])
                            if pod_name in pods_dict:
                                pods_dict[pod_name]['memory_mb'] = memory_mb
            except Exception as e:
                logger.debug(f"Memory query failed: {e}")
            
            # Get network RX per pod
            network_rx_query = f'sum(rate(container_network_receive_bytes_total{{container!="",container!="POD",namespace="{namespace}"}}[1m])) by (pod, namespace) / 1024 / 1024'
            try:
                response = requests.get(url, params={'query': network_rx_query}, verify=False, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if data.get('status') == 'success':
                        for result in data.get('data', {}).get('result', []):
                            metric = result.get('metric', {})
                            pod_name = metric.get('pod', 'unknown')
                            rx_mbps = float(result.get('value', [0, 0])[1])
                            if pod_name in pods_dict:
                                pods_dict[pod_name]['network_rx_mbps'] = rx_mbps
            except Exception as e:
                logger.debug(f"Network RX query failed: {e}")
            
            # Get network TX per pod
            network_tx_query = f'sum(rate(container_network_transmit_bytes_total{{container!="",container!="POD",namespace="{namespace}"}}[1m])) by (pod, namespace) / 1024 / 1024'
            try:
                response = requests.get(url, params={'query': network_tx_query}, verify=False, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if data.get('status') == 'success':
                        for result in data.get('data', {}).get('result', []):
                            metric = result.get('metric', {})
                            pod_name = metric.get('pod', 'unknown')
                            tx_mbps = float(result.get('value', [0, 0])[1])
                            if pod_name in pods_dict:
                                pods_dict[pod_name]['network_tx_mbps'] = tx_mbps
            except Exception as e:
                logger.debug(f"Network TX query failed: {e}")
            
            logger.debug(f"Collected metrics snapshot for {len(pods_dict)} pods")
            return pods_dict
            
        except Exception as e:
            logger.error(f"Error getting all pods metrics snapshot: {e}")
            return {}
    
    def get_pod_metrics_for_operation(self, pod_name: Optional[str] = None) -> Dict[str, float]:
        """
        Get simplified pod metrics for a specific operation (returns scalars for DB storage)
        
        Args:
            pod_name: Pod name to query (optional)
            
        Returns:
            Dictionary with scalar metrics suitable for DB storage
        """
        try:
            pod_metrics = self.collect_pod_metrics(pod_name)
            
            if 'error' in pod_metrics:
                return {
                    'pod_cpu_percent': 0.0,
                    'pod_memory_mb': 0.0,
                    'pod_network_rx_mbps': 0.0,
                    'pod_network_tx_mbps': 0.0
                }
            
            # Aggregate metrics from all pods if multiple
            pods_data = pod_metrics.get('pods', {})
            if not pods_data:
                return {
                    'pod_cpu_percent': 0.0,
                    'pod_memory_mb': 0.0,
                    'pod_network_rx_mbps': 0.0,
                    'pod_network_tx_mbps': 0.0
                }
            
            # If specific pod, return its metrics
            if pod_name and pod_name in pods_data:
                pod = pods_data[pod_name]
                return {
                    'pod_cpu_percent': pod.get('cpu_percent', 0.0),
                    'pod_memory_mb': pod.get('memory_mb', 0.0),
                    'pod_network_rx_mbps': pod.get('network_rx_mbps', 0.0),
                    'pod_network_tx_mbps': pod.get('network_tx_mbps', 0.0)
                }
            
            # Otherwise, average across all pods
            cpu_vals = [p.get('cpu_percent', 0) for p in pods_data.values() if 'cpu_percent' in p]
            mem_vals = [p.get('memory_mb', 0) for p in pods_data.values() if 'memory_mb' in p]
            rx_vals = [p.get('network_rx_mbps', 0) for p in pods_data.values() if 'network_rx_mbps' in p]
            tx_vals = [p.get('network_tx_mbps', 0) for p in pods_data.values() if 'network_tx_mbps' in p]
            
            return {
                'pod_cpu_percent': sum(cpu_vals) / len(cpu_vals) if cpu_vals else 0.0,
                'pod_memory_mb': sum(mem_vals) / len(mem_vals) if mem_vals else 0.0,
                'pod_network_rx_mbps': sum(rx_vals) / len(rx_vals) if rx_vals else 0.0,
                'pod_network_tx_mbps': sum(tx_vals) / len(tx_vals) if tx_vals else 0.0
            }
            
        except Exception as e:
            logger.error(f"Error getting pod metrics for operation: {e}")
            return {
                'pod_cpu_percent': 0.0,
                'pod_memory_mb': 0.0,
                'pod_network_rx_mbps': 0.0,
                'pod_network_tx_mbps': 0.0
            }
    
    def _process_metric_values(self, data: Optional[Dict]) -> List[Dict]:
        """Process Prometheus metric data into simplified format"""
        if not data or 'result' not in data:
            return []
        
        processed = []
        for result in data.get('result', []):
            metric_info = {
                'labels': result.get('metric', {}),
                'values': []
            }
            
            # Handle both instant queries and range queries
            if 'value' in result:
                # Instant query
                timestamp, value = result['value']
                metric_info['values'].append({
                    'timestamp': datetime.fromtimestamp(timestamp).isoformat(),
                    'value': float(value) if value != 'NaN' else 0.0
                })
            elif 'values' in result:
                # Range query
                for timestamp, value in result['values']:
                    metric_info['values'].append({
                        'timestamp': datetime.fromtimestamp(timestamp).isoformat(),
                        'value': float(value) if value != 'NaN' else 0.0
                    })
            
            processed.append(metric_info)
        
        return processed
    
    def _calculate_summary(self, data: Optional[Dict]) -> Dict:
        """Calculate summary statistics for metric data"""
        if not data or 'result' not in data:
            return {'min': 0, 'max': 0, 'avg': 0, 'current': 0}
        
        all_values = []
        for result in data.get('result', []):
            if 'values' in result:
                all_values.extend([float(v[1]) for v in result['values'] if v[1] != 'NaN'])
            elif 'value' in result:
                value = result['value'][1]
                if value != 'NaN':
                    all_values.append(float(value))
        
        if not all_values:
            return {'min': 0, 'max': 0, 'avg': 0, 'current': 0}
        
        return {
            'min': round(min(all_values), 2),
            'max': round(max(all_values), 2),
            'avg': round(sum(all_values) / len(all_values), 2),
            'current': round(all_values[-1], 2) if all_values else 0
        }


def generate_execution_report(execution_id: str, testbed_info: Dict, workload_config: Dict, 
                              execution_result: Dict, metrics: Dict) -> Dict:
    """
    Generate comprehensive execution report with metrics
    
    Args:
        execution_id: Unique execution identifier
        testbed_info: Testbed information
        workload_config: Workload configuration
        execution_result: Execution result data
        metrics: Collected metrics
        
    Returns:
        Formatted execution report
    """
    report = {
        'report_id': f"{execution_id}-report",
        'generated_at': datetime.now().isoformat(),
        'execution_id': execution_id,
        
        # Testbed Information
        'testbed': {
            'id': testbed_info.get('unique_testbed_id'),
            'label': testbed_info.get('testbed_label'),
            'pc_ip': testbed_info.get('pc_ip'),
            'ncm_ip': testbed_info.get('ncm_ip')
        },
        
        # Workload Configuration
        'workload': {
            'name': workload_config.get('name'),
            'duration_minutes': workload_config.get('duration'),
            'parallelism': workload_config.get('parallelism'),
            'distribution': workload_config.get('distribution'),
            'entities': workload_config.get('entities', {})
        },
        
        # Execution Results
        'execution': {
            'status': execution_result.get('status'),
            'progress': execution_result.get('progress'),
            'start_time': execution_result.get('start_time'),
            'end_time': execution_result.get('end_time'),
            'duration_minutes': execution_result.get('duration_minutes'),
            'stats': execution_result.get('stats', {}),
            'error': execution_result.get('last_error')
        },
        
        # System Metrics
        'metrics': metrics,
        
        # Summary
        'summary': {
            'success': execution_result.get('status') == 'COMPLETED',
            'operations_completed': execution_result.get('stats', {}).get('completed_operations', 0),
            'operations_failed': execution_result.get('stats', {}).get('failed_operations', 0),
            'success_rate': execution_result.get('stats', {}).get('success_rate', 0),
            'avg_cpu': metrics.get('cpu', {}).get('summary', {}).get('avg', 0),
            'max_cpu': metrics.get('cpu', {}).get('summary', {}).get('max', 0),
            'avg_memory': metrics.get('memory', {}).get('summary', {}).get('avg', 0),
            'max_memory': metrics.get('memory', {}).get('summary', {}).get('max', 0),
            'alerts_triggered': len(metrics.get('alerts', []))
        }
    }
    
    logging.info(f"Generated execution report for {execution_id}")
    return report
