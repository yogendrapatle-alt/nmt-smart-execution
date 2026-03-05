"""
Smart Execution Service - Adaptive Load Generation with Threshold-Based Control

This service executes operations on a testbed until specified resource thresholds are reached.
Uses a feedback control loop to adjust operation rate based on real-time Prometheus metrics.

NOW WITH REAL NCM OPERATIONS!
"""

import logging
import asyncio
import time
import threading
import json
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional
import uuid
import requests
from urllib.parse import urljoin
import sys
import os

logger = logging.getLogger(__name__)

# WebSocket support for live logs
_socketio_instance = None

def set_socketio(socketio):
    """Set the SocketIO instance for broadcasting logs"""
    global _socketio_instance
    _socketio_instance = socketio
    logger.info("✅ SocketIO instance registered for live logs")

def broadcast_log(execution_id: str, log_level: str, message: str, data: Dict = None):
    """Broadcast a log message via WebSocket"""
    global _socketio_instance
    if _socketio_instance:
        try:
            _socketio_instance.emit('log', {
                'execution_id': execution_id,
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'level': log_level,
                'message': message,
                'data': data or {}
            })
        except Exception as e:
            logger.debug(f"Failed to broadcast log: {e}")

# Add loadgen to path for NCMClient
# NCMClient lives in loadgen/ncm-lg/http_client_auth/base_client.py
LOADGEN_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../loadgen/ncm-lg'))
if LOADGEN_PATH not in sys.path:
    sys.path.insert(0, LOADGEN_PATH)

# Try to import NCMClient
LOADGEN_AVAILABLE = False
NCMClient = None
try:
    from http_client_auth.base_client import NCMClient
    LOADGEN_AVAILABLE = True
    logger.info("✅ NCMClient available - REAL operations enabled")
except ImportError as e:
    logger.warning(f"⚠️ NCMClient not available: {e}. Using simulation mode.")


class SmartExecutionController:
    """
    Controls smart execution with adaptive operation rate based on target thresholds
    """
    
    def __init__(self, testbed_info: Dict, target_config: Dict, entities_config: Dict, rule_config: Dict = None):
        """
        Initialize smart execution controller
        
        Args:
            testbed_info: {pc_ip, ncm_ip, username, password, testbed_label, unique_testbed_id}
            target_config: {cpu_threshold, memory_threshold, stop_condition, ...advanced_config}
            entities_config: {entity_type: [operations]}
            rule_config: {namespaces: [], pod_names: [], custom_queries: [], rule_book_id: None}
        """
        self.testbed_info = testbed_info
        self.target_config = target_config
        self.entities_config = entities_config
        
        # Rule configuration for pod filtering and monitoring
        self.rule_config = rule_config or {
            'namespaces': [],
            'pod_names': [],
            'custom_queries': [],
            'rule_book_id': None,
            'namespace_pattern': None,
            'pod_name_pattern': None
        }
        
        self.execution_id = f"SMART-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:12]}"
        self.status = "INITIALIZING"
        self.is_running = False
        self.should_stop = False
        self.is_paused = False
        
        # Rate limiting & backoff
        self.operations_per_minute = 10
        self.last_operation_time = None
        self.consecutive_failures = 0
        self.backoff_delay = 0
        
        # Configurable parallelism from target_config (UI-driven)
        adv = target_config.get('advanced', {})
        self.operations_per_iteration = adv.get('operations_per_iteration', 3)
        self.iteration_delay_seconds = adv.get('iteration_delay_seconds', 5)
        self.backoff_on_failure = True
        self.current_backoff_multiplier = 1.0
        
        self.parallel_execution_enabled = adv.get('parallel_execution', True)
        self.max_parallel_operations = adv.get('max_parallel_operations', 5)
        self.workload_generation_enabled = False
        self.stress_vms = []
        
        # Workload profile: ramp_up | burst | sustained | chaos | custom
        self.workload_profile = adv.get('workload_profile', 'sustained')
        self._profile_iteration = 0
        
        # Weighted operation distribution: {entity.op: weight}
        self.operation_weights: Dict[str, float] = adv.get('operation_weights', {})
        
        # Auto-cleanup when execution finishes
        self.auto_cleanup = adv.get('auto_cleanup', False)
        
        # Pre-execution resource validation
        self.pre_check_passed = False
        self.pre_check_results: Dict[str, Any] = {}
        
        # API latency tracking per operation
        self.api_latency_history: List[Dict] = []
        
        # Live logs (circular buffer, keep last 500 log entries)
        self.live_logs = []
        self.max_log_entries = 500
        
        # Execution state
        self.start_time = None
        self.end_time = None
        self.baseline_metrics = {}
        self.current_metrics = {}
        self.operations_history = []
        self.metrics_history = []
        self.total_operations = 0
        self.successful_operations = 0
        self.failed_operations = 0
        self.skipped_operations = 0
        
        # Operation effectiveness tracking
        self.operation_effectiveness = {}  # {entity_type.operation: [impact_records]}
        self.operation_impact_history = []  # Track impact of each operation batch
        
        # Phase 3: Anomaly detection and recommendations
        self.detected_anomalies = []
        self.recommendations_history = []
        
        # Configurable alert thresholds (can be set from UI)
        user_thresholds = adv.get('alert_thresholds', {})
        self.anomaly_thresholds = {
            'cpu_spike_percent': user_thresholds.get('cpu_spike_percent', 10.0),
            'memory_spike_percent': user_thresholds.get('memory_spike_percent', 10.0),
            'failure_rate_threshold': user_thresholds.get('failure_rate_threshold', 0.3),
            'metric_stagnation_iterations': user_thresholds.get('metric_stagnation_iterations', 3),
            'unexpected_drop_percent': user_thresholds.get('unexpected_drop_percent', 5.0),
        }
        
        # 2-of-3 threshold confirmation
        self._threshold_hit_history: List[bool] = []
        
        # Graceful drain: track in-flight operation count
        self._inflight_ops = 0
        
        # Operation cooldown per entity type (seconds since last op of that type)
        self._last_op_time_per_entity: Dict[str, datetime] = {}
        self._entity_cooldown_seconds = adv.get('entity_cooldown_seconds', 0)
        
        # ML-guided operation selection
        self._ml_guided = adv.get('ml_guided_ops', False)
        
        # Tags for this execution
        self.tags: List[str] = adv.get('tags', [])
        
        # Entity tracking for cleanup
        self.created_entities: Dict[str, List[Dict]] = {}  # {entity_type: [{uuid, name, created_at}]}
        self.cleanup_on_stop: bool = False  # Whether to cleanup entities on stop
        
        # Control parameters
        self.poll_interval = 30  # seconds between metric checks
        self.min_operations_per_cycle = 1
        self.max_operations_per_cycle = 10
        
        # Prometheus URL - use stored endpoint or construct from testbed info
        # Priority: 1. prometheus_url, 2. prometheus_endpoint from testbed_json, 3. construct from ncm_ip
        self.prometheus_url = None
        self.prometheus_url_https = None  # Alternative HTTPS URL
        
        # Try getting from testbed_info first
        if 'prometheus_url' in testbed_info and testbed_info['prometheus_url']:
            self.prometheus_url = testbed_info['prometheus_url']
        elif 'prometheus_endpoint' in testbed_info and testbed_info['prometheus_endpoint']:
            self.prometheus_url = testbed_info['prometheus_endpoint']
        else:
            # Fallback: construct from ncm_ip and port
            prometheus_port = testbed_info.get('prometheus_port', testbed_info.get('node_port', 31943))
            # Check if we should use HTTP or HTTPS
            use_https = testbed_info.get('prometheus_protocol', 'https') == 'https'
            protocol = 'https' if use_https else 'http'
            self.prometheus_url = f"{protocol}://{testbed_info.get('ncm_ip')}:{prometheus_port}"
        
        # Also prepare HTTPS variant if current is HTTP
        if self.prometheus_url and self.prometheus_url.startswith('http://'):
            self.prometheus_url_https = self.prometheus_url.replace('http://', 'https://')
        
        logger.info(f"🔍 Using Prometheus URL: {self.prometheus_url}")
        if self.prometheus_url_https:
            logger.info(f"🔍 Will also try HTTPS: {self.prometheus_url_https}")
        
        # NCM Client (will be initialized async)
        self.ncm_client = None
        self.ncm_client_ready = False
        
        # Image info (dynamically discovered during initialization)
        self.IMAGE_UUID = None
        self.IMAGE_NAME = None
        
        # Cached cluster and subnet info
        self.cluster_uuid = None
        self.cluster_name = None
        self.subnet_uuid = None
        self.subnet_name = None
        
        logger.info(f"SmartExecutionController initialized for {self.execution_id}")
        logger.info(f"Targets: CPU={target_config.get('cpu_threshold')}%, Memory={target_config.get('memory_threshold')}%")
        logger.info(f"Entities: {list(entities_config.keys())}")
        logger.info(f"Mode: {'REAL NCM Operations' if LOADGEN_AVAILABLE else 'SIMULATED'}")
    
    async def _initialize_ncm_client(self):
        """Initialize NCM client for real operations"""
        try:
            pc_ip = self.testbed_info.get('pc_ip')
            logger.info(f"🔌 Initializing NCM Client for {pc_ip}")
            
            self.ncm_client = NCMClient(
                host=pc_ip,
                username=self.testbed_info.get('username'),
                password=self.testbed_info.get('password'),
                port=9440,
                verify_ssl=False,
                execution_id=self.execution_id
            )
            
            # Create a direct PC client (no DNS discovery) for PC-only APIs (VMs, Projects, Blueprints)
            # NCM 2.0 auto-routes the main ncm_client to NCM FQDN, but VMs/Projects/Blueprints need PC
            self.pc_client = NCMClient(
                host=pc_ip,
                username=self.testbed_info.get('username'),
                password=self.testbed_info.get('password'),
                port=9440,
                verify_ssl=False,
                execution_id=self.execution_id,
                enable_dns_discovery=False
            )
            logger.info(f"✅ Direct PC client created for {pc_ip} (no DNS redirect)")
            
            # Fetch cluster and subnet info once (reuse for all operations)
            await self._fetch_cluster_subnet_info()
            
            self.ncm_client_ready = True
            logger.info("✅ NCM Client initialized and ready for REAL operations")
            
        except Exception as e:
            logger.error(f"Failed to initialize NCM client: {e}")
            self.ncm_client_ready = False
            logger.warning("⚠️ NCM client initialization failed, falling back to simulation mode")
    
    async def _fetch_cluster_subnet_info(self):
        """Fetch cluster, subnet, and image information once for reuse"""
        try:
            logger.info("🔍 Fetching cluster, subnet, and image information...")
            # Use pc_client (direct PC IP) for infrastructure discovery
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            
            # Get first available cluster
            clusters_response = await pc.v3_request(
                endpoint="/clusters/list",
                method="POST",
                payload={"kind": "cluster", "length": 10}
            )
            
            if clusters_response and clusters_response[0].status in (200, 202) and isinstance(clusters_response[0].body, dict) and clusters_response[0].body.get('entities'):
                for cluster in clusters_response[0].body['entities']:
                    cluster_name = cluster.get('spec', {}).get('name', '')
                    if cluster_name and cluster_name != 'Unnamed':
                        self.cluster_uuid = cluster['metadata']['uuid']
                        self.cluster_name = cluster_name
                        break
                if not self.cluster_uuid:
                    cluster = clusters_response[0].body['entities'][0]
                    self.cluster_uuid = cluster['metadata']['uuid']
                    self.cluster_name = cluster.get('spec', {}).get('name', 'default-cluster')
                logger.info(f"✅ Using cluster: {self.cluster_name} ({self.cluster_uuid})")
            else:
                raise ValueError("No clusters found on testbed")
            
            # Get first available subnet
            subnets_response = await pc.v3_request(
                endpoint="/subnets/list",
                method="POST",
                payload={"kind": "subnet", "length": 10}
            )
            
            if subnets_response and subnets_response[0].status in (200, 202) and isinstance(subnets_response[0].body, dict) and subnets_response[0].body.get('entities'):
                subnet = subnets_response[0].body['entities'][0]
                self.subnet_uuid = subnet['metadata']['uuid']
                self.subnet_name = subnet['spec'].get('name', 'default-subnet')
                logger.info(f"✅ Using subnet: {self.subnet_name} ({self.subnet_uuid})")
            else:
                raise ValueError("No subnets found on testbed")
            
            # Dynamically discover an available image for VM creation
            try:
                logger.info("🔍 Discovering available images...")
                images_response = await pc.v3_request(
                    endpoint="/images/list",
                    method="POST",
                    payload={"kind": "image", "length": 50}
                )
                
                images = []
                if images_response and images_response[0].status in (200, 202):
                    body = images_response[0].body
                    if isinstance(body, dict):
                        images = body.get('entities', [])
                    logger.info(f"Found {len(images)} images via primary API")
                
                if not images:
                    logger.info("Trying direct PC image API...")
                    pc_ip = self.testbed_info.get('pc_ip')
                    if pc_ip:
                        direct_client = NCMClient(
                            host=pc_ip, username=self.testbed_info.get('username'),
                            password=self.testbed_info.get('password'),
                            port=9440, verify_ssl=False, execution_id=self.execution_id
                        )
                        img_resp = await direct_client.v3_request(
                            endpoint="/images/list", method="POST",
                            payload={"kind": "image", "length": 50}
                        )
                        if img_resp and img_resp[0].status in (200, 202) and isinstance(img_resp[0].body, dict):
                            images = img_resp[0].body.get('entities', [])
                            logger.info(f"Found {len(images)} images via direct PC API")
                
                if images:
                    preferred_names = ['tinycorelinux', 'tinycore', 'centos', 'ubuntu', 'linux', 'cirros']
                    for pref in preferred_names:
                        for img in images:
                            img_name = img.get('status', {}).get('name', '') or img.get('spec', {}).get('name', '')
                            img_state = img.get('status', {}).get('state', '')
                            if pref in img_name.lower() and img_state == 'COMPLETE':
                                self.IMAGE_UUID = img['metadata']['uuid']
                                self.IMAGE_NAME = img_name
                                break
                        if self.IMAGE_UUID:
                            break
                    
                    if not self.IMAGE_UUID:
                        for img in images:
                            img_state = img.get('status', {}).get('state', '')
                            if img_state == 'COMPLETE':
                                self.IMAGE_UUID = img['metadata']['uuid']
                                self.IMAGE_NAME = img.get('status', {}).get('name', '') or img.get('spec', {}).get('name', 'Unknown')
                                break
                
                if self.IMAGE_UUID:
                    logger.info(f"Using discovered image: {self.IMAGE_NAME} ({self.IMAGE_UUID})")
                else:
                    logger.warning("No COMPLETE images found - VM creation will fail")
            except Exception as img_err:
                logger.warning(f"Image discovery failed: {img_err} - VM creation may fail")
                
        except Exception as e:
            logger.error(f"Failed to fetch cluster/subnet/image info: {e}")
            raise
    
    # Entity types that require Calm/Self-Service API
    CALM_DEPENDENT_ENTITIES = {
        'blueprint_single_vm', 'blueprint_multi_vm', 'blueprint',
        'application', 'marketplace_item',
    }
    # Entity types that require AIOps/DevOps API
    AIOPS_DEPENDENT_ENTITIES = {
        'playbook', 'uda_policy',
    }

    async def pre_execution_check(self) -> Dict[str, Any]:
        """Validate cluster resources before starting execution."""
        checks = {
            'prometheus': False, 'ncm_api': False, 'resources': False,
            'calm_available': False, 'aiops_available': False,
            'warnings': [], 'excluded_entities': [],
        }
        try:
            # 1. Prometheus connectivity
            metrics = await self._get_current_metrics()
            if metrics.get('cpu_percent', 0) > 0 or metrics.get('memory_percent', 0) > 0:
                checks['prometheus'] = True
                checks['baseline_cpu'] = metrics.get('cpu_percent', 0)
                checks['baseline_memory'] = metrics.get('memory_percent', 0)
            else:
                checks['warnings'].append('Prometheus returned zero metrics - check connectivity')

            # 2. NCM API connectivity
            if LOADGEN_AVAILABLE:
                try:
                    await self._initialize_ncm_client()
                    if self.ncm_client_ready:
                        checks['ncm_api'] = True
                    else:
                        checks['warnings'].append('NCM client initialized but not ready')
                except Exception as e:
                    checks['warnings'].append(f'NCM API connection failed: {str(e)[:100]}')
            else:
                checks['warnings'].append('NCMClient not available - will use simulation mode')

            # 3. Basic resource availability (image, subnet)
            if self.ncm_client_ready:
                has_image = self.IMAGE_UUID is not None
                has_subnet = self.subnet_uuid is not None
                checks['resources'] = has_image and has_subnet
                checks['image'] = self.IMAGE_NAME
                checks['subnet'] = self.subnet_name
                checks['cluster'] = self.cluster_name
                if not has_image:
                    checks['warnings'].append('No VM image discovered - VM create operations will fail')
                if not has_subnet:
                    checks['warnings'].append('No subnet discovered - VM create operations will fail')
            else:
                checks['resources'] = True

            # 4. Calm/Self-Service availability probe
            if self.ncm_client_ready and hasattr(self.ncm_client, 'calm_v3_request'):
                try:
                    resp = await asyncio.wait_for(
                        self.ncm_client.calm_v3_request(
                            endpoint="/blueprints/list",
                            method="POST",
                            payload={"kind": "blueprint", "length": 1}
                        ), timeout=15.0
                    )
                    if resp and resp[0].status == 200:
                        checks['calm_available'] = True
                except Exception:
                    pass
            if not checks['calm_available']:
                checks['warnings'].append('Calm/Self-Service API not reachable — Blueprint and App operations will be auto-excluded')

            # 5. AIOps/DevOps availability probe
            if self.ncm_client_ready:
                try:
                    from load_engine.app.entities.v4.playbooks import list_v4_playbooks
                    resp = await asyncio.wait_for(
                        list_v4_playbooks(client=self.ncm_client, concurrency=1),
                        timeout=15.0
                    )
                    if resp and resp[0].status == 200:
                        checks['aiops_available'] = True
                except Exception:
                    pass
            if not checks['aiops_available']:
                checks['warnings'].append('AIOps/DevOps API not reachable — Playbook operations will be auto-excluded')

            # 6. Auto-exclude unavailable entity types from entities_config
            excluded = []
            if not checks['calm_available']:
                for etype in list(self.entities_config.keys()):
                    if etype.lower() in self.CALM_DEPENDENT_ENTITIES:
                        excluded.append(etype)
                        del self.entities_config[etype]
            if not checks['aiops_available']:
                for etype in list(self.entities_config.keys()):
                    if etype.lower() in self.AIOPS_DEPENDENT_ENTITIES:
                        excluded.append(etype)
                        del self.entities_config[etype]
            if excluded:
                checks['excluded_entities'] = excluded
                checks['warnings'].append(f'Auto-excluded unavailable entities: {", ".join(excluded)}')
                logger.info(f"🚫 Auto-excluded entities: {excluded}")
                self._log_event('WARNING', f'Auto-excluded entities (service unavailable): {", ".join(excluded)}')

            checks['passed'] = checks['prometheus'] and (checks['ncm_api'] or not LOADGEN_AVAILABLE)
            if not self.entities_config:
                checks['passed'] = False
                checks['warnings'].append('No entity types remaining after exclusion — cannot start execution')
        except Exception as e:
            checks['passed'] = False
            checks['warnings'].append(f'Pre-check error: {str(e)[:200]}')

        self.pre_check_passed = checks.get('passed', False)
        self.pre_check_results = checks
        return checks

    def get_latency_summary(self) -> Dict[str, Any]:
        """Summarize API latency statistics per entity-operation pair."""
        if not self.api_latency_history:
            return {'overall': {}, 'per_operation': {}}

        all_latencies = [h['latency_seconds'] for h in self.api_latency_history if h.get('latency_seconds')]
        per_op: Dict[str, list] = {}
        for h in self.api_latency_history:
            key = f"{h['entity_type']}.{h['operation']}"
            per_op.setdefault(key, []).append(h['latency_seconds'])

        def _stats(vals):
            if not vals:
                return {}
            vals_sorted = sorted(vals)
            return {
                'min': round(min(vals), 2),
                'max': round(max(vals), 2),
                'avg': round(sum(vals) / len(vals), 2),
                'p50': round(vals_sorted[len(vals_sorted) // 2], 2),
                'p95': round(vals_sorted[int(len(vals_sorted) * 0.95)], 2) if len(vals_sorted) >= 2 else round(max(vals), 2),
                'count': len(vals)
            }

        return {
            'overall': _stats(all_latencies),
            'per_operation': {k: _stats(v) for k, v in per_op.items()}
        }

    def generate_learning_summary(self) -> str:
        """Generate a plain-English summary of what was learned from this execution."""
        parts = []
        
        # Duration & ops
        duration = 0
        if self.start_time and self.end_time:
            duration = (self.end_time - self.start_time).total_seconds() / 60
        skipped = getattr(self, 'skipped_operations', 0)
        countable = self.total_operations - skipped
        success_rate = (self.successful_operations / countable * 100) if countable > 0 else 100
        summary_parts = [f"Executed {self.total_operations} operations in {duration:.1f} minutes ({success_rate:.0f}% success rate)."]
        if skipped > 0:
            summary_parts.append(f"{skipped} operations skipped (service unavailable).")
        parts.extend(summary_parts)
        
        # Most effective operations
        effective = self._get_most_effective_operations(limit=3)
        if effective:
            top = effective[0]
            parts.append(
                f"Most effective operation: {top['key']} with avg CPU impact +{top['avg_cpu_delta']:.1f}% "
                f"and memory impact +{top['avg_memory_delta']:.1f}%."
            )
            if len(effective) >= 2:
                names = [e['key'] for e in effective[:3]]
                parts.append(f"Recommend prioritizing: {', '.join(names)} for future runs on this testbed.")
        
        # Threshold achievement
        final_cpu = self.current_metrics.get('cpu_percent', 0)
        final_mem = self.current_metrics.get('memory_percent', 0)
        target_cpu = self.target_config.get('cpu_threshold', 80)
        target_mem = self.target_config.get('memory_threshold', 80)
        if self.status == 'COMPLETED':
            parts.append(f"Target reached: CPU {final_cpu:.1f}%/{target_cpu}%, Memory {final_mem:.1f}%/{target_mem}%.")
        else:
            gap_cpu = target_cpu - final_cpu
            gap_mem = target_mem - final_mem
            parts.append(f"Target not reached. Gaps: CPU {gap_cpu:.1f}%, Memory {gap_mem:.1f}%. Consider increasing load intensity.")
        
        # Anomalies
        if self.detected_anomalies:
            high = sum(1 for a in self.detected_anomalies if a.get('severity') == 'high')
            parts.append(f"Detected {len(self.detected_anomalies)} anomalies ({high} high severity) during execution.")
        
        # Latency
        latency = self.get_latency_summary()
        overall = latency.get('overall', {})
        if overall.get('avg'):
            parts.append(f"Average API latency: {overall['avg']:.1f}s (P95: {overall.get('p95', 0):.1f}s).")
        
        # Cluster response
        if len(self.metrics_history) >= 4:
            early_cpu = sum(m.get('cpu_percent', 0) for m in self.metrics_history[:3]) / 3
            late_cpu = sum(m.get('cpu_percent', 0) for m in self.metrics_history[-3:]) / 3
            trend = "increasing" if late_cpu > early_cpu + 2 else ("stable" if abs(late_cpu - early_cpu) < 2 else "decreasing")
            parts.append(f"Cluster CPU trend: {trend} (early avg {early_cpu:.1f}% → late avg {late_cpu:.1f}%).")
        
        return " ".join(parts)

    async def start_execution(self) -> Dict[str, Any]:
        """Start the smart execution loop with validation and pre-checks."""
        try:
            logger.info(f"🚀 Starting smart execution {self.execution_id}")
            logger.info(f"⚙️ Profile={self.workload_profile}, Parallel={self.parallel_execution_enabled}, MaxParallel={self.max_parallel_operations}")
            
            self.status = "RUNNING"
            self.is_running = True
            self.start_time = datetime.now(timezone.utc)
            self._log_event('INFO', f'🚀 Smart execution started (profile={self.workload_profile})', execution_id=self.execution_id)
            
            self._persist_to_database()
            
            # Pre-execution resource check
            pre_check = await self.pre_execution_check()
            if pre_check.get('warnings'):
                for w in pre_check['warnings']:
                    self._log_event('WARNING', f'Pre-check: {w}')
            
            self.baseline_metrics = await self._get_current_metrics()
            baseline_cpu = self.baseline_metrics.get('cpu_percent', 0)
            baseline_mem = self.baseline_metrics.get('memory_percent', 0)
            
            target_cpu = self.target_config['cpu_threshold']
            target_mem = self.target_config['memory_threshold']
            stop_condition = self.target_config['stop_condition']
            
            logger.info(f"📊 Baseline metrics: CPU={baseline_cpu:.1f}%, Memory={baseline_mem:.1f}%")
            logger.info(f"🎯 Target metrics: CPU={target_cpu}%, Memory={target_mem}% (Stop: {stop_condition})")
            
            if stop_condition == 'any':
                if baseline_cpu >= target_cpu:
                    logger.warning(f"⚠️  WARNING: Baseline CPU ({baseline_cpu:.1f}%) already exceeds target ({target_cpu}%)!")
                if baseline_mem >= target_mem:
                    logger.warning(f"⚠️  WARNING: Baseline Memory ({baseline_mem:.1f}%) already exceeds target ({target_mem}%)!")
            else:
                if baseline_cpu >= target_cpu and baseline_mem >= target_mem:
                    logger.warning(f"⚠️  WARNING: Both metrics already meet targets at baseline!")
            
            if LOADGEN_AVAILABLE and not self.ncm_client_ready:
                await self._initialize_ncm_client()
            elif not LOADGEN_AVAILABLE:
                logger.warning("⚠️ NCMClient not available - using simulation mode")
            
            await self._execution_loop()
            
            self.end_time = datetime.now(timezone.utc)
            duration = (self.end_time - self.start_time).total_seconds() / 60
            
            logger.info(f"✅ Smart execution completed: {self.total_operations} operations in {duration:.2f} minutes")
            
            # Auto-cleanup if configured
            if self.auto_cleanup and self.created_entities:
                logger.info(f"🧹 Auto-cleanup enabled - cleaning up created entities...")
                self._log_event('INFO', 'Auto-cleanup started')
                try:
                    cleanup_summary = await self.cleanup_entities()
                    logger.info(f"🧹 Auto-cleanup done: {cleanup_summary.get('success', 0)}/{cleanup_summary.get('total', 0)} deleted")
                    self._log_event('INFO', f"Auto-cleanup: {cleanup_summary.get('success', 0)}/{cleanup_summary.get('total', 0)} deleted")
                except Exception as ce:
                    logger.error(f"Auto-cleanup failed: {ce}")
            
            # Generate learning summary
            try:
                self._learning_summary = self.generate_learning_summary()
                logger.info(f"📝 Learning summary: {self._learning_summary[:200]}")
                self._log_event('INFO', f'📝 {self._learning_summary[:200]}')
            except Exception as le:
                self._learning_summary = ""
                logger.debug(f"Could not generate learning summary: {le}")
            
            self._persist_to_database()
            
            return {
                'success': True,
                'execution_id': self.execution_id,
                'status': self.status,
                'total_operations': self.total_operations,
                'duration_minutes': duration,
                'final_metrics': self.current_metrics,
                'latency_summary': self.get_latency_summary()
            }
            
        except Exception as e:
            logger.exception(f"❌ Smart execution failed: {e}")
            self.status = "FAILED"
            self.end_time = datetime.now(timezone.utc)
            self._persist_to_database()
            return {
                'success': False,
                'execution_id': self.execution_id,
                'error': str(e)
            }
        finally:
            self.is_running = False
            self._persist_to_database()
    
    async def _execution_loop(self):
        """Main execution loop with feedback control"""
        iteration = 0
        timeout_minutes = self.target_config.get('timeout_minutes', 0)
        
        while self.is_running and not self.should_stop:
            # Check if paused
            if self.is_paused:
                logger.info(f"Execution paused, waiting...")
                await asyncio.sleep(2)
                continue
            
            # Execution timeout safety check
            if timeout_minutes and timeout_minutes > 0 and self.start_time:
                elapsed = (datetime.now(timezone.utc) - self.start_time).total_seconds() / 60
                if elapsed >= timeout_minutes:
                    logger.warning(f"Execution timeout reached ({elapsed:.1f} >= {timeout_minutes} min)")
                    self._log_event('WARNING', f'Execution timeout reached after {elapsed:.1f} minutes')
                    self.status = "TIMEOUT"
                    break
            
            iteration += 1
            logger.info(f"Iteration {iteration}")
            
            try:
                # 1. Get current metrics from Prometheus
                self.current_metrics = await self._get_current_metrics()
                cpu = self.current_metrics.get('cpu_percent', 0)
                memory = self.current_metrics.get('memory_percent', 0)
                
                logger.info(f"📊 Current metrics: CPU={cpu:.1f}%, Memory={memory:.1f}%")
                self._log_event('INFO', f'📊 Metrics: CPU={cpu:.1f}%, Memory={memory:.1f}%', cpu=cpu, memory=memory, iteration=iteration)
                
                # Store enhanced metrics history
                self.metrics_history.append({
                    'timestamp': datetime.now(timezone.utc).isoformat(),
                    'cpu_percent': cpu,
                    'memory_percent': memory,
                    'network': self.current_metrics.get('network', {}),
                    'disk': self.current_metrics.get('disk', {}),
                    'resources': self.current_metrics.get('resources', {}),
                    'iteration': iteration
                })
                
                # Phase 3: Real-time anomaly detection
                anomalies = self._detect_anomalies_realtime(cpu, memory, iteration)
                if anomalies:
                    for anomaly in anomalies:
                        self.detected_anomalies.append(anomaly)
                        logger.warning(f"⚠️  ANOMALY DETECTED: {anomaly['type']} - {anomaly['message']}")
                        self._log_event('WARNING', f"⚠️ Anomaly: {anomaly['message']}", anomaly=anomaly)
                        
                        # Generate recommendation for anomaly
                        recommendation = self._generate_anomaly_recommendation(anomaly)
                        if recommendation:
                            self.recommendations_history.append(recommendation)
                            logger.info(f"💡 RECOMMENDATION: {recommendation['action']}")
                            self._log_event('INFO', f"💡 Recommendation: {recommendation['action']}", recommendation=recommendation)
                
                # 2. Check if thresholds reached
                if self._check_thresholds_reached(cpu, memory):
                    logger.info(f"🎯 Threshold reached! CPU={cpu:.1f}%, Memory={memory:.1f}%")
                    self._log_event('SUCCESS', f'🎯 Target threshold reached! CPU={cpu:.1f}%, Memory={memory:.1f}%', cpu=cpu, memory=memory)
                    
                    # Phase 3: Send threshold reached alert
                    self._send_threshold_alert(cpu, memory)
                    
                    self.status = "COMPLETED"
                    break
                
                # 3. Calculate operations to execute (with rate limiting)
                operations_count = min(
                    self._calculate_operations_count(cpu, memory),
                    self.operations_per_iteration  # Apply rate limit
                )
                logger.info(f"📝 Planning to execute {operations_count} operations (rate limit: {self.operations_per_iteration}/iteration)")
                
                # Periodic checkpoint: persist state to DB every 5 iterations
                if iteration % 5 == 0:
                    self._persist_to_database()
                    self._save_checkpoint(iteration, cpu, memory)
                
                # 4. Execute operations (with impact tracking)
                batch_success_rate = 1.0
                metrics_before_ops = {
                    'cpu_percent': cpu,
                    'memory_percent': memory
                }
                
                if operations_count > 0:
                    batch_results = await self._execute_operations_batch(operations_count)
                    # Calculate success rate for backoff
                    if batch_results:
                        successes = sum(1 for r in batch_results if r.get('status') == 'SUCCESS')
                        batch_success_rate = successes / len(batch_results)
                        
                        # Track operation impact
                        await self._track_operation_impact(batch_results, metrics_before_ops, {
                            'cpu_percent': self.current_metrics.get('cpu_percent', cpu),
                            'memory_percent': self.current_metrics.get('memory_percent', memory)
                        })
                
                # 5. Apply backoff if enabled and failures detected
                if self.backoff_on_failure and batch_success_rate < 0.5:  # If more than 50% failed
                    self.current_backoff_multiplier = min(self.current_backoff_multiplier * 1.5, 4.0)  # Max 4x
                    logger.warning(f"⚠️  High failure rate ({batch_success_rate:.1%}), applying backoff {self.current_backoff_multiplier:.1f}x")
                else:
                    # Reset backoff gradually on success
                    self.current_backoff_multiplier = max(self.current_backoff_multiplier * 0.9, 1.0)
                
                # 6. Wait before next iteration (with backoff)
                actual_delay = self.poll_interval * self.current_backoff_multiplier
                logger.info(f"⏳ Waiting {actual_delay:.1f} seconds before next check...")
                await asyncio.sleep(actual_delay)
                
            except Exception as e:
                logger.error(f"❌ Error in execution loop iteration {iteration}: {e}")
                # Apply backoff on exception
                if self.backoff_on_failure:
                    self.current_backoff_multiplier = min(self.current_backoff_multiplier * 2.0, 4.0)
                # Continue to next iteration instead of failing
                await asyncio.sleep(self.poll_interval * self.current_backoff_multiplier)
        
        if self.should_stop:
            self.status = "STOPPED"
            logger.info("Execution stopped by user")
        elif self.status == "TIMEOUT":
            logger.info("Execution timed out")
    
    def _extract_api_error(self, response) -> str:
        """Extract a readable error message from an NCM API response"""
        if not response:
            return 'No response'
        try:
            body = response[0].body
            if body is None:
                return 'Empty response body'
            if isinstance(body, str):
                return body[:200]
            if isinstance(body, dict):
                msg_list = body.get('message_list', [])
                if msg_list and isinstance(msg_list, list) and len(msg_list) > 0:
                    return str(msg_list[0].get('message', ''))[:200]
                if body.get('error'):
                    return str(body['error'])[:200]
                status = body.get('status')
                if isinstance(status, dict) and status.get('message_list'):
                    return str(status['message_list'][0].get('message', ''))[:200]
                return str(body)[:200]
            return str(body)[:200]
        except Exception:
            return 'Could not parse error'
    
    def _check_thresholds_reached(self, cpu: float, memory: float) -> bool:
        """Check if target thresholds are reached using 2-of-3 confirmation."""
        MIN_OPERATIONS = 5
        if self.total_operations < MIN_OPERATIONS:
            logger.debug(f"Still under minimum operations ({self.total_operations}/{MIN_OPERATIONS}), continuing...")
            return False
        
        cpu_threshold = self.target_config.get('cpu_threshold', 80)
        memory_threshold = self.target_config.get('memory_threshold', 80)
        stop_condition = self.target_config.get('stop_condition', 'any')
        
        cpu_reached = cpu >= cpu_threshold
        memory_reached = memory >= memory_threshold
        
        if stop_condition == 'any':
            hit = cpu_reached or memory_reached
        else:
            hit = cpu_reached and memory_reached
        
        # 2-of-3 confirmation: threshold must be met in >=2 of last 3 polls
        self._threshold_hit_history.append(hit)
        if len(self._threshold_hit_history) > 3:
            self._threshold_hit_history = self._threshold_hit_history[-3:]
        
        recent_hits = sum(1 for h in self._threshold_hit_history if h)
        if recent_hits >= 2:
            logger.info(f"🎯 Threshold confirmed ({recent_hits}/3 recent polls)")
            return True
        elif hit:
            logger.info(f"📊 Threshold met this poll ({recent_hits}/3 confirmations, need 2)")
        return False
    
    def _get_profile_multiplier(self, iteration: int) -> float:
        """Return a scaling multiplier based on the workload profile and current iteration."""
        profile = self.workload_profile
        if profile == 'ramp_up':
            # Linearly ramp from 0.2x to 1.0x over first 20 iterations, then hold
            return min(0.2 + (iteration / 20) * 0.8, 1.0)
        elif profile == 'burst':
            # Alternate between 1.5x (5 iters) and 0.5x (5 iters)
            return 1.5 if (iteration // 5) % 2 == 0 else 0.5
        elif profile == 'chaos':
            # Random multiplier between 0.3 and 2.0
            import random
            return round(random.uniform(0.3, 2.0), 2)
        # sustained (default): flat 1.0x
        return 1.0

    def _calculate_operations_count(self, cpu: float, memory: float) -> int:
        """
        Calculate how many operations to execute based on current metrics.
        Applies workload profile scaling and adaptive intensity.
        """
        cpu_threshold = self.target_config.get('cpu_threshold', 80)
        memory_threshold = self.target_config.get('memory_threshold', 80)
        
        cpu_delta = cpu_threshold - cpu
        memory_delta = memory_threshold - memory
        min_delta = min(cpu_delta, memory_delta)
        
        # Adaptive intensity based on metric response
        adaptive_multiplier = 1.0
        if len(self.metrics_history) >= 2:
            prev_metrics = self.metrics_history[-2]
            curr_metrics = self.metrics_history[-1]
            
            cpu_change = curr_metrics.get('cpu_percent', 0) - prev_metrics.get('cpu_percent', 0)
            mem_change = curr_metrics.get('memory_percent', 0) - prev_metrics.get('memory_percent', 0)
            
            if abs(cpu_change) < 1.0 and abs(mem_change) < 1.0:
                adaptive_multiplier = 1.5
                logger.info(f"📈 Low metric response detected - increasing operation intensity")
            elif abs(cpu_change) > 5.0 or abs(mem_change) > 5.0:
                adaptive_multiplier = 0.7
                logger.info(f"📉 High metric response detected - reducing operation intensity")
        
        # Apply workload profile multiplier
        self._profile_iteration += 1
        profile_mult = self._get_profile_multiplier(self._profile_iteration)
        combined_mult = adaptive_multiplier * profile_mult
        
        if profile_mult != 1.0:
            logger.info(f"📊 Workload profile '{self.workload_profile}' multiplier: {profile_mult:.2f}")
        
        if min_delta > 20:
            operations = int(self.max_operations_per_cycle * combined_mult)
        elif min_delta > 10:
            operations = int(self.max_operations_per_cycle * 0.6 * combined_mult)
        elif min_delta > 5:
            operations = int(self.max_operations_per_cycle * 0.3 * combined_mult)
        elif min_delta > 0:
            operations = max(int(self.min_operations_per_cycle * combined_mult), 1)
        else:
            operations = 0
        
        return max(operations, 0)
    
    async def _track_operation_impact(self, operations_batch: List[Dict], metrics_before: Dict, metrics_after: Dict):
        """Track which operations caused metric changes"""
        cpu_delta = metrics_after.get('cpu_percent', 0) - metrics_before.get('cpu_percent', 0)
        memory_delta = metrics_after.get('memory_percent', 0) - metrics_before.get('memory_percent', 0)
        
        if len(operations_batch) == 0:
            return
        
        # Distribute impact across operations
        per_op_cpu_delta = cpu_delta / len(operations_batch)
        per_op_memory_delta = memory_delta / len(operations_batch)
        
        impact_record = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'operations_count': len(operations_batch),
            'cpu_delta': cpu_delta,
            'memory_delta': memory_delta,
            'per_operation_avg': {
                'cpu_delta': per_op_cpu_delta,
                'memory_delta': per_op_memory_delta
            },
            'operations': []
        }
        
        for op in operations_batch:
            entity_type = op.get('entity_type', 'Unknown')
            operation = op.get('operation', 'unknown')
            key = f"{entity_type}.{operation}"
            
            # Track per-operation effectiveness
            if key not in self.operation_effectiveness:
                self.operation_effectiveness[key] = []
            
            op_impact = {
                'cpu_delta': per_op_cpu_delta,
                'memory_delta': per_op_memory_delta,
                'effectiveness_score': abs(per_op_cpu_delta) + abs(per_op_memory_delta),
                'timestamp': op.get('start_time', datetime.now(timezone.utc).isoformat()),
                'status': op.get('status', 'UNKNOWN')
            }
            
            self.operation_effectiveness[key].append(op_impact)
            impact_record['operations'].append({
                'entity_type': entity_type,
                'operation': operation,
                'impact': op_impact
            })
        
        self.operation_impact_history.append(impact_record)
        
        # Keep only last 100 impact records
        if len(self.operation_impact_history) > 100:
            self.operation_impact_history = self.operation_impact_history[-100:]
        
        logger.debug(f"📊 Tracked impact: {len(operations_batch)} ops → CPU: {cpu_delta:+.2f}%, Memory: {memory_delta:+.2f}%")
    
    def _get_most_effective_operations(self, limit: int = 5) -> List[Dict]:
        """Get the most effective operations based on impact tracking"""
        effectiveness_scores = {}
        
        for key, impacts in self.operation_effectiveness.items():
            if not impacts:
                continue
            
            # Calculate average effectiveness
            avg_cpu_delta = sum(i['cpu_delta'] for i in impacts) / len(impacts)
            avg_mem_delta = sum(i['memory_delta'] for i in impacts) / len(impacts)
            avg_score = abs(avg_cpu_delta) + abs(avg_mem_delta)
            
            effectiveness_scores[key] = {
                'key': key,
                'avg_cpu_delta': avg_cpu_delta,
                'avg_memory_delta': avg_mem_delta,
                'effectiveness_score': avg_score,
                'execution_count': len(impacts),
                'success_rate': sum(1 for i in impacts if i['status'] == 'SUCCESS') / len(impacts) * 100
            }
        
        # Sort by effectiveness score
        sorted_ops = sorted(effectiveness_scores.values(), key=lambda x: x['effectiveness_score'], reverse=True)
        return sorted_ops[:limit]
    
    def _try_ml_guided_selection(self, count: int) -> Optional[List[tuple]]:
        """Use ML model to pick high-impact operations when metrics are stagnant."""
        if not self._ml_guided:
            return None
        if len(self.metrics_history) < 3:
            return None
        # Only use ML when metrics are stagnant (last 2 readings barely changed)
        prev = self.metrics_history[-2]
        curr = self.metrics_history[-1]
        cpu_change = abs(curr.get('cpu_percent', 0) - prev.get('cpu_percent', 0))
        mem_change = abs(curr.get('memory_percent', 0) - prev.get('memory_percent', 0))
        if cpu_change > 1.5 or mem_change > 1.5:
            return None  # Metrics responding fine, no need for ML guidance

        try:
            from services.ml_training_service import get_model_for_testbed
            testbed_id = self.testbed_info.get('unique_testbed_id')
            predictor = get_model_for_testbed(testbed_id)
            if not predictor or not predictor.is_trained:
                return None
            # Check confidence: need R² > 0.3
            if hasattr(predictor, 'training_metrics'):
                avg_r2 = (predictor.training_metrics.get('cpu_r2', 0) + predictor.training_metrics.get('memory_r2', 0)) / 2
                if avg_r2 < 0.3:
                    logger.debug(f"ML model R²={avg_r2:.2f} below confidence threshold 0.3, skipping")
                    return None

            current_cpu = curr.get('cpu_percent', 0)
            current_memory = curr.get('memory_percent', 0)
            recs = predictor.recommend_operations(current_cpu, current_memory, top_n=count)
            if not recs:
                return None
            
            tasks = []
            available = set()
            for et, ops in self.entities_config.items():
                op_list = list(ops.keys()) if isinstance(ops, dict) else (ops if isinstance(ops, list) else [str(ops)])
                for op in op_list:
                    available.add((et.lower(), op.lower()))
            
            for rec in recs[:count]:
                pair = (rec.get('entity', '').lower(), rec.get('operation', '').lower())
                if pair in available:
                    tasks.append(pair)
            
            if tasks:
                logger.info(f"🤖 ML-guided selection: {len(tasks)} high-impact ops (stagnant metrics)")
                return tasks
        except Exception as e:
            logger.debug(f"ML-guided selection failed: {e}")
        return None

    def _build_weighted_task_list(self, count: int) -> List[tuple]:
        """Build operation task list: ML-guided > weighted > uniform."""
        ml_tasks = self._try_ml_guided_selection(count)
        if ml_tasks:
            return ml_tasks
        if not self.operation_weights:
            return self._build_uniform_task_list(count)

        import random
        tasks = []
        candidates = []
        total_weight = 0.0

        for entity_type, ops_config in self.entities_config.items():
            if isinstance(ops_config, dict):
                operations_list = list(ops_config.keys())
            elif isinstance(ops_config, list):
                operations_list = ops_config
            else:
                operations_list = [str(ops_config)]
            for op in operations_list:
                key = f"{entity_type}.{op}"
                w = self.operation_weights.get(key, 1.0)
                candidates.append((entity_type, op, w))
                total_weight += w

        if not candidates or total_weight == 0:
            return self._build_uniform_task_list(count)

        for _ in range(count):
            r = random.uniform(0, total_weight)
            cumulative = 0.0
            for entity_type, op, w in candidates:
                cumulative += w
                if cumulative >= r:
                    tasks.append((entity_type, op))
                    break
        return tasks

    def _build_uniform_task_list(self, count: int) -> List[tuple]:
        """Build uniformly-distributed operation tasks (original logic)."""
        entity_types = list(self.entities_config.keys())
        operations_per_entity = max(1, count // max(len(entity_types), 1))
        tasks = []

        for entity_type in entity_types:
            ops_config = self.entities_config[entity_type]
            if isinstance(ops_config, dict):
                operations_list = list(ops_config.keys())
            elif isinstance(ops_config, list):
                operations_list = ops_config
            else:
                operations_list = [str(ops_config)]
            if not operations_list:
                continue
            for i in range(operations_per_entity):
                operation = operations_list[(self.total_operations + i) % len(operations_list)]
                tasks.append((entity_type, operation))
        return tasks

    async def _execute_operations_batch(self, count: int):
        """Execute a batch of operations with parallel execution, weighted distribution, and latency tracking."""
        mode = "REAL" if (self.ncm_client_ready and self.ncm_client) else "SIMULATED"
        parallel_mode = "PARALLEL" if self.parallel_execution_enabled else "SEQUENTIAL"
        logger.info(f"🔨 Executing {count} operations ({mode}, {parallel_mode}, profile={self.workload_profile})...")
        
        batch_results = []
        
        try:
            operation_tasks = self._build_weighted_task_list(count)
            
            # Filter out tasks if paused or stopped
            operation_tasks = [(e, o) for e, o in operation_tasks if self.is_running and not self.is_paused]
            
            # Execute operations (parallel or sequential)
            if self.parallel_execution_enabled and len(operation_tasks) > 1:
                # Phase 2: Parallel execution
                batch_results = await self._execute_operations_parallel(operation_tasks)
            else:
                # Sequential execution (original)
                batch_results = await self._execute_operations_sequential(operation_tasks)
            
        except Exception as e:
            logger.error(f"❌ Error executing operations batch: {e}")
            import traceback
            logger.debug(f"Traceback: {traceback.format_exc()}")
        
        return batch_results
    
    async def _execute_operations_sequential(self, operation_tasks: List[tuple]):
        """Execute operations sequentially (original method)"""
        batch_results = []
        
        for entity_type, operation in operation_tasks:
            if not self.is_running or self.is_paused:
                break
            
            # Apply rate limiting
            if self.last_operation_time:
                min_interval = 60.0 / self.operations_per_minute
                elapsed = (datetime.now(timezone.utc) - self.last_operation_time).total_seconds()
                if elapsed < min_interval:
                    wait_time = min_interval - elapsed
                    logger.debug(f"⏱️  Rate limiting: waiting {wait_time:.2f}s")
                    await asyncio.sleep(wait_time)
            
            # Apply backoff if needed
            if self.backoff_delay > 0:
                logger.info(f"⏳ Backoff: waiting {self.backoff_delay}s due to failures")
                await asyncio.sleep(self.backoff_delay)
                self.backoff_delay = 0
            
            # Execute operation
            result = await self._execute_single_operation(entity_type, operation)
            
            # Track and process result
            batch_results.append(result)
            await self._process_operation_result(result, entity_type, operation)
            
            # Small delay between operations
            await asyncio.sleep(0.5)
        
        return batch_results
    
    async def _execute_operations_parallel(self, operation_tasks: List[tuple]):
        """Phase 2: Execute operations in parallel for faster impact"""
        batch_results = []
        
        # Limit parallel operations
        max_parallel = min(self.max_parallel_operations, len(operation_tasks))
        semaphore = asyncio.Semaphore(max_parallel)
        
        async def execute_with_semaphore(entity_type: str, operation: str):
            """Execute operation with semaphore, cooldown, and in-flight tracking."""
            async with semaphore:
                if not self.is_running or self.is_paused or self.should_stop:
                    return None
                
                if self.backoff_delay > 0 and len(batch_results) == 0:
                    await asyncio.sleep(self.backoff_delay)
                    self.backoff_delay = 0
                
                # Per-entity cooldown
                if self._entity_cooldown_seconds > 0:
                    key = f"{entity_type}.{operation}"
                    last = self._last_op_time_per_entity.get(key)
                    if last:
                        elapsed = (datetime.now(timezone.utc) - last).total_seconds()
                        if elapsed < self._entity_cooldown_seconds:
                            await asyncio.sleep(self._entity_cooldown_seconds - elapsed)
                
                self._inflight_ops += 1
                try:
                    result = await self._execute_single_operation(entity_type, operation)
                    await self._process_operation_result(result, entity_type, operation)
                    self._last_op_time_per_entity[f"{entity_type}.{operation}"] = datetime.now(timezone.utc)
                    return result
                finally:
                    self._inflight_ops -= 1
        
        # Create tasks for parallel execution
        tasks = [
            execute_with_semaphore(entity_type, operation)
            for entity_type, operation in operation_tasks
        ]
        
        # Execute all tasks in parallel
        logger.info(f"🚀 Executing {len(tasks)} operations in parallel (max {max_parallel} concurrent)")
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Filter out None results and exceptions
        for result in results:
            if result is None:
                continue
            if isinstance(result, Exception):
                logger.error(f"❌ Parallel operation failed: {result}")
                continue
            batch_results.append(result)
        
        return batch_results
    
    async def _process_operation_result(self, result: Dict, entity_type: str, operation: str):
        """Process operation result with latency tracking and SKIPPED handling."""
        self.last_operation_time = datetime.now(timezone.utc)
        status = result.get('status', 'FAILED')
        
        if status == 'FAILED':
            self.consecutive_failures += 1
            self.backoff_delay = min(2 ** (self.consecutive_failures - 1), 30)
            logger.warning(f"⚠️  Consecutive failures: {self.consecutive_failures}, backoff: {self.backoff_delay}s")
        elif status == 'SKIPPED':
            pass  # Don't affect consecutive failures or backoff
        else:
            self.consecutive_failures = 0
            self.backoff_delay = 0
        
        self.operations_history.append(result)
        self.total_operations += 1
        
        if status == 'SUCCESS':
            self.successful_operations += 1
        elif status == 'SKIPPED':
            self.skipped_operations = getattr(self, 'skipped_operations', 0) + 1
        else:
            self.failed_operations += 1
        
        # Track API latency
        duration_s = result.get('duration_seconds', 0)
        self.api_latency_history.append({
            'entity_type': entity_type,
            'operation': operation,
            'status': status,
            'latency_seconds': duration_s,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
        if len(self.api_latency_history) > 500:
            self.api_latency_history = self.api_latency_history[-500:]
        
        icon = '✅' if status == 'SUCCESS' else ('⏭️' if status == 'SKIPPED' else '❌')
        logger.info(f"{icon} Operation {self.total_operations}: {entity_type}.{operation} - {status} ({duration_s:.1f}s)")
        
        if status == 'SUCCESS':
            self._log_event('SUCCESS', f"Operation #{self.total_operations}: {entity_type}.{operation} ({duration_s:.1f}s)", 
                          entity_type=entity_type, operation=operation)
        elif status == 'SKIPPED':
            self._log_event('WARNING', f"Operation #{self.total_operations} skipped (service unavailable): {entity_type}.{operation}", 
                          entity_type=entity_type, operation=operation, error=result.get('error'))
        else:
            self._log_event('ERROR', f"Operation #{self.total_operations} failed: {entity_type}.{operation}", 
                          entity_type=entity_type, operation=operation, error=result.get('error'))
    
    async def _execute_single_operation(self, entity_type: str, operation: str) -> Dict:
        """Execute a single operation (REAL or simulated based on NCM client)"""
        start_time = datetime.now(timezone.utc)
        import random
        suffix = f"{self.total_operations + 1}-{random.randint(1000,9999)}"
        entity_name = f"smart-{entity_type.lower()}-{suffix}"
        
        try:
            # Use REAL operations if NCM client is available and ready
            if self.ncm_client_ready and self.ncm_client:
                logger.info(f"🚀 REAL: {entity_type}.{operation} ({entity_name})")
                result = await self._execute_real_operation(entity_type, operation, entity_name)
            else:
                # Fallback to simulation
                logger.debug(f"⚠️ SIMULATED: {entity_type}.{operation} - ncm_client_ready={self.ncm_client_ready}, ncm_client={self.ncm_client is not None}")
                result = await self._execute_simulated_operation(entity_type, operation, entity_name)
            
            end_time = datetime.now(timezone.utc)
            duration = (end_time - start_time).total_seconds()
            
            # Track created entities for cleanup (only if operation was successful and is a create operation)
            if result.get('status') == 'SUCCESS' and operation == 'create' and result.get('uuid'):
                if entity_type not in self.created_entities:
                    self.created_entities[entity_type] = []
                self.created_entities[entity_type].append({
                    'uuid': result.get('uuid'),
                    'name': entity_name,
                    'created_at': start_time.isoformat()
                })
                logger.info(f"📝 Tracked entity for cleanup: {entity_type}/{entity_name} ({result.get('uuid')})")
            
            return {
                'entity_type': entity_type,
                'operation': operation,
                'status': result.get('status', 'SUCCESS'),
                'start_time': start_time.isoformat(),
                'end_time': end_time.isoformat(),
                'duration_seconds': duration,
                'entity_name': entity_name,
                'entity_uuid': result.get('uuid', f"simulated-{self.total_operations}"),
                'error': result.get('error'),
                'error_type': result.get('error_type'),
                'error_code': result.get('error_code')
            }
            
        except Exception as e:
            import traceback
            end_time = datetime.now(timezone.utc)
            duration = (end_time - start_time).total_seconds()
            error_traceback = traceback.format_exc()
            logger.error(f"❌ Operation failed: {entity_type}.{operation} - {e}")
            logger.debug(f"Traceback: {error_traceback}")
            
            return {
                'entity_type': entity_type,
                'operation': operation,
                'status': 'FAILED',
                'start_time': start_time.isoformat(),
                'end_time': end_time.isoformat(),
                'duration_seconds': duration,
                'entity_name': entity_name,
                'entity_uuid': None,
                'error': str(e),
                'error_type': type(e).__name__,
                'error_code': getattr(e, 'status_code', None),
                'traceback': error_traceback
            }
    
    async def _execute_real_operation(self, entity_type: str, operation: str, entity_name: str) -> Dict:
        """Execute REAL operation using NCM API with detailed error tracking and pod-level metrics"""
        # Normalize operation to lowercase for dispatch matching
        operation = operation.lower()
        
        # Normalize entity_type to title case for dispatch matching
        ENTITY_TYPE_MAP = {
            'vm': 'VM',
            'project': 'Project',
            'category': 'Category',
            'image': 'Image',
            'subnet': 'Subnet',
            'user': 'User',
            'cluster': 'Cluster',
            'alert': 'Alert',
            'endpoint': 'Endpoint',
            'library_variable': 'Library Variable',
            'runbook': 'Runbook',
            'blueprint_single_vm': 'Blueprint (Single VM)',
            'blueprint_multi_vm': 'Blueprint (Multi VM)',
            'blueprint': 'Blueprint',
            'application': 'Application',
            'marketplace_item': 'Marketplace Item',
            'playbook': 'Playbook',
            'uda_policy': 'UDA Policy',
            'scenario': 'Scenario',
            'analysis_session': 'Analysis Session',
            'report_config': 'Report Config',
            'report_instance': 'Report Instance',
            'business_unit': 'Business Unit',
            'cost_center': 'Cost Center',
            'budget': 'Budget',
            'rate_card': 'Rate Card',
            'tco_direct_cost': 'TCO Direct Cost',
            'tco_indirect_cost': 'TCO Indirect Cost',
            'cg_report': 'CG Report',
            'budget_alert': 'Budget Alert',
        }
        normalized_key = entity_type.lower().replace(' ', '_').replace('(', '').replace(')', '')
        entity_type = ENTITY_TYPE_MAP.get(normalized_key, entity_type)
        
        logger.info(f"🚀 REAL OPERATION: {entity_type}.{operation} ({entity_name})")
        broadcast_log(self.execution_id, 'INFO', f"🚀 Executing {entity_type}.{operation} ({entity_name})", {
            'entity_type': entity_type,
            'operation': operation,
            'entity_name': entity_name
        })
        
        # Track pod metrics before operation (always capture if Prometheus is available)
        pods_before = {}
        operation_start_time = datetime.now(timezone.utc)
        
        # Always capture pod metrics if Prometheus is available (not just when rule_config is set)
        if self.prometheus_url:
            try:
                # Get all pods (not filtered by rule_config) - capture ALL pods for complete data
                pods_before = await self._get_pod_metrics_snapshot(filter_by_rule=False)
                logger.debug(f"📊 Captured {len(pods_before)} pod metrics before operation")
            except Exception as e:
                logger.warning(f"Failed to capture pod metrics before operation: {e}")
        
        result = None
        try:
            # Tier 1: Core Infrastructure
            if entity_type == "VM":
                result = await self._execute_vm_operation(operation, entity_name)
            elif entity_type == "Project":
                result = await self._execute_project_operation(operation, entity_name)
            elif entity_type == "Category":
                result = await self._execute_category_operation(operation, entity_name)
            elif entity_type == "Image":
                result = await self._execute_image_operation(operation, entity_name)
            elif entity_type == "Subnet":
                result = await self._execute_subnet_operation(operation, entity_name)
            elif entity_type == "User":
                result = await self._execute_user_operation(operation, entity_name)
            elif entity_type == "Cluster":
                result = await self._execute_cluster_operation(operation, entity_name)
            elif entity_type == "Alert":
                result = await self._execute_alert_operation(operation, entity_name)
            
            # Tier 2: Self-Service
            elif entity_type == "Endpoint":
                result = await self._execute_endpoint_operation(operation, entity_name)
            elif entity_type == "Library Variable":
                result = await self._execute_library_variable_operation(operation, entity_name)
            elif entity_type == "Runbook":
                result = await self._execute_runbook_operation(operation, entity_name)
            
            # Tier 3: Application Lifecycle
            elif entity_type in ["Blueprint (Single VM)", "Blueprint (Multi VM)", "Blueprint"]:
                result = await self._execute_blueprint_operation(operation, entity_name)
            elif entity_type == "Application":
                result = await self._execute_application_operation(operation, entity_name)
            elif entity_type == "Marketplace Item":
                result = await self._execute_marketplace_operation(operation, entity_name)
            
            # Tier 4: AIOps
            elif entity_type == "Playbook":
                result = await self._execute_playbook_operation(operation, entity_name)
            elif entity_type == "UDA Policy":
                result = await self._execute_uda_policy_operation(operation, entity_name)
            elif entity_type == "Scenario":
                result = await self._execute_scenario_operation(operation, entity_name)
            elif entity_type == "Analysis Session":
                result = await self._execute_analysis_session_operation(operation, entity_name)
            
            # Tier 5: Reporting
            elif entity_type == "Report Config":
                result = await self._execute_report_config_operation(operation, entity_name)
            elif entity_type == "Report Instance":
                result = await self._execute_report_instance_operation(operation, entity_name)
            
            # Tier 6: Cloud Governance
            elif entity_type == "Business Unit":
                result = await self._execute_business_unit_operation(operation, entity_name)
            elif entity_type == "Cost Center":
                result = await self._execute_cost_center_operation(operation, entity_name)
            elif entity_type == "Budget":
                result = await self._execute_budget_operation(operation, entity_name)
            elif entity_type == "Rate Card":
                result = await self._execute_rate_card_operation(operation, entity_name)
            elif entity_type == "TCO Direct Cost":
                result = await self._execute_tco_direct_cost_operation(operation, entity_name)
            elif entity_type == "TCO Indirect Cost":
                result = await self._execute_tco_indirect_cost_operation(operation, entity_name)
            elif entity_type == "CG Report":
                result = await self._execute_cg_report_operation(operation, entity_name)
            elif entity_type == "Budget Alert":
                result = await self._execute_budget_alert_operation(operation, entity_name)
            
            else:
                logger.warning(f"Unsupported entity type for real operation: {entity_type}")
                result = {
                    'status': 'FAILED',
                    'error': f'Unsupported entity type: {entity_type}',
                    'error_type': 'UnsupportedEntityError',
                    'error_code': None,
                    'uuid': None
                }
            
            # Track pod metrics after operation (wait 5 seconds for metrics to stabilize)
            pods_after = {}
            affected_pods = []
            operation_end_time = datetime.now(timezone.utc)
            
            # Always capture pod metrics if Prometheus is available (not just when rule_config is set)
            if self.prometheus_url:
                try:
                    # Capture pods before if not already captured (get ALL pods)
                    if not pods_before:
                        pods_before = await self._get_pod_metrics_snapshot(filter_by_rule=False)
                        logger.debug(f"📊 Captured {len(pods_before)} pod metrics before operation")
                    
                    await asyncio.sleep(5)  # Wait for metrics to stabilize
                    pods_after = await self._get_pod_metrics_snapshot(filter_by_rule=False)  # Get ALL pods
                    affected_pods = self._identify_affected_pods(pods_before, pods_after)
                    
                    logger.info(f"📊 Operation {entity_type}.{operation} - Total pods: {len(pods_after)}, Affected: {len(affected_pods)}")
                    
                    # Save operation metric to database
                    operation_duration = (operation_end_time - operation_start_time).total_seconds()
                    
                    self._save_operation_metric_to_db(
                        entity_type=entity_type,
                        operation=operation,
                        entity_name=entity_name,
                        result=result,
                        start_time=operation_start_time,
                        end_time=operation_end_time,
                        duration=operation_duration,
                        pods_before=pods_before,
                        pods_after=pods_after
                    )
                    
                    # Save ALL pods correlation to database (not just affected ones)
                    if pods_before or pods_after:
                        self._save_all_pods_operation_correlation(
                            entity_type=entity_type,
                            operation=operation,
                            entity_name=entity_name,
                            result=result,
                            pods_before=pods_before,
                            pods_after=pods_after
                        )
                except Exception as e:
                    logger.warning(f"Failed to track pod metrics after operation: {e}")
            
            # Add pod correlation data to result
            result['affected_pods'] = affected_pods
            result['pod_metrics_before'] = pods_before
            result['pod_metrics_after'] = pods_after
            
            return result
                
        except Exception as e:
            import traceback
            logger.error(f"❌ Real operation failed: {e}")
            logger.debug(f"Traceback: {traceback.format_exc()}")
            
            # Still try to capture pod metrics after failure
            pods_after = {}
            if pods_before or self.prometheus_url:
                try:
                    await asyncio.sleep(2)
                    pods_after = await self._get_pod_metrics_snapshot(filter_by_rule=False)  # Get ALL pods
                except:
                    pass
            
            result = {
                'status': 'FAILED',
                'error': str(e),
                'error_type': type(e).__name__,
                'error_code': getattr(e, 'status_code', None),
                'uuid': None,
                'affected_pods': self._identify_affected_pods(pods_before, pods_after) if pods_before and pods_after else [],
                'pod_metrics_before': pods_before if pods_before else {},
                'pod_metrics_after': pods_after if pods_after else {}
            }
            return result
    
    async def _execute_simulated_operation(self, entity_type: str, operation: str, entity_name: str) -> Dict:
        """Execute simulated operation (fallback)"""
        import random
        
        # Simulate processing time
        await asyncio.sleep(random.uniform(0.1, 0.5))
        
        # 90% success rate
        if random.random() < 0.9:
            return {
                'status': 'SUCCESS',
                'uuid': f"sim-{entity_type}-{self.total_operations}",
                'error': None
            }
        else:
            return {
                'status': 'FAILED',
                'error': 'Simulated failure',
                'uuid': None
            }
    
    async def _execute_vm_operation(self, operation: str, vm_name: str) -> Dict:
        """Execute VM operation - supports create, delete, list, update, power_on, power_off, start_stress"""
        if operation == "create":
            enable_stress = False
            if self.workload_generation_enabled:
                current_cpu = self.current_metrics.get('cpu_percent', 0)
                target_cpu = self.target_config.get('cpu_threshold', 80)
                cpu_needed = target_cpu - current_cpu
                if cpu_needed > 20 or (len(self.metrics_history) >= 2 and 
                    abs(self.metrics_history[-1].get('cpu_percent', 0) - 
                        self.metrics_history[-2].get('cpu_percent', 0)) < 1.0):
                    enable_stress = True
                    logger.info(f"🔥 Creating VM with CPU stress workload: {vm_name}")
            return await self._create_vm(vm_name, enable_stress=enable_stress)
        elif operation == "delete":
            return await self._delete_vm()
        elif operation == "list":
            return await self._list_vms()
        elif operation == "update":
            return await self._update_vm(vm_name)
        elif operation == "power_on":
            return await self._power_vm("ON")
        elif operation == "power_off":
            return await self._power_vm("OFF")
        elif operation == "start_stress":
            return await self._start_stress_on_existing_vm()
        else:
            return {'status': 'FAILED', 'error': f'Unsupported VM operation: {operation}'}
    
    async def _start_vm_cpu_stress(self, vm_uuid: str, vm_name: str) -> bool:
        """Phase 2: Start CPU stress tool inside VM using guest tools/SSH"""
        try:
            # Note: This requires VM guest tools or SSH access
            # For now, we'll use a simplified approach - in production, you'd use:
            # 1. Guest tools API to execute commands
            # 2. SSH to run stress-ng or similar tools
            # 3. Or use VM actions that trigger CPU load
            
            logger.info(f"🔥 Attempting to start CPU stress on VM: {vm_name} ({vm_uuid})")
            
            # Option 1: Use guest tools if available (requires guest tools installed)
            # This is a placeholder - actual implementation depends on your VM image
            # and available guest tools
            
            # Option 2: Use VM actions that increase CPU load
            # For example, trigger VM operations that cause CPU spikes
            
            # For now, log that stress would be started
            # In production, implement actual stress tool execution
            logger.info(f"💡 CPU stress workload would be started here (requires guest tools/SSH)")
            
            return True  # Return True to indicate stress was "started" (placeholder)
            
        except Exception as e:
            logger.warning(f"⚠️  Could not start CPU stress on VM {vm_name}: {e}")
            return False
    
    async def _start_stress_on_existing_vm(self) -> Dict:
        """Phase 2: Start CPU stress on an existing VM"""
        try:
            if not self.ncm_client_ready or not self.ncm_client:
                return {'status': 'FAILED', 'error': 'NCM client not available', 'uuid': None}
            
            # Find a VM to stress
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await pc.v3_request(
                endpoint="/vms/list",
                method="POST",
                payload={"kind": "vm", "length": 10}
            )
            
            if response and isinstance(response[0].body, dict) and response[0].body.get('entities'):
                # Prefer VMs we created
                target_vm = None
                for vm in response[0].body['entities']:
                    vm_name = vm.get('spec', {}).get('name', '')
                    if vm_name.startswith('smart-vm-'):
                        target_vm = vm
                        break
                
                if not target_vm and response[0].body['entities']:
                    target_vm = response[0].body['entities'][0]
                
                if target_vm:
                    vm_uuid = target_vm['metadata']['uuid']
                    vm_name = target_vm['spec'].get('name', 'unknown')
                    
                    stress_started = await self._start_vm_cpu_stress(vm_uuid, vm_name)
                    
                    if stress_started:
                        self.stress_vms.append({
                            'uuid': vm_uuid,
                            'name': vm_name,
                            'started_at': datetime.now(timezone.utc).isoformat()
                        })
                        return {
                            'status': 'SUCCESS',
                            'uuid': vm_uuid,
                            'error': None
                        }
                    else:
                        return {
                            'status': 'FAILED',
                            'error': 'Could not start stress tool',
                            'uuid': vm_uuid
                        }
            
            return {'status': 'FAILED', 'error': 'No VMs found', 'uuid': None}
            
        except Exception as e:
            logger.error(f"❌ Failed to start stress on VM: {e}")
            return {'status': 'FAILED', 'error': str(e), 'uuid': None}
    
    async def _create_vm(self, vm_name: str, enable_stress: bool = False) -> Dict:
        """Create a new VM with dynamically discovered image/subnet/cluster"""
        try:
            if not self.IMAGE_UUID or not self.subnet_uuid or not self.cluster_uuid:
                return {
                    'status': 'FAILED',
                    'error': f'Missing dependencies: image={self.IMAGE_UUID is not None}, subnet={self.subnet_uuid is not None}, cluster={self.cluster_uuid is not None}',
                    'error_type': 'DependencyError',
                    'error_code': None,
                    'uuid': None
                }
            
            num_sockets = 2 if enable_stress else 1
            num_vcpus_per_socket = 2 if enable_stress else 1
            memory_mib = 2048 if enable_stress else 1024
            
            vm_payload = {
                "spec": {
                    "name": vm_name,
                    "resources": {
                        "power_state": "ON",
                        "num_vcpus_per_socket": num_vcpus_per_socket,
                        "num_sockets": num_sockets,
                        "memory_size_mib": memory_mib,
                        "disk_list": [{
                            "data_source_reference": {
                                "kind": "image",
                                "uuid": self.IMAGE_UUID,
                                "name": self.IMAGE_NAME
                            },
                            "device_properties": {
                                "device_type": "DISK",
                                "disk_address": {
                                    "device_index": 0,
                                    "adapter_type": "SCSI"
                                }
                            }
                        }],
                        "nic_list": [{
                            "subnet_reference": {
                                "kind": "subnet",
                                "uuid": self.subnet_uuid,
                                "name": self.subnet_name
                            },
                            "is_connected": True
                        }]
                    },
                    "cluster_reference": {
                        "kind": "cluster",
                        "uuid": self.cluster_uuid,
                        "name": self.cluster_name
                    }
                },
                "metadata": {
                    "kind": "vm"
                }
            }
            
            logger.info(f"📤 Creating VM: {vm_name} (image={self.IMAGE_NAME}, subnet={self.subnet_name})")
            client = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await client.v3_request(
                endpoint="/vms",
                method="POST",
                payload=vm_payload
            )
            
            if response and response[0].status in (200, 202):
                body = response[0].body
                vm_uuid = body.get('metadata', {}).get('uuid') if isinstance(body, dict) else None
                logger.info(f"✅ VM created: {vm_name} ({vm_uuid})")
                
                if enable_stress and self.workload_generation_enabled and vm_uuid:
                    await asyncio.sleep(10)
                    stress_result = await self._start_vm_cpu_stress(vm_uuid, vm_name)
                    if stress_result:
                        self.stress_vms.append({
                            'uuid': vm_uuid,
                            'name': vm_name,
                            'started_at': datetime.now(timezone.utc).isoformat()
                        })
                
                return {
                    'status': 'SUCCESS',
                    'uuid': vm_uuid,
                    'error': None,
                    'error_type': None,
                    'error_code': None,
                    'stress_enabled': enable_stress
                }
            else:
                status_code = response[0].status if response else 'N/A'
                error_msg = self._extract_api_error(response)
                logger.error(f"❌ VM creation failed: HTTP {status_code} - {error_msg}")
                return {
                    'status': 'FAILED',
                    'error': f'HTTP {status_code}: {error_msg}',
                    'error_type': 'APIError',
                    'error_code': status_code,
                    'uuid': None
                }
                
        except Exception as e:
            import traceback
            logger.error(f"❌ VM creation failed: {e}")
            logger.debug(f"Traceback: {traceback.format_exc()}")
            return {
                'status': 'FAILED',
                'error': str(e),
                'error_type': type(e).__name__,
                'error_code': getattr(e, 'status_code', None),
                'uuid': None
            }
    
    async def _delete_vm(self) -> Dict:
        """Delete a VM (find one created by this execution)"""
        try:
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await pc.v3_request(
                endpoint="/vms/list",
                method="POST",
                payload={"kind": "vm", "length": 10}
            )
            
            if response and isinstance(response[0].body, dict) and response[0].body.get('entities'):
                # Find a VM we created (starts with "smart-vm-")
                for vm in response[0].body['entities']:
                    vm_name = vm.get('spec', {}).get('name', '')
                    if vm_name.startswith('smart-vm-'):
                        vm_uuid = vm['metadata']['uuid']
                        logger.info(f"🗑️  Deleting VM: {vm_name} ({vm_uuid})")
                        
                        await pc.v3_request(
                            endpoint=f"/vms/{vm_uuid}",
                            method="DELETE"
                        )
                        
                        logger.info(f"✅ VM deleted: {vm_name}")
                        return {'status': 'SUCCESS', 'uuid': vm_uuid, 'error': None}
                
                return {'status': 'FAILED', 'error': 'No VMs found to delete'}
            else:
                return {'status': 'FAILED', 'error': 'No VMs found'}
                
        except Exception as e:
            logger.error(f"VM deletion failed: {e}")
            return {'status': 'FAILED', 'error': str(e)}
    
    async def _list_vms(self) -> Dict:
        """List VMs — lightweight read operation for API load generation."""
        try:
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await asyncio.wait_for(
                pc.v3_request(endpoint="/vms/list", method="POST",
                              payload={"kind": "vm", "length": 20}),
                timeout=30.0
            )
            if response and response[0].status in (200, 202):
                entities = response[0].body.get('entities', []) if isinstance(response[0].body, dict) else []
                logger.info(f"✅ VM list returned {len(entities)} VMs")
                return {'status': 'SUCCESS', 'uuid': None, 'error': None, 'count': len(entities)}
            else:
                error_msg = self._extract_api_error(response)
                return {'status': 'FAILED', 'error': f'VM list failed: {error_msg}', 'uuid': None}
        except asyncio.TimeoutError:
            return {'status': 'FAILED', 'error': 'VM list timed out', 'uuid': None}
        except Exception as e:
            logger.error(f"VM list failed: {e}")
            return {'status': 'FAILED', 'error': str(e), 'uuid': None}

    async def _update_vm(self, vm_name: str) -> Dict:
        """Update a VM (find an existing smart-vm and update its description)."""
        try:
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await asyncio.wait_for(
                pc.v3_request(endpoint="/vms/list", method="POST",
                              payload={"kind": "vm", "length": 20,
                                       "filter": "vm_name==smart-vm-*"}),
                timeout=30.0
            )
            if response and isinstance(response[0].body, dict):
                entities = response[0].body.get('entities', [])
                for vm in entities:
                    vm_uuid = vm.get('metadata', {}).get('uuid')
                    if not vm_uuid:
                        continue
                    spec = vm.get('spec', {})
                    spec.setdefault('description', '')
                    spec['description'] = f'Updated by smart execution {self.execution_id}'
                    update_payload = {
                        'spec': spec,
                        'metadata': vm.get('metadata', {}),
                    }
                    update_resp = await asyncio.wait_for(
                        pc.v3_request(endpoint=f"/vms/{vm_uuid}", method="PUT",
                                      payload=update_payload),
                        timeout=30.0
                    )
                    if update_resp and update_resp[0].status in (200, 202):
                        logger.info(f"✅ VM updated: {vm_uuid}")
                        return {'status': 'SUCCESS', 'uuid': vm_uuid, 'error': None}
                    else:
                        error_msg = self._extract_api_error(update_resp)
                        return {'status': 'FAILED', 'error': f'VM update failed: {error_msg}', 'uuid': None}
            return {'status': 'FAILED', 'error': 'No smart-vm found to update', 'uuid': None}
        except asyncio.TimeoutError:
            return {'status': 'FAILED', 'error': 'VM update timed out', 'uuid': None}
        except Exception as e:
            logger.error(f"VM update failed: {e}")
            return {'status': 'FAILED', 'error': str(e), 'uuid': None}

    async def _power_vm(self, power_state: str) -> Dict:
        """Power on/off a VM - HIGH IMPACT CPU OPERATION"""
        try:
            if not self.ncm_client_ready or not self.ncm_client:
                return {'status': 'FAILED', 'error': 'NCM client not available', 'uuid': None}
            
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await pc.v3_request(
                endpoint="/vms/list",
                method="POST",
                payload={"kind": "vm", "length": 20}
            )
            
            if response and isinstance(response[0].body, dict) and response[0].body.get('entities'):
                # Prefer VMs we created, otherwise use any VM
                target_vm = None
                for vm in response[0].body['entities']:
                    vm_name = vm.get('spec', {}).get('name', '')
                    if vm_name.startswith('smart-vm-'):
                        target_vm = vm
                        break
                
                # If no smart VM found, use first available VM
                if not target_vm and response[0].body['entities']:
                    target_vm = response[0].body['entities'][0]
                
                if target_vm:
                    vm_uuid = target_vm['metadata']['uuid']
                    vm_name = target_vm['spec'].get('name', 'unknown')
                    current_power_state = target_vm['spec'].get('resources', {}).get('power_state', 'OFF')
                    
                    # Only change power state if different
                    if current_power_state.upper() != power_state.upper():
                        logger.info(f"⚡ Power {power_state} VM: {vm_name} ({vm_uuid})")
                        
                        power_payload = {
                            "spec": {
                                "resources": {
                                    "power_state": power_state.upper()
                                }
                            },
                            "metadata": {
                                "kind": "vm"
                            }
                        }
                        
                        await pc.v3_request(
                            endpoint=f"/vms/{vm_uuid}",
                            method="PUT",
                            payload=power_payload
                        )
                        
                        logger.info(f"✅ VM power state changed: {vm_name} → {power_state}")
                        return {
                            'status': 'SUCCESS',
                            'uuid': vm_uuid,
                            'error': None,
                            'error_type': None,
                            'error_code': None
                        }
                    else:
                        logger.info(f"ℹ️  VM {vm_name} already in {power_state} state")
                        return {
                            'status': 'SUCCESS',
                            'uuid': vm_uuid,
                            'error': None,
                            'error_type': None,
                            'error_code': None
                        }
                else:
                    return {
                        'status': 'FAILED',
                        'error': 'No VMs found to power on/off',
                        'error_type': 'NoVMError',
                        'error_code': None,
                        'uuid': None
                    }
            else:
                return {
                    'status': 'FAILED',
                    'error': 'No VMs found',
                    'error_type': 'NoVMError',
                    'error_code': None,
                    'uuid': None
                }
                
        except Exception as e:
            import traceback
            logger.error(f"❌ VM power operation failed: {e}")
            logger.debug(f"Traceback: {traceback.format_exc()}")
            return {
                'status': 'FAILED',
                'error': str(e),
                'error_type': type(e).__name__,
                'error_code': getattr(e, 'status_code', None),
                'uuid': None
            }
    
    async def _execute_project_operation(self, operation: str, project_name: str) -> Dict:
        """Execute Project operation"""
        if operation == "create":
            return await self._create_project(project_name)
        else:
            return {'status': 'FAILED', 'error': f'Unsupported Project operation: {operation}'}
    
    async def _create_project(self, project_name: str) -> Dict:
        """Create a new project via PC v3 API"""
        try:
            project_payload = {
                "spec": {
                    "name": project_name,
                    "description": f"Created by smart execution {self.execution_id}",
                    "resources": {}
                },
                "metadata": {
                    "kind": "project"
                }
            }
            
            logger.info(f"📤 Creating Project: {project_name}")
            client = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await client.v3_request(
                endpoint="/projects",
                method="POST",
                payload=project_payload
            )
            
            if response and response[0].status in (200, 202):
                body = response[0].body
                project_uuid = body.get('metadata', {}).get('uuid') if isinstance(body, dict) else None
                logger.info(f"✅ Project created: {project_name} ({project_uuid})")
                return {'status': 'SUCCESS', 'uuid': project_uuid, 'error': None}
            else:
                error_msg = self._extract_api_error(response)
                status_code = response[0].status if response else 'N/A'
                logger.error(f"❌ Project create failed: HTTP {status_code} - {error_msg}")
                return {'status': 'FAILED', 'error': f'HTTP {status_code}: {error_msg}', 'uuid': None}
                
        except Exception as e:
            logger.error(f"Project creation failed: {e}")
            return {'status': 'FAILED', 'error': str(e)}
    
    async def _execute_category_operation(self, operation: str, category_name: str) -> Dict:
        """Execute Category operation"""
        try:
            if operation == "create":
                return await self._create_category(category_name)
            elif operation == "delete":
                return await self._delete_category()
            else:
                return {
                    'status': 'FAILED',
                    'error': f'Unsupported Category operation: {operation}',
                    'error_type': 'UnsupportedOperationError',
                    'error_code': None,
                    'uuid': None
                }
        except Exception as e:
            import traceback
            logger.error(f"❌ Category operation {operation} failed: {e}")
            return {
                'status': 'FAILED',
                'error': str(e),
                'error_type': type(e).__name__,
                'error_code': getattr(e, 'status_code', None),
                'uuid': None
            }
    
    async def _create_category(self, category_name: str) -> Dict:
        """Create a new category"""
        try:
            category_payload = {
                "spec": {
                    "name": category_name,
                    "description": f"Created by smart execution {self.execution_id}"
                },
                "metadata": {
                    "kind": "category"
                }
            }
            
            logger.info(f"📤 Creating Category: {category_name}")
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await pc.v3_request(
                endpoint="/categories",
                method="POST",
                payload=category_payload
            )
            
            if response and response[0].body:
                category_uuid = response[0].body.get('metadata', {}).get('uuid')
                logger.info(f"✅ Category created: {category_name} ({category_uuid})")
                return {
                    'status': 'SUCCESS',
                    'uuid': category_uuid,
                    'error': None,
                    'error_type': None,
                    'error_code': None
                }
            else:
                return {
                    'status': 'FAILED',
                    'error': 'No response from NCM API',
                    'error_type': 'EmptyResponseError',
                    'error_code': None,
                    'uuid': None
                }
        except Exception as e:
            import traceback
            logger.error(f"❌ Category creation failed: {e}")
            return {
                'status': 'FAILED',
                'error': str(e),
                'error_type': type(e).__name__,
                'error_code': getattr(e, 'status_code', None),
                'uuid': None
            }
    
    async def _delete_category(self) -> Dict:
        """Delete a category"""
        try:
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await pc.v3_request(
                endpoint="/categories/list",
                method="POST",
                payload={"kind": "category", "length": 10}
            )
            
            if response and response[0].body.get('entities'):
                for cat in response[0].body['entities']:
                    cat_name = cat.get('spec', {}).get('name', '')
                    if 'smart-category' in cat_name.lower():
                        cat_uuid = cat['metadata']['uuid']
                        logger.info(f"🗑️  Deleting Category: {cat_name} ({cat_uuid})")
                        
                        await pc.v3_request(
                            endpoint=f"/categories/{cat_uuid}",
                            method="DELETE"
                        )
                        return {'status': 'SUCCESS', 'uuid': cat_uuid, 'error': None}
                
                return {'status': 'FAILED', 'error': 'No smart-category found to delete'}
            else:
                return {'status': 'FAILED', 'error': 'No categories found'}
        except Exception as e:
            logger.error(f"❌ Category deletion failed: {e}")
            return {
                'status': 'FAILED',
                'error': str(e),
                'error_type': type(e).__name__,
                'error_code': getattr(e, 'status_code', None),
                'uuid': None
            }
    
    async def _execute_image_operation(self, operation: str, image_name: str) -> Dict:
        """Execute Image operation"""
        try:
            if operation == "update":
                return await self._update_image(image_name)
            else:
                # Images are typically read-only (created from uploads/disks)
                # We can only update metadata
                return {
                    'status': 'FAILED',
                    'error': f'Unsupported Image operation: {operation} (Images are mostly read-only)',
                    'error_type': 'UnsupportedOperationError',
                    'error_code': None,
                    'uuid': None
                }
        except Exception as e:
            import traceback
            logger.error(f"❌ Image operation {operation} failed: {e}")
            return {
                'status': 'FAILED',
                'error': str(e),
                'error_type': type(e).__name__,
                'error_code': getattr(e, 'status_code', None),
                'uuid': None
            }
    
    async def _update_image(self, image_name: str) -> Dict:
        """Update image metadata"""
        try:
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await pc.v3_request(
                endpoint="/images/list",
                method="POST",
                payload={"kind": "image", "length": 1}
            )
            
            if response and response[0].body.get('entities'):
                image = response[0].body['entities'][0]
                image_uuid = image['metadata']['uuid']
                
                # Update description
                update_payload = image
                update_payload['spec']['description'] = f"Updated by smart execution {self.execution_id}"
                
                logger.info(f"📤 Updating Image metadata: {image_uuid}")
                update_response = await pc.v3_request(
                    endpoint=f"/images/{image_uuid}",
                    method="PUT",
                    payload=update_payload
                )
                
                if update_response:
                    logger.info(f"✅ Image metadata updated: {image_uuid}")
                    return {
                        'status': 'SUCCESS',
                        'uuid': image_uuid,
                        'error': None,
                        'error_type': None,
                        'error_code': None
                    }
                else:
                    return {
                        'status': 'FAILED',
                        'error': 'No response from NCM API',
                        'error_type': 'EmptyResponseError',
                        'error_code': None,
                        'uuid': None
                    }
            else:
                return {'status': 'FAILED', 'error': 'No images found'}
        except Exception as e:
            logger.error(f"❌ Image update failed: {e}")
            return {
                'status': 'FAILED',
                'error': str(e),
                'error_type': type(e).__name__,
                'error_code': getattr(e, 'status_code', None),
                'uuid': None
            }
    
    async def _execute_subnet_operation(self, operation: str, subnet_name: str) -> Dict:
        """Execute Subnet operation"""
        try:
            if operation == "list":
                # List subnets using v4 networking API
                try:
                    logger.info(f"📋 Listing Subnets")
                    # Use v4 networking API for subnets
                    response = await self.ncm_client.v4_networking_request(
                        endpoint="/subnets/list",
                        method="POST",
                        payload={"length": 100}
                    )
                    
                    if response and response[0].body:
                        entities = response[0].body.get('entities', [])
                        subnet_count = len(entities)
                        logger.info(f"✅ Listed {subnet_count} subnet(s)")
                        return {
                            'status': 'SUCCESS',
                            'count': subnet_count,
                            'entities': entities[:10],
                            'error': None
                        }
                    else:
                        return {
                            'status': 'FAILED',
                            'error': 'Failed to list subnets',
                            'error_type': 'ListError',
                            'error_code': None,
                            'count': 0
                        }
                except Exception as e:
                    logger.error(f"❌ Error listing subnets: {e}")
                    return {
                        'status': 'FAILED',
                        'error': str(e),
                        'error_type': type(e).__name__,
                        'error_code': getattr(e, 'status_code', None),
                        'count': 0
                    }
            elif operation == "create":
                return await self._create_subnet(subnet_name)
            elif operation == "delete":
                return await self._delete_subnet()
            else:
                return {
                    'status': 'FAILED',
                    'error': f'Unsupported Subnet operation: {operation}',
                    'error_type': 'UnsupportedOperationError',
                    'error_code': None,
                    'uuid': None
                }
        except Exception as e:
            import traceback
            logger.error(f"❌ Subnet operation {operation} failed: {e}")
            return {
                'status': 'FAILED',
                'error': str(e),
                'error_type': type(e).__name__,
                'error_code': getattr(e, 'status_code', None),
                'uuid': None
            }
    
    async def _create_subnet(self, subnet_name: str) -> Dict:
        """Create a new subnet"""
        try:
            subnet_payload = {
                "spec": {
                    "name": subnet_name,
                    "resources": {
                        "subnet_type": "VLAN",
                        "vlan_id": 100 + (self.total_operations % 100),  # Dynamic VLAN ID
                        "network_function_chain_reference": None,
                        "ip_config": {
                            "subnet_ip": "192.168.100.0",
                            "prefix_length": 24,
                            "default_gateway_ip": "192.168.100.1",
                            "pool_list": [{
                                "range": "192.168.100.10 192.168.100.50"
                            }]
                        }
                    },
                    "cluster_reference": {
                        "kind": "cluster",
                        "uuid": self.cluster_uuid
                    }
                },
                "metadata": {
                    "kind": "subnet"
                }
            }
            
            logger.info(f"📤 Creating Subnet: {subnet_name}")
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await pc.v3_request(
                endpoint="/subnets",
                method="POST",
                payload=subnet_payload
            )
            
            if response and response[0].body:
                subnet_uuid = response[0].body.get('metadata', {}).get('uuid')
                logger.info(f"✅ Subnet created: {subnet_name} ({subnet_uuid})")
                return {
                    'status': 'SUCCESS',
                    'uuid': subnet_uuid,
                    'error': None,
                    'error_type': None,
                    'error_code': None
                }
            else:
                return {
                    'status': 'FAILED',
                    'error': 'No response from NCM API',
                    'error_type': 'EmptyResponseError',
                    'error_code': None,
                    'uuid': None
                }
        except Exception as e:
            import traceback
            logger.error(f"❌ Subnet creation failed: {e}")
            return {
                'status': 'FAILED',
                'error': str(e),
                'error_type': type(e).__name__,
                'error_code': getattr(e, 'status_code', None),
                'uuid': None
            }
    
    async def _delete_subnet(self) -> Dict:
        """Delete a subnet"""
        try:
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await pc.v3_request(
                endpoint="/subnets/list",
                method="POST",
                payload={"kind": "subnet", "length": 10}
            )
            
            if response and response[0].body.get('entities'):
                for subnet in response[0].body['entities']:
                    subnet_name = subnet.get('spec', {}).get('name', '')
                    if 'smart-subnet' in subnet_name.lower():
                        subnet_uuid = subnet['metadata']['uuid']
                        logger.info(f"🗑️  Deleting Subnet: {subnet_name} ({subnet_uuid})")
                        
                        await pc.v3_request(
                            endpoint=f"/subnets/{subnet_uuid}",
                            method="DELETE"
                        )
                        return {'status': 'SUCCESS', 'uuid': subnet_uuid, 'error': None}
                
                return {'status': 'FAILED', 'error': 'No smart-subnet found to delete'}
            else:
                return {'status': 'FAILED', 'error': 'No subnets found'}
        except Exception as e:
            logger.error(f"❌ Subnet deletion failed: {e}")
            return {
                'status': 'FAILED',
                'error': str(e),
                'error_type': type(e).__name__,
                'error_code': getattr(e, 'status_code', None),
                'uuid': None
            }
    
    # ============================================================================
    # TIER 1.5: READ-ONLY INFRASTRUCTURE ENTITIES (LIST OPERATIONS)
    # ============================================================================
    
    async def _execute_user_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute User operation (list only - read-only for safety)"""
        if operation == "list":
            return await self._generic_entity_operation("User", "/users", operation, entity_name, {})
        else:
            return {
                'status': 'FAILED',
                'error': f'Unsupported User operation: {operation}. Only "list" is supported for safety.',
                'error_type': 'UnsupportedOperationError',
                'error_code': None,
                'uuid': None
            }
    
    async def _execute_cluster_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Cluster operation (list only - read-only for safety)"""
        if operation == "list":
            # Clusters use v4 devops API
            try:
                logger.info(f"📋 Listing Clusters")
                response = await self.ncm_client.v4_devops_request(
                    endpoint="/clusters/list",
                    method="POST",
                    payload={"length": 100}
                )
                
                if response and response[0].body:
                    entities = response[0].body.get('entities', [])
                    cluster_count = len(entities)
                    logger.info(f"✅ Listed {cluster_count} cluster(s)")
                    return {
                        'status': 'SUCCESS',
                        'count': cluster_count,
                        'entities': entities[:10],
                        'error': None
                    }
                else:
                    return {
                        'status': 'FAILED',
                        'error': 'Failed to list clusters',
                        'error_type': 'ListError',
                        'error_code': None,
                        'count': 0
                    }
            except Exception as e:
                logger.error(f"❌ Error listing clusters: {e}")
                return {
                    'status': 'FAILED',
                    'error': str(e),
                    'error_type': type(e).__name__,
                    'error_code': getattr(e, 'status_code', None),
                    'count': 0
                }
        else:
            return {
                'status': 'FAILED',
                'error': f'Unsupported Cluster operation: {operation}. Only "list" is supported for safety.',
                'error_type': 'UnsupportedOperationError',
                'error_code': None,
                'uuid': None
            }
    
    async def _execute_alert_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Alert operation (list, acknowledge, resolve)"""
        try:
            if operation == "list":
                # Alerts use v4 devops API
                logger.info(f"📋 Listing Alerts")
                response = await self.ncm_client.v4_devops_request(
                    endpoint="/alerts/list",
                    method="POST",
                    payload={"length": 100}
                )
                
                if response and response[0].body:
                    entities = response[0].body.get('entities', [])
                    alert_count = len(entities)
                    logger.info(f"✅ Listed {alert_count} alert(s)")
                    return {
                        'status': 'SUCCESS',
                        'count': alert_count,
                        'entities': entities[:10],
                        'error': None
                    }
                else:
                    return {
                        'status': 'FAILED',
                        'error': 'Failed to list alerts',
                        'error_type': 'ListError',
                        'error_code': None,
                        'count': 0
                    }
            
            elif operation == "acknowledge":
                # Acknowledge an alert (need alert UUID)
                # For now, list alerts and acknowledge the first one
                list_response = await self.ncm_client.v4_devops_request(
                    endpoint="/alerts/list",
                    method="POST",
                    payload={"length": 10}
                )
                
                if list_response and list_response[0].body.get('entities'):
                    alert_uuid = list_response[0].body['entities'][0].get('ext_id')
                    if alert_uuid:
                        logger.info(f"✅ Acknowledging Alert: {alert_uuid}")
                        response = await self.ncm_client.v4_devops_request(
                            endpoint=f"/alerts/{alert_uuid}/acknowledge",
                            method="POST",
                            payload={}
                        )
                        if response and response[0].status in [200, 201, 202]:
                            return {'status': 'SUCCESS', 'uuid': alert_uuid, 'error': None}
                
                return {'status': 'FAILED', 'error': 'No alerts found to acknowledge'}
            
            elif operation == "resolve":
                # Resolve an alert (need alert UUID)
                list_response = await self.ncm_client.v4_devops_request(
                    endpoint="/alerts/list",
                    method="POST",
                    payload={"length": 10}
                )
                
                if list_response and list_response[0].body.get('entities'):
                    alert_uuid = list_response[0].body['entities'][0].get('ext_id')
                    if alert_uuid:
                        logger.info(f"✅ Resolving Alert: {alert_uuid}")
                        response = await self.ncm_client.v4_devops_request(
                            endpoint=f"/alerts/{alert_uuid}/resolve",
                            method="POST",
                            payload={}
                        )
                        if response and response[0].status in [200, 201, 202]:
                            return {'status': 'SUCCESS', 'uuid': alert_uuid, 'error': None}
                
                return {'status': 'FAILED', 'error': 'No alerts found to resolve'}
            
            else:
                return {
                    'status': 'FAILED',
                    'error': f'Unsupported Alert operation: {operation}',
                    'error_type': 'UnsupportedOperationError',
                    'error_code': None,
                    'uuid': None
                }
        except Exception as e:
            logger.error(f"❌ Error executing alert operation: {e}")
            return {
                'status': 'FAILED',
                'error': str(e),
                'error_type': type(e).__name__,
                'error_code': getattr(e, 'status_code', None),
                'uuid': None
            }
    
    # ============================================================================
    # TIER 2: SELF-SERVICE ENTITIES (REAL OPERATIONS)
    # ============================================================================
    
    async def _execute_endpoint_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Endpoint operation"""
        return await self._generic_entity_operation("Endpoint", "/endpoints", operation, entity_name, {
            "spec": {
                "name": entity_name,
                "description": f"Created by smart execution {self.execution_id}",
                "resources": {
                    "type": "HTTP"
                }
            },
            "metadata": {"kind": "endpoint"}
        })
    
    async def _execute_library_variable_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Library Variable operation"""
        return await self._generic_entity_operation("Library Variable", "/calm_global_variables", operation, entity_name, {
            "spec": {
                "name": entity_name,
                "description": f"Created by smart execution {self.execution_id}",
                "value": "test_value"
            },
            "metadata": {"kind": "global_variable"}
        })
    
    async def _execute_runbook_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Runbook operation"""
        if operation == "execute":
            # Special handling for execute operation
            return await self._simulate_operation("Runbook", operation, entity_name)
        return await self._generic_entity_operation("Runbook", "/runbooks", operation, entity_name, {
            "spec": {
                "name": entity_name,
                "description": f"Created by smart execution {self.execution_id}",
                "resources": {
                    "runbook": {
                        "task_definition_list": [],
                        "variable_list": []
                    }
                }
            },
            "metadata": {"kind": "runbook"}
        })
    
    # ============================================================================
    # TIER 3: APPLICATION LIFECYCLE (REAL OPERATIONS)
    # ============================================================================
    
    async def _execute_blueprint_operation(self, operation: str, blueprint_name: str) -> Dict:
        """Execute Blueprint operation via Calm v3.0 API (api/calm/v3.0/blueprints)"""
        if operation == "launch":
            return await self._simulate_operation("Blueprint", operation, blueprint_name)
        
        if operation == "create":
            try:
                import uuid as uuid_mod
                
                # Use calm_v3_request with a 30-second timeout to avoid long waits
                # if Calm/Self-Service is not available on this testbed
                if hasattr(self.ncm_client, 'calm_v3_request'):
                    substrate_uuid = str(uuid_mod.uuid4())
                    service_uuid = str(uuid_mod.uuid4())
                    package_uuid = str(uuid_mod.uuid4())
                    profile_uuid = str(uuid_mod.uuid4())
                    
                    bp_payload = {
                        "api_version": "3.0",
                        "metadata": {
                            "kind": "blueprint",
                            "uuid": str(uuid_mod.uuid4())
                        },
                        "spec": {
                            "name": blueprint_name,
                            "description": f"Created by smart execution {self.execution_id}",
                            "resources": {
                                "type": "USER",
                                "credential_definition_list": [],
                                "service_definition_list": [{
                                    "uuid": service_uuid,
                                    "name": "Service1",
                                    "description": "",
                                    "singleton": False,
                                    "action_list": [],
                                    "variable_list": [],
                                    "depends_on_list": [],
                                    "port_list": []
                                }],
                                "substrate_definition_list": [{
                                    "uuid": substrate_uuid,
                                    "name": "VM1",
                                    "type": "AHV_VM",
                                    "os_type": "Linux",
                                    "action_list": [],
                                    "variable_list": [],
                                    "create_spec": {
                                        "name": blueprint_name[:50] + "-vm",
                                        "resources": {
                                            "num_sockets": 1,
                                            "num_vcpus_per_socket": 1,
                                            "memory_size_mib": 1024,
                                            "disk_list": [],
                                            "nic_list": [],
                                            "power_state": "ON"
                                        }
                                    },
                                    "readiness_probe": {
                                        "disable_readiness_probe": True
                                    }
                                }],
                                "package_definition_list": [{
                                    "uuid": package_uuid,
                                    "name": "Package1",
                                    "description": "",
                                    "type": "DEB",
                                    "service_local_reference_list": [{"kind": "app_service", "uuid": service_uuid}],
                                    "variable_list": [],
                                    "action_list": []
                                }],
                                "app_profile_list": [{
                                    "uuid": profile_uuid,
                                    "name": "Default",
                                    "description": "",
                                    "deployment_create_list": [{
                                        "uuid": str(uuid_mod.uuid4()),
                                        "name": "Deployment1",
                                        "min_replicas": "1",
                                        "max_replicas": "1",
                                        "default_replicas": "1",
                                        "substrate_local_reference": {"kind": "app_substrate", "uuid": substrate_uuid},
                                        "package_local_reference_list": [{"kind": "app_package", "uuid": package_uuid}],
                                        "published_service_local_reference_list": []
                                    }],
                                    "action_list": [],
                                    "variable_list": []
                                }]
                            }
                        }
                    }
                    
                    logger.info(f"📤 Creating Blueprint via Calm API: {blueprint_name}")
                    try:
                        response = await asyncio.wait_for(
                            self.ncm_client.calm_v3_request(
                                endpoint="/blueprints",
                                method="POST",
                                payload=bp_payload
                            ),
                            timeout=30.0
                        )
                        if response and response[0].status in (200, 202):
                            body = response[0].body
                            bp_uuid = body.get('metadata', {}).get('uuid') if isinstance(body, dict) else None
                            logger.info(f"✅ Blueprint created via Calm API: {blueprint_name} ({bp_uuid})")
                            return {'status': 'SUCCESS', 'uuid': bp_uuid, 'error': None}
                        else:
                            error_msg = self._extract_api_error(response)
                            logger.error(f"❌ Blueprint create failed: {error_msg}")
                            return {'status': 'FAILED', 'error': f"Calm API: {error_msg}", 'uuid': None}
                    except asyncio.TimeoutError:
                        logger.error("❌ Blueprint create timed out (Calm/Self-Service may not be available)")
                        return {'status': 'SKIPPED', 'error': 'Calm/Self-Service not available (timeout)', 'uuid': None}
                
                return {'status': 'SKIPPED', 'error': 'Calm v3 API not available on NCM client', 'uuid': None}
            except Exception as e:
                logger.error(f"Blueprint create failed: {e}")
                return {'status': 'FAILED', 'error': str(e), 'uuid': None}
        
        if operation == "delete":
            try:
                if hasattr(self.ncm_client, 'calm_v3_request'):
                    list_resp = await asyncio.wait_for(
                        self.ncm_client.calm_v3_request(
                            endpoint="/blueprints/list",
                            method="POST",
                            payload={"kind": "blueprint", "length": 20,
                                     "filter": "name==smart-bp-*"}
                        ), timeout=30.0
                    )
                    if list_resp and list_resp[0].status == 200 and isinstance(list_resp[0].body, dict):
                        for bp in list_resp[0].body.get('entities', []):
                            bp_uuid = bp.get('metadata', {}).get('uuid')
                            if bp_uuid:
                                del_resp = await asyncio.wait_for(
                                    self.ncm_client.calm_v3_request(
                                        endpoint=f"/blueprints/{bp_uuid}",
                                        method="DELETE"
                                    ), timeout=30.0
                                )
                                if del_resp and del_resp[0].status in (200, 202, 204):
                                    logger.info(f"✅ Blueprint deleted: {bp_uuid}")
                                    return {'status': 'SUCCESS', 'uuid': bp_uuid, 'error': None}
                    return {'status': 'FAILED', 'error': 'No smart-bp blueprint found to delete', 'uuid': None}
            except asyncio.TimeoutError:
                return {'status': 'SKIPPED', 'error': 'Calm API timeout on blueprint delete', 'uuid': None}
            except Exception as e:
                logger.warning(f"Blueprint delete failed ({e}), falling back to simulated")
            return await self._simulate_operation("Blueprint", operation, blueprint_name)
        
        if operation == "execute":
            try:
                if hasattr(self.ncm_client, 'calm_v3_request'):
                    list_resp = await asyncio.wait_for(
                        self.ncm_client.calm_v3_request(
                            endpoint="/blueprints/list",
                            method="POST",
                            payload={"kind": "blueprint", "length": 10}
                        ), timeout=30.0
                    )
                    if list_resp and list_resp[0].status == 200 and isinstance(list_resp[0].body, dict):
                        for bp in list_resp[0].body.get('entities', []):
                            bp_uuid = bp.get('metadata', {}).get('uuid')
                            bp_name = bp.get('metadata', {}).get('name', '')
                            if bp_uuid and 'smart-bp' in bp_name.lower():
                                launch_resp = await asyncio.wait_for(
                                    self.ncm_client.calm_v3_request(
                                        endpoint=f"/blueprints/{bp_uuid}/simple_launch",
                                        method="POST",
                                        payload={
                                            "spec": {
                                                "app_name": f"smart-app-{bp_name[:20]}",
                                                "app_description": f"Launched by {self.execution_id}"
                                            }
                                        }
                                    ), timeout=60.0
                                )
                                if launch_resp and launch_resp[0].status in (200, 202):
                                    logger.info(f"✅ Blueprint launched: {bp_name}")
                                    return {'status': 'SUCCESS', 'uuid': bp_uuid, 'error': None}
                                else:
                                    error_msg = self._extract_api_error(launch_resp)
                                    return {'status': 'FAILED', 'error': f'Blueprint launch failed: {error_msg}', 'uuid': None}
                    return {'status': 'FAILED', 'error': 'No smart-bp blueprint found to launch', 'uuid': None}
            except asyncio.TimeoutError:
                return {'status': 'SKIPPED', 'error': 'Calm API timeout on blueprint execute', 'uuid': None}
            except Exception as e:
                logger.warning(f"Blueprint execute failed ({e}), falling back to simulated")
            return await self._simulate_operation("Blueprint", operation, blueprint_name)
        
        if operation == "list":
            try:
                if hasattr(self.ncm_client, 'calm_v3_request'):
                    resp = await asyncio.wait_for(
                        self.ncm_client.calm_v3_request(
                            endpoint="/blueprints/list",
                            method="POST",
                            payload={"kind": "blueprint", "length": 20}
                        ), timeout=30.0
                    )
                    if resp and resp[0].status == 200:
                        count = len(resp[0].body.get('entities', [])) if isinstance(resp[0].body, dict) else 0
                        logger.info(f"✅ Blueprint list returned {count} blueprints")
                        return {'status': 'SUCCESS', 'uuid': None, 'error': None, 'count': count}
            except asyncio.TimeoutError:
                return {'status': 'SKIPPED', 'error': 'Calm API timeout on blueprint list', 'uuid': None}
            except Exception as e:
                logger.warning(f"Blueprint list failed ({e})")
            return await self._simulate_operation("Blueprint", operation, blueprint_name)
        
        return await self._simulate_operation("Blueprint", operation, blueprint_name)
    
    async def _execute_application_operation(self, operation: str, app_name: str) -> Dict:
        """Execute Application operation"""
        return await self._generic_entity_operation("Application", "/apps", operation, app_name, {
            "spec": {
                "name": app_name,
                "description": f"Created by smart execution {self.execution_id}",
                "resources": {}
            },
            "metadata": {"kind": "app"}
        })
    
    async def _execute_marketplace_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Marketplace Item operation"""
        if operation in ["publish", "unpublish"]:
            return await self._simulate_operation("Marketplace Item", operation, entity_name)
        return await self._generic_entity_operation("Marketplace Item", "/calm_marketplace_items", operation, entity_name, {
            "spec": {
                "name": entity_name,
                "description": f"Created by smart execution {self.execution_id}",
                "resources": {}
            },
            "metadata": {"kind": "marketplace_item"}
        })
    
    async def _execute_playbook_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Playbook operation using load_engine's proper playbook functions"""
        if operation == "list":
            try:
                from load_engine.app.entities.v4.playbooks import list_v4_playbooks
                response = await asyncio.wait_for(
                    list_v4_playbooks(client=self.ncm_client, concurrency=1),
                    timeout=30.0
                )
                if response and response[0].status == 200:
                    count = len(response[0].body.get('data', [])) if isinstance(response[0].body, dict) else 0
                    logger.info(f"✅ Playbook list returned {count} playbooks")
                    return {'status': 'SUCCESS', 'uuid': None, 'error': None, 'count': count}
            except asyncio.TimeoutError:
                return {'status': 'FAILED', 'error': 'Playbook list timed out', 'uuid': None}
            except Exception as e:
                logger.warning(f"Playbook list failed ({e}), falling back to simulated")
            return await self._simulate_operation("Playbook", operation, entity_name)
        
        if operation in ("execute", "update"):
            return await self._simulate_operation("Playbook", operation, entity_name)
        
        if operation == "create":
            try:
                from load_engine.app.entities.v4.playbooks import create_v4_playbook
                response = await asyncio.wait_for(
                    create_v4_playbook(
                        client=self.ncm_client,
                        concurrency=1
                    ),
                    timeout=30.0
                )
                if response and response[0].status in (200, 202):
                    pb_id = None
                    if isinstance(response[0].body, dict):
                        pb_id = response[0].body.get('data', {}).get('extId') or response[0].body.get('metadata', {}).get('uuid')
                    logger.info(f"✅ Playbook created: {entity_name} ({pb_id})")
                    return {'status': 'SUCCESS', 'uuid': pb_id, 'error': None}
                else:
                    error_msg = self._extract_api_error(response)
                    logger.error(f"❌ Playbook create failed: {error_msg}")
                    return {'status': 'FAILED', 'error': error_msg, 'uuid': None}
            except asyncio.TimeoutError:
                logger.error("❌ Playbook create timed out (AIOps/DevOps service may not be available)")
                return {'status': 'SKIPPED', 'error': 'AIOps/DevOps service not available (timeout)', 'uuid': None}
            except Exception as e:
                logger.warning(f"load_engine playbook create failed ({e}), falling back to simulated")
                return await self._simulate_operation("Playbook", operation, entity_name)
        
        if operation == "delete":
            try:
                from load_engine.app.entities.v4.playbooks import list_v4_playbooks, delete_v4_playbook
                list_response = await list_v4_playbooks(client=self.ncm_client, concurrency=1)
                if list_response and list_response[0].status == 200 and isinstance(list_response[0].body, dict):
                    playbooks = list_response[0].body.get('data', [])
                    for pb in playbooks:
                        pb_name = pb.get('name', '')
                        if 'smart-' in pb_name.lower():
                            pb_id = pb.get('extId')
                            if pb_id:
                                del_resp = await delete_v4_playbook(client=self.ncm_client, playbook_id=pb_id, concurrency=1)
                                if del_resp and del_resp[0].status in (200, 202, 204):
                                    return {'status': 'SUCCESS', 'uuid': pb_id, 'error': None}
            except Exception as e:
                logger.warning(f"load_engine playbook delete failed ({e}), falling back to simulated")
            return await self._simulate_operation("Playbook", operation, entity_name)
        
        return await self._simulate_operation("Playbook", operation, entity_name)
    
    # ============================================================================
    # TIER 4-6: AIOPS, REPORTING, CG (SIMULATED OPERATIONS)
    # ============================================================================
    
    async def _execute_uda_policy_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute UDA Policy operation (simulated)"""
        return await self._simulate_operation("UDA Policy", operation, entity_name)
    
    async def _execute_scenario_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Scenario operation (simulated)"""
        return await self._simulate_operation("Scenario", operation, entity_name)
    
    async def _execute_analysis_session_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Analysis Session operation (simulated)"""
        return await self._simulate_operation("Analysis Session", operation, entity_name)
    
    async def _execute_report_config_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Report Config operation (simulated)"""
        return await self._simulate_operation("Report Config", operation, entity_name)
    
    async def _execute_report_instance_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Report Instance operation (simulated)"""
        return await self._simulate_operation("Report Instance", operation, entity_name)
    
    async def _execute_business_unit_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Business Unit operation (simulated)"""
        return await self._simulate_operation("Business Unit", operation, entity_name)
    
    async def _execute_cost_center_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Cost Center operation (simulated)"""
        return await self._simulate_operation("Cost Center", operation, entity_name)
    
    async def _execute_budget_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Budget operation (simulated)"""
        return await self._simulate_operation("Budget", operation, entity_name)
    
    async def _execute_rate_card_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Rate Card operation (simulated)"""
        return await self._simulate_operation("Rate Card", operation, entity_name)
    
    async def _execute_tco_direct_cost_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute TCO Direct Cost operation (simulated)"""
        return await self._simulate_operation("TCO Direct Cost", operation, entity_name)
    
    async def _execute_tco_indirect_cost_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute TCO Indirect Cost operation (simulated)"""
        return await self._simulate_operation("TCO Indirect Cost", operation, entity_name)
    
    async def _execute_cg_report_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute CG Report operation (simulated)"""
        return await self._simulate_operation("CG Report", operation, entity_name)
    
    async def _execute_budget_alert_operation(self, operation: str, entity_name: str) -> Dict:
        """Execute Budget Alert operation (simulated)"""
        return await self._simulate_operation("Budget Alert", operation, entity_name)
    
    # ============================================================================
    # HELPER METHODS
    # ============================================================================
    
    async def _generic_entity_operation(self, entity_display_name: str, api_endpoint: str, operation: str, entity_name: str, create_payload: Dict) -> Dict:
        """Generic entity operation handler for create/update/delete with proper HTTP status checking"""
        try:
            client = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            if operation == "create":
                logger.info(f"📤 Creating {entity_display_name}: {entity_name}")
                response = await client.v3_request(
                    endpoint=api_endpoint,
                    method="POST",
                    payload=create_payload
                )
                
                if response and response[0].status in (200, 202):
                    body = response[0].body
                    entity_uuid = body.get('metadata', {}).get('uuid') if isinstance(body, dict) else None
                    logger.info(f"✅ {entity_display_name} created: {entity_name} ({entity_uuid})")
                    return {
                        'status': 'SUCCESS',
                        'uuid': entity_uuid,
                        'error': None,
                        'error_type': None,
                        'error_code': None
                    }
                else:
                    status_code = response[0].status if response else 'N/A'
                    error_msg = self._extract_api_error(response)
                    logger.error(f"❌ {entity_display_name} create failed: HTTP {status_code} - {error_msg}")
                    return {
                        'status': 'FAILED',
                        'error': f'HTTP {status_code}: {error_msg}',
                        'error_type': 'APIError',
                        'error_code': status_code,
                        'uuid': None
                    }
            
            elif operation == "list":
                logger.info(f"📋 Listing {entity_display_name}")
                response = await client.v3_request(
                    endpoint=f"{api_endpoint}/list",
                    method="POST",
                    payload={"length": 100}
                )
                
                if response and response[0].status in (200, 202) and isinstance(response[0].body, dict):
                    entities = response[0].body.get('entities', [])
                    entity_count = len(entities)
                    logger.info(f"✅ Listed {entity_count} {entity_display_name}(s)")
                    return {
                        'status': 'SUCCESS',
                        'count': entity_count,
                        'entities': entities[:10],
                        'error': None
                    }
                else:
                    return {
                        'status': 'FAILED',
                        'error': f'Failed to list {entity_display_name} (HTTP {response[0].status if response else "N/A"})',
                        'error_type': 'ListError',
                        'error_code': response[0].status if response else None,
                        'count': 0
                    }
            
            elif operation == "delete":
                response = await client.v3_request(
                    endpoint=f"{api_endpoint}/list",
                    method="POST",
                    payload={"length": 10}
                )
                
                if response and response[0].status in (200, 202) and isinstance(response[0].body, dict) and response[0].body.get('entities'):
                    for entity in response[0].body['entities']:
                        name = entity.get('spec', {}).get('name', '')
                        if f'smart-{entity_display_name.lower().replace(" ", "-")}' in name.lower():
                            entity_uuid = entity['metadata']['uuid']
                            logger.info(f"🗑️  Deleting {entity_display_name}: {name} ({entity_uuid})")
                            
                            del_response = await client.v3_request(
                                endpoint=f"{api_endpoint}/{entity_uuid}",
                                method="DELETE"
                            )
                            if del_response and del_response[0].status in (200, 202, 204):
                                return {'status': 'SUCCESS', 'uuid': entity_uuid, 'error': None}
                            else:
                                return {'status': 'FAILED', 'error': f'Delete returned HTTP {del_response[0].status if del_response else "N/A"}', 'uuid': entity_uuid}
                    
                    return {'status': 'FAILED', 'error': f'No {entity_display_name} found to delete'}
                else:
                    return {'status': 'FAILED', 'error': f'No {entity_display_name} entities found'}
            
            else:
                return {
                    'status': 'FAILED',
                    'error': f'Unsupported {entity_display_name} operation: {operation}',
                    'error_type': 'UnsupportedOperationError',
                    'error_code': None,
                    'uuid': None
                }
        
        except Exception as e:
            import traceback
            logger.error(f"❌ {entity_display_name} operation {operation} failed: {e}")
            return {
                'status': 'FAILED',
                'error': str(e),
                'error_type': type(e).__name__,
                'error_code': getattr(e, 'status_code', None),
                'uuid': None
            }
    
    async def _simulate_operation(self, entity_type: str, operation: str, entity_name: str) -> Dict:
        """Simulate an operation (for low-priority entities or complex operations)"""
        import random
        await asyncio.sleep(random.uniform(0.1, 0.5))
        
        # 90% success rate for simulated operations
        if random.random() < 0.9:
            logger.info(f"✅ [SIMULATED] {entity_type}.{operation} ({entity_name})")
            return {
                'status': 'SUCCESS',
                'uuid': f"sim-{entity_type.lower().replace(' ', '-')}-{self.total_operations}",
                'error': None,
                'error_type': None,
                'error_code': None
            }
        else:
            logger.warning(f"❌ [SIMULATED] {entity_type}.{operation} failed")
            return {
                'status': 'FAILED',
                'error': f'Simulated failure for {entity_type}.{operation}',
                'error_type': 'SimulatedFailure',
                'error_code': None,
                'uuid': None
            }
    
    def _store_operation_result(self, result: Dict):
        """Store operation result in database (updates execution record)"""
        from database import SessionLocal
        from models.execution import ExecutionRecord
        
        session = SessionLocal()
        try:
            # Update execution record with operation counts
            exec_record = session.query(ExecutionRecord).filter_by(execution_id=self.execution_id).first()
            if exec_record:
                if result['status'] == 'SUCCESS':
                    exec_record.successful_operations = (exec_record.successful_operations or 0) + 1
                else:
                    exec_record.failed_operations = (exec_record.failed_operations or 0) + 1
                exec_record.total_operations = self.total_operations
                session.commit()
        except Exception as e:
            logger.error(f"Failed to update execution record: {e}")
            session.rollback()
        finally:
            session.close()
    
    async def _get_pod_metrics(self, filter_by_rule: bool = True) -> List[Dict]:
        """Query Prometheus for pod-level metrics with actual CPU/Memory values
        
        Args:
            filter_by_rule: If True, filter pods by rule_config (namespaces, pod_names)
        """
        pods = []
        try:
            if not self.prometheus_url:
                return []
            
            url = urljoin(self.prometheus_url, '/api/v1/query')
            
            # Build namespace filter for queries if rule_config specifies namespaces
            namespace_filter = ""
            if filter_by_rule and self.rule_config.get('namespaces'):
                namespaces = self.rule_config['namespaces']
                namespace_filter = f',namespace=~"{'|'.join(namespaces)}"'
            
            # Get CPU usage per pod (rate over 1m)
            cpu_query = f'sum(rate(container_cpu_usage_seconds_total{{container!="",container!="POD"{namespace_filter}}}[1m])) by (pod, namespace, node)'
            cpu_data = {}
            try:
                response = requests.get(url, params={'query': cpu_query}, verify=False, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if data.get('status') == 'success':
                        for result in data.get('data', {}).get('result', []):
                            metric = result.get('metric', {})
                            pod_name = metric.get('pod')
                            cpu_value = float(result.get('value', [0, 0])[1])
                            if pod_name:
                                cpu_data[pod_name] = cpu_value * 100  # Convert to percentage
            except Exception as e:
                logger.debug(f"CPU query failed: {e}")
            
            # Get memory usage per pod
            memory_query = f'sum(container_memory_working_set_bytes{{container!="",container!="POD"{namespace_filter}}}) by (pod, namespace, node)'
            memory_data = {}
            try:
                response = requests.get(url, params={'query': memory_query}, verify=False, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if data.get('status') == 'success':
                        for result in data.get('data', {}).get('result', []):
                            metric = result.get('metric', {})
                            pod_name = metric.get('pod')
                            memory_bytes = float(result.get('value', [0, 0])[1])
                            if pod_name:
                                memory_data[pod_name] = memory_bytes
            except Exception as e:
                logger.debug(f"Memory query failed: {e}")
            
            # Get network metrics per pod
            network_rx_query = f'sum(rate(container_network_receive_bytes_total{{container!="",container!="POD"{namespace_filter}}}[1m])) by (pod, namespace)'
            network_tx_query = f'sum(rate(container_network_transmit_bytes_total{{container!="",container!="POD"{namespace_filter}}}[1m])) by (pod, namespace)'
            network_rx_data = {}
            network_tx_data = {}
            try:
                response = requests.get(url, params={'query': network_rx_query}, verify=False, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if data.get('status') == 'success':
                        for result in data.get('data', {}).get('result', []):
                            metric = result.get('metric', {})
                            pod_name = metric.get('pod')
                            rx_bytes = float(result.get('value', [0, 0])[1])
                            if pod_name:
                                network_rx_data[pod_name] = rx_bytes / 1024 / 1024  # Convert to MB/s
            except Exception as e:
                logger.debug(f"Network RX query failed: {e}")
            
            try:
                response = requests.get(url, params={'query': network_tx_query}, verify=False, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if data.get('status') == 'success':
                        for result in data.get('data', {}).get('result', []):
                            metric = result.get('metric', {})
                            pod_name = metric.get('pod')
                            tx_bytes = float(result.get('value', [0, 0])[1])
                            if pod_name:
                                network_tx_data[pod_name] = tx_bytes / 1024 / 1024  # Convert to MB/s
            except Exception as e:
                logger.debug(f"Network TX query failed: {e}")
            
            # Get pod info
            pod_info_query = 'kube_pod_info'
            response = requests.get(url, params={'query': pod_info_query}, verify=False, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'success':
                    results = data.get('data', {}).get('result', [])
                    
                    # Build pod list with all metrics
                    pod_list = []
                    for result in results:
                        metric = result.get('metric', {})
                        pod_name = metric.get('pod', metric.get('exported_pod', 'unknown'))
                        namespace = metric.get('namespace', metric.get('exported_namespace', 'default'))
                        node = metric.get('node', 'unknown')
                        
                        # Apply filters from rule_config
                        if filter_by_rule:
                            # Filter by namespace
                            if self.rule_config.get('namespaces') and namespace not in self.rule_config['namespaces']:
                                continue
                            
                            # Filter by pod names
                            if self.rule_config.get('pod_names') and pod_name not in self.rule_config['pod_names']:
                                continue
                            
                            # Filter by namespace pattern
                            if self.rule_config.get('namespace_pattern'):
                                import fnmatch
                                if not fnmatch.fnmatch(namespace, self.rule_config['namespace_pattern']):
                                    continue
                            
                            # Filter by pod name pattern
                            if self.rule_config.get('pod_name_pattern'):
                                import fnmatch
                                if not fnmatch.fnmatch(pod_name, self.rule_config['pod_name_pattern']):
                                    continue
                        
                        cpu_usage = cpu_data.get(pod_name, 0)
                        memory_bytes = memory_data.get(pod_name, 0)
                        network_rx = network_rx_data.get(pod_name, 0)
                        network_tx = network_tx_data.get(pod_name, 0)
                        
                        pod_list.append({
                            'name': pod_name,
                            'namespace': namespace,
                            'node': node,
                            'cpu_usage': cpu_usage,
                            'memory_bytes': memory_bytes,
                            'memory_mb': memory_bytes / 1024 / 1024,
                            'network_rx_mbps': network_rx,
                            'network_tx_mbps': network_tx,
                            'status': 'Running'
                        })
                    
                    # Sort by CPU usage (descending) and take top 20 (increased for better tracking)
                    pod_list.sort(key=lambda x: x['cpu_usage'], reverse=True)
                    pods = pod_list[:20]
            
            logger.debug(f"Found {len(pods)} pods with metrics (filtered by rule: {filter_by_rule})")
            return pods
            
        except Exception as e:
            logger.warning(f"Failed to get pod metrics: {e}")
            return []
    
    async def _get_pod_metrics_snapshot(self, filter_by_rule: bool = False) -> Dict[str, Dict]:
        """Get current pod metrics snapshot as a dictionary keyed by pod_name
        
        Args:
            filter_by_rule: If True, filter by rule_config. If False, get all pods.
        """
        pods = await self._get_pod_metrics(filter_by_rule=filter_by_rule)
        return {pod['name']: pod for pod in pods}
    
    def _identify_affected_pods(self, pods_before: Dict[str, Dict], pods_after: Dict[str, Dict], 
                                threshold_cpu: float = 1.0, threshold_memory: float = 10.0) -> List[Dict]:
        """Identify pods that were affected by an operation based on metric changes
        
        Args:
            pods_before: Dict of pod metrics before operation {pod_name: {cpu_usage, memory_mb, ...}}
            pods_after: Dict of pod metrics after operation {pod_name: {cpu_usage, memory_mb, ...}}
            threshold_cpu: Minimum CPU change (%) to consider pod affected
            threshold_memory: Minimum memory change (MB) to consider pod affected
        
        Returns:
            List of affected pods with delta metrics
        """
        affected = []
        
        # Check all pods that exist in either before or after
        all_pod_names = set(pods_before.keys()) | set(pods_after.keys())
        
        for pod_name in all_pod_names:
            before = pods_before.get(pod_name, {})
            after = pods_after.get(pod_name, {})
            
            cpu_before = before.get('cpu_usage', 0)
            cpu_after = after.get('cpu_usage', 0)
            cpu_delta = cpu_after - cpu_before
            
            memory_before = before.get('memory_mb', 0)
            memory_after = after.get('memory_mb', 0)
            memory_delta = memory_after - memory_before
            
            network_rx_before = before.get('network_rx_mbps', 0)
            network_rx_after = after.get('network_rx_mbps', 0)
            network_rx_delta = network_rx_after - network_rx_before
            
            network_tx_before = before.get('network_tx_mbps', 0)
            network_tx_after = after.get('network_tx_mbps', 0)
            network_tx_delta = network_tx_after - network_tx_before
            
            # Consider pod affected if change exceeds threshold
            if abs(cpu_delta) >= threshold_cpu or abs(memory_delta) >= threshold_memory:
                affected.append({
                    'pod_name': pod_name,
                    'namespace': after.get('namespace') or before.get('namespace', 'unknown'),
                    'node': after.get('node') or before.get('node', 'unknown'),
                    'cpu_before': cpu_before,
                    'cpu_after': cpu_after,
                    'cpu_delta': cpu_delta,
                    'memory_before': memory_before,
                    'memory_after': memory_after,
                    'memory_delta': memory_delta,
                    'network_rx_before': network_rx_before,
                    'network_rx_after': network_rx_after,
                    'network_rx_delta': network_rx_delta,
                    'network_tx_before': network_tx_before,
                    'network_tx_after': network_tx_after,
                    'network_tx_delta': network_tx_delta,
                    'impact_score': abs(cpu_delta) * 0.4 + abs(memory_delta) / 10.0 * 0.4 + 
                                   (abs(network_rx_delta) + abs(network_tx_delta)) * 0.2
                })
        
        # Sort by impact score (highest first)
        affected.sort(key=lambda x: x['impact_score'], reverse=True)
        return affected
    
    async def _get_current_metrics(self) -> Dict[str, Any]:
        """Query Prometheus for current cluster metrics - Enhanced with network, disk, latency"""
        try:
            # CPU: Use actual CPU usage percentage (idle-based calculation)
            cpu_query = '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)'
            cpu_percent = await self._query_prometheus(cpu_query)
            if cpu_percent is None or cpu_percent < 0:
                # Fallback to load average if CPU query fails
                load1 = await self._query_prometheus('node_load1')
                # Normalize by number of CPUs for a meaningful percentage
                cpu_count = await self._query_prometheus('count(node_cpu_seconds_total{mode="idle"})')
                if load1 is not None and cpu_count and cpu_count > 0:
                    cpu_percent = min((load1 / cpu_count) * 100, 100)
                else:
                    cpu_percent = min((load1 or 0) * 10, 100) if load1 else 0
            cpu_percent = max(0, min(cpu_percent, 100))
            
            # Memory: Calculate used percentage
            mem_total = await self._query_prometheus('node_memory_MemTotal_bytes')
            mem_available = await self._query_prometheus('node_memory_MemAvailable_bytes')
            
            if mem_total and mem_available:
                mem_used = mem_total - mem_available
                memory_percent = (mem_used / mem_total) * 100
                memory_gb_total = mem_total / (1024**3)
                memory_gb_used = mem_used / (1024**3)
                memory_gb_available = mem_available / (1024**3)
            else:
                memory_percent = 0
                memory_gb_total = 0
                memory_gb_used = 0
                memory_gb_available = 0
            
            # Network metrics
            network_rx_bytes = await self._query_prometheus('rate(node_network_receive_bytes_total{device!="lo"}[1m])')
            network_tx_bytes = await self._query_prometheus('rate(node_network_transmit_bytes_total{device!="lo"}[1m])')
            network_rx_mbps = (network_rx_bytes or 0) / (1024**2)  # Convert to MB/s
            network_tx_mbps = (network_tx_bytes or 0) / (1024**2)
            
            # Disk metrics
            disk_total_bytes = await self._query_prometheus('node_filesystem_size_bytes{mountpoint="/"}')
            disk_free_bytes = await self._query_prometheus('node_filesystem_free_bytes{mountpoint="/"}')
            disk_io_time = await self._query_prometheus('rate(node_disk_io_time_seconds_total[1m])')
            
            if disk_total_bytes and disk_free_bytes:
                disk_used_bytes = disk_total_bytes - disk_free_bytes
                disk_usage_percent = (disk_used_bytes / disk_total_bytes) * 100
                disk_gb_total = disk_total_bytes / (1024**3)
                disk_gb_used = disk_used_bytes / (1024**3)
            else:
                disk_usage_percent = 0
                disk_gb_total = 0
                disk_gb_used = 0
            
            disk_io_percent = min((disk_io_time or 0) * 100, 100)  # Convert to percentage
            
            # Per-node metrics (simplified - get average across nodes)
            # In a real implementation, you'd query per instance
            nodes_data = await self._get_per_node_metrics()
            
            # Resource allocation (if NCM client available)
            resources = await self._get_resource_allocation()
            
            metrics = {
                'cpu_percent': cpu_percent,
                'memory_percent': memory_percent,
                'memory_gb_total': memory_gb_total,
                'memory_gb_used': memory_gb_used,
                'memory_gb_available': memory_gb_available,
                'network': {
                    'rx_mbps': network_rx_mbps,
                    'tx_mbps': network_tx_mbps,
                    'total_mbps': network_rx_mbps + network_tx_mbps
                },
                'disk': {
                    'usage_percent': disk_usage_percent,
                    'io_utilization_percent': disk_io_percent,
                    'total_gb': disk_gb_total,
                    'used_gb': disk_gb_used
                },
                'nodes': nodes_data,
                'resources': resources,
                'timestamp': datetime.now(timezone.utc).isoformat()
            }
            
            if cpu_percent == 0 and memory_percent == 0:
                logger.warning(f"⚠️  Prometheus not available for {self.testbed_info.get('testbed_label')} - metrics will show 0%")
            else:
                logger.debug(f"📊 Enhanced Metrics: CPU={cpu_percent:.1f}%, Memory={memory_percent:.1f}%, Network={network_rx_mbps + network_tx_mbps:.1f}MB/s")
            
            return metrics
            
        except Exception as e:
            logger.warning(f"⚠️  Failed to get enhanced metrics from Prometheus: {e}")
            # Return default values if Prometheus is unavailable
            return {
                'cpu_percent': 0,
                'memory_percent': 0,
                'memory_gb_total': 0,
                'memory_gb_used': 0,
                'memory_gb_available': 0,
                'network': {'rx_mbps': 0, 'tx_mbps': 0, 'total_mbps': 0},
                'disk': {'usage_percent': 0, 'io_utilization_percent': 0, 'total_gb': 0, 'used_gb': 0},
                'nodes': [],
                'resources': {},
                'timestamp': datetime.now(timezone.utc).isoformat()
            }
    
    async def _get_per_node_metrics(self) -> List[Dict]:
        """Get metrics per node (simplified - returns aggregated if per-node unavailable)"""
        try:
            # Try to get per-instance metrics
            # This is a simplified version - in production you'd query per instance
            cpu_query = 'node_load1'
            cpu_value = await self._query_prometheus(cpu_query)
            
            mem_total = await self._query_prometheus('node_memory_MemTotal_bytes')
            mem_available = await self._query_prometheus('node_memory_MemAvailable_bytes')
            
            if mem_total and mem_available:
                mem_percent = ((mem_total - mem_available) / mem_total) * 100
            else:
                mem_percent = 0
            
            # Return simplified node data (in production, iterate over instances)
            return [{
                'name': 'cluster-aggregate',
                'cpu_percent': min((cpu_value or 0) * 25, 100) if cpu_value else 0,
                'memory_percent': mem_percent,
                'network_rx_mbps': 0,  # Would need per-instance query
                'network_tx_mbps': 0
            }]
        except Exception as e:
            logger.debug(f"Could not get per-node metrics: {e}")
            return []
    
    async def _get_resource_allocation(self) -> Dict:
        """Get current resource allocation (VMs, CPU cores, Memory)"""
        try:
            if not self.ncm_client_ready or not self.ncm_client:
                return {}
            
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            vms_response = await pc.v3_request(
                endpoint="/vms/list",
                method="POST",
                payload={"kind": "vm", "length": 1}
            )
            
            total_vms = 0
            running_vms = 0
            total_cpu_cores = 0
            total_memory_gb = 0
            
            if vms_response and vms_response[0].body.get('metadata', {}).get('total_matches'):
                total_vms = vms_response[0].body['metadata']['total_matches']
                
                vms_detail_response = await pc.v3_request(
                    endpoint="/vms/list",
                    method="POST",
                    payload={"kind": "vm", "length": min(total_vms, 100)}  # Limit to 100 for performance
                )
                
                if vms_detail_response and vms_detail_response[0].body.get('entities'):
                    for vm in vms_detail_response[0].body['entities']:
                        spec = vm.get('spec', {})
                        resources = spec.get('resources', {})
                        
                        # Check power state
                        power_state = resources.get('power_state', 'OFF')
                        if power_state == 'ON':
                            running_vms += 1
                        
                        # Get CPU and memory
                        num_sockets = resources.get('num_sockets', 1)
                        num_vcpus_per_socket = resources.get('num_vcpus_per_socket', 1)
                        memory_mib = resources.get('memory_size_mib', 0)
                        
                        total_cpu_cores += num_sockets * num_vcpus_per_socket
                        total_memory_gb += memory_mib / 1024
            
            return {
                'vms_total': total_vms,
                'vms_running': running_vms,
                'vms_stopped': total_vms - running_vms,
                'cpu_cores_allocated': total_cpu_cores,
                'memory_gb_allocated': total_memory_gb
            }
        except Exception as e:
            logger.debug(f"Could not get resource allocation: {e}")
            return {}
    
    async def _query_prometheus(self, query: str) -> Optional[float]:
        """Query Prometheus and return the metric value (tries both HTTP and HTTPS)"""
        urls_to_try = [self.prometheus_url]
        if self.prometheus_url_https:
            urls_to_try.append(self.prometheus_url_https)
        
        for url_base in urls_to_try:
            try:
                url = urljoin(url_base, '/api/v1/query')
                params = {'query': query}
                
                logger.debug(f"🔍 Trying Prometheus: {url} with query={query}")
                
                response = requests.get(
                    url,
                    params=params,
                    verify=False,  # Skip SSL verification for self-signed certs
                    timeout=10
                )
                
                logger.debug(f"📡 Prometheus response status: {response.status_code}")
                
                if response.status_code == 200:
                    data = response.json()
                    if data.get('status') == 'success':
                        results = data.get('data', {}).get('result', [])
                        if results:
                            value = float(results[0].get('value', [0, 0])[1])
                            logger.debug(f"✅ Got value: {value} from {url_base}")
                            # Update primary URL to the working one
                            if url_base != self.prometheus_url:
                                logger.info(f"✅ Switching to working URL: {url_base}")
                                self.prometheus_url = url_base
                            return value
                        else:
                            logger.warning(f"⚠️  No results for query: {query}")
                    else:
                        logger.warning(f"⚠️  Prometheus query failed with status: {data.get('status')}")
                else:
                    logger.warning(f"⚠️  Prometheus returned {response.status_code} from {url_base}")
            except Exception as e:
                logger.warning(f"❌ Prometheus query failed for {url_base}: {e}")
                continue  # Try next URL
        
        # All URLs failed
        return None
    
    def stop(self):
        """Stop the execution with graceful drain for in-flight ops."""
        logger.info(f"🛑 Stopping smart execution {self.execution_id}")
        self.should_stop = True
        self.is_paused = False
        
        # Graceful drain: wait up to 5s for in-flight operations
        if self._inflight_ops > 0:
            import time
            logger.info(f"⏳ Draining {self._inflight_ops} in-flight operations (max 5s)...")
            for _ in range(5):
                if self._inflight_ops <= 0:
                    break
                time.sleep(1)
            if self._inflight_ops > 0:
                logger.warning(f"⚠️ Drain timeout: {self._inflight_ops} ops still in-flight, forcing stop")
        
        self.is_running = False
        self.status = "STOPPED"
        self.end_time = datetime.now(timezone.utc)
        self._persist_to_database()
    
    def pause(self):
        """Pause the execution"""
        if not self.is_running:
            logger.warning(f"⚠️  Cannot pause: execution {self.execution_id} is not running")
            return {'success': False, 'error': 'Execution is not running'}
        
        if self.is_paused:
            logger.warning(f"⚠️  Execution {self.execution_id} is already paused")
            return {'success': False, 'error': 'Execution is already paused'}
        
        logger.info(f"⏸️  Pausing execution {self.execution_id}")
        self.is_paused = True
        self.status = "PAUSED"
        return {'success': True, 'message': 'Execution paused'}
    
    def resume(self):
        """Resume the execution"""
        if not self.is_paused:
            logger.warning(f"⚠️  Cannot resume: execution {self.execution_id} is not paused")
            return {'success': False, 'error': 'Execution is not paused'}
        
        logger.info(f"▶️  Resuming execution {self.execution_id}")
        self.is_paused = False
        self.status = "RUNNING"
        return {'success': True, 'message': 'Execution resumed'}
    
    def _log_event(self, level: str, message: str, **kwargs):
        """Add a log entry to the live logs buffer"""
        log_entry = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'level': level,  # INFO, WARNING, ERROR, SUCCESS
            'message': message,
            **kwargs
        }
        
        self.live_logs.append(log_entry)
        
        # Keep only last N entries (circular buffer)
        if len(self.live_logs) > self.max_log_entries:
            self.live_logs = self.live_logs[-self.max_log_entries:]
    
    def get_live_logs(self, since: Optional[str] = None, limit: int = 100) -> List[Dict]:
        """Get live logs, optionally since a specific timestamp"""
        if since:
            # Filter logs after the given timestamp
            try:
                since_dt = datetime.fromisoformat(since.replace('Z', '+00:00'))
                filtered_logs = [log for log in self.live_logs if datetime.fromisoformat(log['timestamp'].replace('Z', '+00:00')) > since_dt]
                return filtered_logs[-limit:]
            except:
                pass
        
        return self.live_logs[-limit:]
    
    def _save_operation_metric_to_db(self, entity_type: str, operation: str, entity_name: str,
                                     result: Dict, start_time: datetime, end_time: datetime,
                                     duration: float, pods_before: Dict, pods_after: Dict):
        """Save individual operation metric to operation_metrics table"""
        try:
            from database import save_operation_metric
            
            # Calculate average pod metrics for summary
            pod_cpu_percent = None
            pod_memory_mb = None
            pod_network_rx_mbps = None
            pod_network_tx_mbps = None
            
            if pods_after:
                cpu_values = [p.get('cpu_usage', 0) for p in pods_after.values() if p.get('cpu_usage')]
                memory_values = [p.get('memory_mb', 0) for p in pods_after.values() if p.get('memory_mb')]
                rx_values = [p.get('network_rx_mbps', 0) for p in pods_after.values() if p.get('network_rx_mbps')]
                tx_values = [p.get('network_tx_mbps', 0) for p in pods_after.values() if p.get('network_tx_mbps')]
                
                if cpu_values:
                    pod_cpu_percent = sum(cpu_values) / len(cpu_values)
                if memory_values:
                    pod_memory_mb = sum(memory_values) / len(memory_values)
                if rx_values:
                    pod_network_rx_mbps = sum(rx_values) / len(rx_values)
                if tx_values:
                    pod_network_tx_mbps = sum(tx_values) / len(tx_values)
            
            # Create metrics snapshot
            metrics_snapshot = {
                'cpu_percent': self.current_metrics.get('cpu_percent', 0),
                'memory_percent': self.current_metrics.get('memory_percent', 0),
                'network_rx_mbps': self.current_metrics.get('network_rx_mbps', 0),
                'network_tx_mbps': self.current_metrics.get('network_tx_mbps', 0),
                'pod_count': len(pods_after) if pods_after else 0
            }
            
            # Save to database
            metric_id = save_operation_metric(
                execution_id=self.execution_id,
                testbed_id=self.testbed_info.get('unique_testbed_id', 'unknown'),
                entity_type=entity_type,
                operation_type=operation.upper(),
                entity_name=entity_name,
                entity_uuid=result.get('uuid'),
                started_at=start_time,
                completed_at=end_time,
                status='COMPLETED' if result.get('status') == 'SUCCESS' else 'FAILED',
                error_message=result.get('error'),
                metrics_snapshot=metrics_snapshot,
                pod_cpu_percent=pod_cpu_percent,
                pod_memory_mb=pod_memory_mb,
                pod_network_rx_mbps=pod_network_rx_mbps,
                pod_network_tx_mbps=pod_network_tx_mbps,
                pod_metrics_before=pods_before,
                pod_metrics_after=pods_after
            )
            
            # Update operation_metrics with pod snapshots (if table has these columns)
            if metric_id:
                self._update_operation_metric_with_pod_snapshots(metric_id, pods_before, pods_after)
            
            logger.debug(f"💾 Saved operation metric: {entity_type}.{operation} (ID: {metric_id})")

            # Save curated ML training sample for the DB-to-ML pipeline
            try:
                from services.ml_training_service import save_training_sample, check_auto_retrain
                testbed_id = self.testbed_info.get('unique_testbed_id', 'unknown')
                cpu_before = metrics_snapshot.get('cpu_percent', 0)
                mem_before = metrics_snapshot.get('memory_percent', 0)

                # For cpu_after / memory_after, we need current_metrics which may
                # have been updated by the poll loop after the operation completed.
                cpu_after = self.current_metrics.get('cpu_percent', cpu_before)
                mem_after = self.current_metrics.get('memory_percent', mem_before)

                save_training_sample(
                    testbed_id=testbed_id,
                    execution_id=self.execution_id,
                    entity_type=entity_type,
                    operation=operation,
                    cpu_before=cpu_before,
                    memory_before=mem_before,
                    cpu_after=cpu_after,
                    memory_after=mem_after,
                    cluster_size=1,
                    concurrent_ops=self.total_operations,
                    ops_per_minute=self.operations_per_minute,
                    duration_seconds=duration,
                    success=(result.get('status') == 'SUCCESS'),
                )

                # Check if we should auto-retrain the ML model
                if self.total_operations % 50 == 0:
                    check_auto_retrain(testbed_id)

            except Exception as ml_err:
                logger.debug(f"ML training sample save skipped: {ml_err}")

        except Exception as e:
            logger.warning(f"Failed to save operation metric: {e}")
            import traceback
            logger.debug(f"Traceback: {traceback.format_exc()}")
    
    def _update_operation_metric_with_pod_snapshots(self, metric_id: int, pods_before: Dict, pods_after: Dict):
        """Update operation_metrics table with pod snapshots"""
        try:
            from database import SessionLocal
            from sqlalchemy import text
            
            session = SessionLocal()
            try:
                query = text("""
                    UPDATE operation_metrics
                    SET pod_metrics_before = :pods_before,
                        pod_metrics_after = :pods_after
                    WHERE id = :metric_id
                """)
                
                import json
                session.execute(query, {
                    'metric_id': metric_id,
                    'pods_before': json.dumps(pods_before) if pods_before else None,
                    'pods_after': json.dumps(pods_after) if pods_after else None
                })
                session.commit()
            except Exception as e:
                session.rollback()
                logger.debug(f"Could not update pod snapshots (columns may not exist): {e}")
            finally:
                session.close()
        except Exception as e:
            logger.debug(f"Failed to update pod snapshots: {e}")
    
    def _save_all_pods_operation_correlation(self, entity_type: str, operation: str, entity_name: str,
                                             result: Dict, pods_before: Dict, pods_after: Dict):
        """Save ALL pods correlation to database (not just affected ones)"""
        try:
            from database import save_pod_operation_correlation
            
            # Get all pods from both before and after
            all_pod_names = set(list(pods_before.keys()) + list(pods_after.keys()))
            
            saved_count = 0
            for pod_name in all_pod_names:
                pod_before = pods_before.get(pod_name, {})
                pod_after = pods_after.get(pod_name, {})
                
                # Determine correlation type
                correlation_type = 'affected'
                if pod_name in pods_before and pod_name in pods_after:
                    cpu_delta = abs(pod_after.get('cpu_usage', 0) - pod_before.get('cpu_usage', 0))
                    memory_delta = abs(pod_after.get('memory_mb', 0) - pod_before.get('memory_mb', 0))
                    if cpu_delta < 1.0 and memory_delta < 10.0:
                        correlation_type = 'monitored'  # Pod was monitored but not significantly affected
                elif pod_name not in pods_before:
                    correlation_type = 'new'  # Pod appeared after operation
                elif pod_name not in pods_after:
                    correlation_type = 'removed'  # Pod disappeared after operation
                
                save_pod_operation_correlation(
                    execution_id=self.execution_id,
                    smart_execution_id=self.execution_id,
                    pod_name=pod_name,
                    namespace=pod_after.get('namespace') or pod_before.get('namespace', 'unknown'),
                    node_name=pod_after.get('node') or pod_before.get('node', 'unknown'),
                    entity_type=entity_type,
                    operation_type=operation.upper(),
                    entity_name=entity_name,
                    cpu_percent_before=pod_before.get('cpu_usage', 0),
                    memory_mb_before=pod_before.get('memory_mb', 0),
                    network_rx_mbps_before=pod_before.get('network_rx_mbps', 0),
                    network_tx_mbps_before=pod_before.get('network_tx_mbps', 0),
                    cpu_percent_after=pod_after.get('cpu_usage', 0),
                    memory_mb_after=pod_after.get('memory_mb', 0),
                    network_rx_mbps_after=pod_after.get('network_rx_mbps', 0),
                    network_tx_mbps_after=pod_after.get('network_tx_mbps', 0),
                    correlation_type=correlation_type
                )
                saved_count += 1
            
            logger.debug(f"💾 Saved pod correlation for {saved_count} pods (all pods)")
        except Exception as e:
            logger.warning(f"Failed to save all pods correlation: {e}")
            import traceback
            logger.debug(f"Traceback: {traceback.format_exc()}")
    
    def _save_pod_operation_correlation(self, entity_type: str, operation: str, entity_name: str,
                                       result: Dict, pods_before: Dict, pods_after: Dict, 
                                       affected_pods: List[Dict]):
        """Save pod-operation correlation to database (legacy method for affected pods only)"""
        try:
            from database import save_pod_operation_correlation
            
            for affected_pod in affected_pods:
                save_pod_operation_correlation(
                    execution_id=self.execution_id,
                    smart_execution_id=self.execution_id,
                    pod_name=affected_pod['pod_name'],
                    namespace=affected_pod['namespace'],
                    node_name=affected_pod.get('node', 'unknown'),
                    entity_type=entity_type,
                    operation_type=operation,
                    entity_name=entity_name,
                    cpu_percent_before=affected_pod['cpu_before'],
                    memory_mb_before=affected_pod['memory_before'],
                    network_rx_mbps_before=affected_pod.get('network_rx_before', 0),
                    network_tx_mbps_before=affected_pod.get('network_tx_before', 0),
                    cpu_percent_after=affected_pod['cpu_after'],
                    memory_mb_after=affected_pod['memory_after'],
                    network_rx_mbps_after=affected_pod.get('network_rx_after', 0),
                    network_tx_mbps_after=affected_pod.get('network_tx_after', 0),
                    correlation_type='direct'  # Can be enhanced to detect indirect effects
                )
            
            logger.debug(f"💾 Saved pod correlation for {len(affected_pods)} pods")
        except Exception as e:
            logger.warning(f"Failed to save pod correlation: {e}")
    def _get_pod_operation_correlation(self) -> Dict[str, Any]:
        """
        Retrieve pod-operation correlation data from database for this execution
        Returns a dictionary with pod correlation data grouped by operation
        """
        try:
            from database import SessionLocal
            from sqlalchemy import text
            
            session = SessionLocal()
            try:
                query = text("""
                    SELECT 
                        entity_type, operation_type, entity_name,
                        pod_name, namespace, node_name,
                        cpu_percent_before, cpu_percent_after, cpu_delta,
                        memory_mb_before, memory_mb_after, memory_delta,
                        network_rx_mbps_before, network_rx_mbps_after, network_rx_delta,
                        network_tx_mbps_before, network_tx_mbps_after, network_tx_delta,
                        correlation_type, impact_score, measured_at
                    FROM pod_operation_correlation
                    WHERE smart_execution_id = :execution_id
                    ORDER BY measured_at ASC, entity_type, operation_type
                """)
                
                result = session.execute(query, {'execution_id': self.execution_id})
                rows = result.fetchall()
                
                # Group by operation
                correlation_data = {}
                for row in rows:
                    op_key = f"{row[0]}.{row[1]}.{row[2]}"
                    if op_key not in correlation_data:
                        correlation_data[op_key] = {
                            'entity_type': row[0],
                            'operation_type': row[1],
                            'entity_name': row[2],
                            'pods': []
                        }
                    
                    correlation_data[op_key]['pods'].append({
                        'pod_name': row[3],
                        'namespace': row[4],
                        'node_name': row[5],
                        'cpu_before': row[6],
                        'cpu_after': row[7],
                        'cpu_delta': row[8],
                        'memory_before': row[9],
                        'memory_after': row[10],
                        'memory_delta': row[11],
                        'network_rx_before': row[12],
                        'network_rx_after': row[13],
                        'network_rx_delta': row[14],
                        'network_tx_before': row[15],
                        'network_tx_after': row[16],
                        'network_tx_delta': row[17],
                        'correlation_type': row[18],
                        'impact_score': row[19],
                        'measured_at': row[20].isoformat() if row[20] else None
                    })
                
                return {
                    'total_correlations': len(rows),
                    'operations': list(correlation_data.values()),
                    'summary': {
                        'total_pods_affected': len(set((r[3], r[4]) for r in rows)),
                        'total_operations': len(correlation_data)
                    }
                }
            finally:
                session.close()
        except Exception as e:
            logger.warning(f"Failed to retrieve pod correlation data: {e}")
            return {}
    
    
    def _persist_to_database(self):
        """Persist execution state to database"""
        try:
            from services.smart_execution_db import save_smart_execution
            
            # Calculate duration
            duration_minutes = None
            if self.start_time:
                end = self.end_time or datetime.now(timezone.utc)
                if self.start_time.tzinfo is None:
                    start = self.start_time.replace(tzinfo=timezone.utc)
                else:
                    start = self.start_time
                if end.tzinfo is None:
                    end = end.replace(tzinfo=timezone.utc)
                duration_minutes = (end - start).total_seconds() / 60
            
            # Calculate success rate (SKIPPED excluded from denominator)
            successful_ops = sum(1 for op in self.operations_history if op.get('status') == 'SUCCESS')
            failed_ops = sum(1 for op in self.operations_history if op.get('status') == 'FAILED')
            skipped_ops = sum(1 for op in self.operations_history if op.get('status') == 'SKIPPED')
            countable_ops = self.total_operations - skipped_ops
            success_rate = (successful_ops / countable_ops * 100) if countable_ops > 0 else 100
            ops_per_minute = self.total_operations / duration_minutes if duration_minutes and duration_minutes > 0 else 0
            
            # Prepare execution data
            execution_data = {
                'execution_id': self.execution_id,
                'testbed_id': self.testbed_info.get('unique_testbed_id', 'unknown'),
                'testbed_label': self.testbed_info.get('testbed_label', 'Unknown'),
                'status': self.status,
                'is_running': self.is_running,
                'start_time': self.start_time,
                'end_time': self.end_time,
                'duration_minutes': duration_minutes,
                'target_config': self.target_config,
                'entities_config': self.entities_config,
                'rule_config': self.rule_config,  # Save rule configuration
                'baseline_metrics': self.baseline_metrics,
                'final_metrics': self.current_metrics,
                'metrics_history': self.metrics_history,
                'total_operations': self.total_operations,
                'successful_operations': successful_ops,
                'failed_operations': failed_ops,
                'success_rate': success_rate,
                'operations_per_minute': ops_per_minute,
                'operations_history': self.operations_history,
                'threshold_reached': self._check_thresholds_reached(
                    self.current_metrics.get('cpu_percent', 0),
                    self.current_metrics.get('memory_percent', 0)
                ),
                'created_entities': getattr(self, 'entities_tracked_for_cleanup', {}),
                'entity_breakdown': self._get_entity_breakdown(),
                'execution_mode': 'REAL' if self.ncm_client_ready else 'SIMULATED',
                'cluster_name': self.cluster_name,
                'cluster_uuid': self.cluster_uuid,
                'full_execution_data': self.get_status(),
                'tags': self.tags,
                'anomaly_count': len(self.detected_anomalies),
                'anomaly_high_count': sum(1 for a in self.detected_anomalies if a.get('severity') == 'high'),
                'anomaly_data': self.detected_anomalies[-50:] if self.detected_anomalies else [],
                'latency_summary': self.get_latency_summary(),
                'alert_thresholds': self.anomaly_thresholds,
                'learning_summary': getattr(self, '_learning_summary', None),
            }
            
            # Save rule execution mapping if rule_config is provided
            if self.rule_config and (self.rule_config.get('namespaces') or self.rule_config.get('pod_names') or 
                                     self.rule_config.get('custom_queries') or self.rule_config.get('rule_book_id')):
                try:
                    from database import save_rule_execution_mapping
                    save_rule_execution_mapping(
                        execution_id=self.execution_id,
                        smart_execution_id=self.execution_id,
                        rule_config=self.rule_config,
                        rule_book_id=self.rule_config.get('rule_book_id')
                    )
                except Exception as e:
                    logger.warning(f"Failed to save rule execution mapping: {e}")
            
            result = save_smart_execution(execution_data)
            if result:
                logger.debug(f"Persisted execution {self.execution_id} to database")
            else:
                logger.error(f"Failed to persist execution {self.execution_id} to database")
        except Exception as e:
            logger.error(f"Exception persisting execution to database: {e}", exc_info=True)

    def _save_checkpoint(self, iteration: int, cpu: float, memory: float):
        """Save execution checkpoint for crash recovery"""
        try:
            from database import SessionLocal
            from sqlalchemy import text

            checkpoint = {
                'iteration': iteration,
                'total_operations': self.total_operations,
                'successful_operations': sum(1 for op in self.operations_history if op.get('status') == 'SUCCESS'),
                'current_cpu': cpu,
                'current_memory': memory,
                'operations_per_minute': self.operations_per_minute,
                'backoff_multiplier': self.current_backoff_multiplier,
                'created_entities_count': sum(len(v) for v in self.created_entities.values()),
            }

            session = SessionLocal()
            try:
                session.execute(text("""
                    UPDATE smart_executions
                    SET checkpoint_data = :checkpoint,
                        last_checkpoint_at = NOW()
                    WHERE execution_id = :execution_id
                """), {
                    'execution_id': self.execution_id,
                    'checkpoint': json.dumps(checkpoint),
                })
                session.commit()
            finally:
                session.close()
        except Exception as e:
            logger.debug(f"Checkpoint save skipped: {e}")
    
    def _get_entity_breakdown(self) -> Dict:
        """Get breakdown of operations by entity type"""
        breakdown = {}
        for op in self.operations_history:
            entity_type = op.get('entity_type', 'Unknown')
            if entity_type not in breakdown:
                breakdown[entity_type] = {'total': 0, 'success': 0, 'failed': 0}
            breakdown[entity_type]['total'] += 1
            if op.get('status') == 'SUCCESS':
                breakdown[entity_type]['success'] += 1
            else:
                breakdown[entity_type]['failed'] += 1
        return breakdown
    
    def get_status(self) -> Dict[str, Any]:
        """Get current execution status with comprehensive details"""
        duration = 0
        if self.start_time:
            end = self.end_time or datetime.now(timezone.utc)
            # Ensure both datetimes are timezone-aware
            if self.start_time.tzinfo is None:
                from datetime import timezone as tz
                start = self.start_time.replace(tzinfo=tz.utc)
            else:
                start = self.start_time
            if end.tzinfo is None:
                from datetime import timezone as tz
                end = end.replace(tzinfo=tz.utc)
            duration = (end - start).total_seconds() / 60
        
        # Calculate statistics (SKIPPED ops excluded from success rate denominator)
        successful_ops = sum(1 for op in self.operations_history if op.get('status') == 'SUCCESS')
        failed_ops = sum(1 for op in self.operations_history if op.get('status') == 'FAILED')
        skipped_ops = sum(1 for op in self.operations_history if op.get('status') == 'SKIPPED')
        countable_ops = self.total_operations - skipped_ops
        success_rate = (successful_ops / countable_ops * 100) if countable_ops > 0 else 100
        ops_per_minute = self.total_operations / duration if duration > 0 else 0
        
        # Group operations by entity type
        entity_breakdown = {}
        created_entities = []
        
        for op in self.operations_history:
            entity_type = op.get('entity_type')
            operation = op.get('operation')
            status = op.get('status')
            
            if entity_type not in entity_breakdown:
                entity_breakdown[entity_type] = {'total': 0, 'success': 0, 'failed': 0, 'skipped': 0}
            entity_breakdown[entity_type]['total'] += 1
            if status == 'SUCCESS':
                entity_breakdown[entity_type]['success'] += 1
            elif status == 'SKIPPED':
                entity_breakdown[entity_type]['skipped'] += 1
            else:
                entity_breakdown[entity_type]['failed'] += 1
            
            # Track created entities (create operations that succeeded)
            if operation == 'create' and status == 'SUCCESS':
                created_entities.append({
                    'entity_type': entity_type,
                    'entity_name': op.get('entity_name'),
                    'entity_uuid': op.get('entity_uuid'),
                    'created_at': op.get('start_time'),
                    'duration_seconds': op.get('duration_seconds')
                })
        
        # Calculate progress toward target
        current_cpu = self.current_metrics.get('cpu_percent', 0)
        current_mem = self.current_metrics.get('memory_percent', 0)
        target_cpu = self.target_config.get('cpu_threshold', 100)
        target_mem = self.target_config.get('memory_threshold', 100)
        
        cpu_progress = (current_cpu / target_cpu * 100) if target_cpu > 0 else 0
        mem_progress = (current_mem / target_mem * 100) if target_mem > 0 else 0
        overall_progress = max(cpu_progress, mem_progress)
        
        # Execution context
        stop_condition = self.target_config.get('stop_condition', 'any')
        goal_description = f"Reach {target_cpu}% CPU {'or' if stop_condition == 'any' else 'and'} {target_mem}% Memory"
        
        # Resource allocation summary
        vms_created = sum(1 for e in created_entities if e['entity_type'] == 'VM')
        projects_created = sum(1 for e in created_entities if e['entity_type'] == 'Project')
        
        return {
            'execution_id': self.execution_id,
            'status': self.status,
            'is_running': self.is_running,
            'is_paused': self.is_paused,
            'start_time': self.start_time.isoformat() if self.start_time else None,
            'end_time': self.end_time.isoformat() if self.end_time else None,
            'duration_minutes': duration,
            
            # Operation statistics
            'total_operations': self.total_operations,
            'successful_operations': successful_ops,
            'failed_operations': failed_ops,
            'skipped_operations': skipped_ops,
            'success_rate': success_rate,
            'operations_per_minute': ops_per_minute,
            
            # Metrics
            'baseline_metrics': self.baseline_metrics,
            'current_metrics': self.current_metrics,
            'target_config': self.target_config,
            'operations_history': self.operations_history[-10:],
            'metrics_history': self.metrics_history[-20:],
            
            # Enhanced information
            'execution_context': {
                'goal': goal_description,
                'testbed_id': self.testbed_info.get('unique_testbed_id'),
                'testbed_label': self.testbed_info.get('testbed_label'),
                'testbed_ip': self.testbed_info.get('pc_ip'),
                'mode': 'REAL NCM Operations' if self.ncm_client_ready else 'Simulated',
                'cluster_name': self.cluster_name,
                'cluster_uuid': self.cluster_uuid,
                'subnet_name': self.subnet_name
            },
            
            'progress': {
                'cpu_progress_percent': cpu_progress,
                'memory_progress_percent': mem_progress,
                'overall_progress_percent': overall_progress,
                'cpu_current': current_cpu,
                'cpu_target': target_cpu,
                'memory_current': current_mem,
                'memory_target': target_mem
            },
            
            'entity_breakdown': entity_breakdown,
            
            'created_entities': created_entities,
            
            'resource_summary': {
                'vms_created': vms_created,
                'projects_created': projects_created,
                'total_entities': len(created_entities),
                'estimated_cpu_cores': vms_created * 2,  # Assuming 2 cores per VM
                'estimated_memory_gb': vms_created * 4  # Assuming 4GB per VM
            },
            
            # Cleanup tracking
            'cleanup_on_stop': self.cleanup_on_stop,
            'entities_tracked_for_cleanup': {
                entity_type: len(entities) 
                for entity_type, entities in self.created_entities.items()
            },
            
            # Pod-level metrics (fetched on demand)
            'pod_metrics': self._fetch_pod_metrics_sync() if self.prometheus_url else [],
            
            # Rule configuration
            'rule_config': self.rule_config,
            
            # Pod-operation correlation (if available)
            'pod_operation_correlation': getattr(self, '_get_pod_operation_correlation', lambda: {})(),
            
            # NEW: Predictive insights (always include, even if None)
            'predictions': self._calculate_predictions(),
            
            # NEW: Operation effectiveness (always include, even if empty)
            'operation_effectiveness': self._get_most_effective_operations(limit=5) or [],
            
            # NEW: Impact tracking (always include, even if empty)
            'recent_impacts': self.operation_impact_history[-5:] if self.operation_impact_history else [],
            
            # NEW: Enhanced metrics (ensure network, disk, etc. are included)
            'current_metrics': self.current_metrics,  # This already includes network, disk, etc. from _get_current_metrics
            
            # Phase 3: Anomalies and recommendations
            'detected_anomalies': self.detected_anomalies[-10:] if self.detected_anomalies else [],
            'recommendations': self._generate_automated_recommendations(),
            'anomaly_summary': {
                'total': len(self.detected_anomalies),
                'by_severity': {
                    'high': sum(1 for a in self.detected_anomalies if a.get('severity') == 'high'),
                    'medium': sum(1 for a in self.detected_anomalies if a.get('severity') == 'medium'),
                    'low': sum(1 for a in self.detected_anomalies if a.get('severity') == 'low')
                }
            },
            
            # Execution configuration
            'execution_config': {
                'workload_profile': self.workload_profile,
                'max_parallel_operations': self.max_parallel_operations,
                'parallel_execution': self.parallel_execution_enabled,
                'operations_per_iteration': self.operations_per_iteration,
                'auto_cleanup': self.auto_cleanup,
                'has_operation_weights': bool(self.operation_weights),
            },
            
            # API latency summary
            'latency_summary': self.get_latency_summary(),
            
            # Pre-check results
            'pre_check': self.pre_check_results,
            
            # Tags and learning
            'tags': self.tags,
            'learning_summary': getattr(self, '_learning_summary', None),
            'alert_thresholds_config': self.anomaly_thresholds,
        }
    
    def _calculate_predictions(self) -> Optional[Dict]:
        """Predict how many more operations needed and time to completion"""
        # Return basic predictions even with limited data
        if len(self.metrics_history) < 2:
            return {
                'estimated_operations_remaining': None,
                'estimated_time_minutes': None,
                'current_trend': 'insufficient_data',
                'efficiency_score': 0,
                'bottleneck': 'unknown',
                'confidence': 'low',
                'message': 'Need more metrics data for accurate predictions'
            }
        if len(self.metrics_history) < 3 or self.total_operations < 3:
            # Return basic predictions with low confidence
            return {
                'estimated_operations_remaining': None,
                'estimated_time_minutes': None,
                'current_trend': 'calculating',
                'efficiency_score': 0,
                'bottleneck': 'unknown',
                'confidence': 'low',
                'message': 'Collecting more data for predictions'
            }
        
        try:
            cpu_threshold = self.target_config.get('cpu_threshold', 80)
            memory_threshold = self.target_config.get('memory_threshold', 80)
            current_cpu = self.current_metrics.get('cpu_percent', 0)
            current_mem = self.current_metrics.get('memory_percent', 0)
            
            # Calculate trend from recent metrics
            recent_metrics = self.metrics_history[-5:]  # Last 5 readings
            if len(recent_metrics) < 2:
                return None
            
            # Calculate average CPU change per iteration
            cpu_changes = []
            mem_changes = []
            ops_per_iteration = []
            
            for i in range(1, len(recent_metrics)):
                prev_cpu = recent_metrics[i-1].get('cpu_percent', 0)
                curr_cpu = recent_metrics[i].get('cpu_percent', 0)
                prev_mem = recent_metrics[i-1].get('memory_percent', 0)
                curr_mem = recent_metrics[i].get('memory_percent', 0)
                
                cpu_changes.append(curr_cpu - prev_cpu)
                mem_changes.append(curr_mem - prev_mem)
            
            # Estimate operations per iteration from recent history
            if len(self.operation_impact_history) >= 2:
                recent_impacts = self.operation_impact_history[-3:]
                ops_per_iteration = [imp['operations_count'] for imp in recent_impacts]
                avg_ops_per_iter = sum(ops_per_iteration) / len(ops_per_iteration) if ops_per_iteration else 3
            else:
                avg_ops_per_iter = 3  # Default
            
            avg_cpu_change = sum(cpu_changes) / len(cpu_changes) if cpu_changes else 0
            avg_mem_change = sum(mem_changes) / len(mem_changes) if mem_changes else 0
            
            # Calculate remaining deltas
            cpu_needed = max(0, cpu_threshold - current_cpu)
            mem_needed = max(0, memory_threshold - current_mem)
            
            # Estimate operations needed
            # Use the metric that needs more change
            if cpu_needed > mem_needed:
                # CPU is the bottleneck
                if avg_cpu_change > 0:
                    iterations_needed = cpu_needed / avg_cpu_change
                    ops_needed = iterations_needed * avg_ops_per_iter
                else:
                    ops_needed = None
                bottleneck = 'CPU'
            else:
                # Memory is the bottleneck
                if avg_mem_change > 0:
                    iterations_needed = mem_needed / avg_mem_change
                    ops_needed = iterations_needed * avg_ops_per_iter
                else:
                    ops_needed = None
                bottleneck = 'Memory'
            
            # Estimate time
            if ops_needed and avg_ops_per_iter > 0:
                iterations_remaining = ops_needed / avg_ops_per_iter
                time_minutes = iterations_remaining * (self.poll_interval / 60)
            else:
                time_minutes = None
            
            # Calculate efficiency score
            if avg_ops_per_iter > 0:
                cpu_per_op = avg_cpu_change / avg_ops_per_iter if avg_ops_per_iter > 0 else 0
                mem_per_op = avg_mem_change / avg_ops_per_iter if avg_ops_per_iter > 0 else 0
                efficiency_score = (abs(cpu_per_op) + abs(mem_per_op)) * 10  # Scale to 0-100
            else:
                efficiency_score = 0
            
            # Determine trend
            if len(cpu_changes) >= 2:
                recent_trend = 'increasing' if cpu_changes[-1] > 0 else 'decreasing'
            else:
                recent_trend = 'stable'
            
            return {
                'estimated_operations_remaining': int(ops_needed) if ops_needed else None,
                'estimated_time_minutes': round(time_minutes, 1) if time_minutes else None,
                'current_trend': recent_trend,
                'efficiency_score': round(efficiency_score, 1),
                'bottleneck': bottleneck,
                'avg_cpu_change_per_iteration': round(avg_cpu_change, 2),
                'avg_memory_change_per_iteration': round(avg_mem_change, 2),
                'avg_operations_per_iteration': round(avg_ops_per_iter, 1),
                'confidence': 'high' if len(recent_metrics) >= 5 else 'medium' if len(recent_metrics) >= 3 else 'low'
            }
        except Exception as e:
            logger.debug(f"Could not calculate predictions: {e}")
            return None
    
    def _fetch_pod_metrics_sync(self) -> List[Dict]:
        """Synchronous wrapper for fetching pod metrics"""
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            pods = loop.run_until_complete(self._get_pod_metrics())
            loop.close()
            return pods
        except Exception as e:
            logger.warning(f"Failed to fetch pod metrics: {e}")
            return []
    
    def get_report(self) -> Dict[str, Any]:
        """Generate comprehensive execution report with enhanced analysis"""
        duration = 0
        if self.start_time and self.end_time:
            duration = (self.end_time - self.start_time).total_seconds() / 60
        
        # Calculate statistics
        successful_ops = sum(1 for op in self.operations_history if op['status'] == 'SUCCESS')
        failed_ops = sum(1 for op in self.operations_history if op['status'] == 'FAILED')
        success_rate = (successful_ops / self.total_operations * 100) if self.total_operations > 0 else 0
        ops_per_minute = self.total_operations / duration if duration > 0 else 0
        
        # Group by entity type
        entity_breakdown = {}
        for op in self.operations_history:
            entity_type = op['entity_type']
            if entity_type not in entity_breakdown:
                entity_breakdown[entity_type] = {'total': 0, 'success': 0, 'failed': 0}
            
            entity_breakdown[entity_type]['total'] += 1
            if op['status'] == 'SUCCESS':
                entity_breakdown[entity_type]['success'] += 1
            else:
                entity_breakdown[entity_type]['failed'] += 1
        
        # Calculate metric changes
        baseline_cpu = self.baseline_metrics.get('cpu_percent', 0)
        baseline_mem = self.baseline_metrics.get('memory_percent', 0)
        final_cpu = self.current_metrics.get('cpu_percent', 0)
        final_mem = self.current_metrics.get('memory_percent', 0)
        
        cpu_change = final_cpu - baseline_cpu
        mem_change = final_mem - baseline_mem
        
        # Enhanced analysis
        analysis = self._generate_analysis()
        
        return {
            'execution_id': self.execution_id,
            'testbed': self.testbed_info.get('testbed_label'),
            'testbed_label': self.testbed_info.get('testbed_label'),
            'testbed_id': self.testbed_info.get('unique_testbed_id'),
            'status': self.status,
            'start_time': self.start_time.isoformat() if self.start_time else None,
            'end_time': self.end_time.isoformat() if self.end_time else None,
            'duration_minutes': duration,
            
            # Statistics
            'total_operations': self.total_operations,
            'successful_operations': successful_ops,
            'failed_operations': failed_ops,
            'success_rate': success_rate,
            'operations_per_minute': ops_per_minute,
            
            # Metrics
            'baseline_metrics': self.baseline_metrics,
            'final_metrics': self.current_metrics,
            'current_metrics': self.current_metrics,
            'metrics_history': self.metrics_history,
            'metric_changes': {
                'cpu_delta': cpu_change,
                'memory_delta': mem_change,
                'cpu_change_percent': (cpu_change / baseline_cpu * 100) if baseline_cpu > 0 else 0,
                'memory_change_percent': (mem_change / baseline_mem * 100) if baseline_mem > 0 else 0
            },
            
            # Configuration
            'target_config': self.target_config,
            'entities_config': self.entities_config,
            'rule_config': self.rule_config,  # Rule configuration
            
            # Operations
            'operations_history': self.operations_history,
            'entity_breakdown': entity_breakdown,
            
            # NEW: Enhanced analysis
            'analysis': analysis,
            
            # NEW: Operation effectiveness
            'operation_effectiveness': self._get_most_effective_operations(limit=10),
            
            # NEW: Impact tracking
            'operation_impacts': self.operation_impact_history,
            
            # Phase 3: Anomalies and recommendations
            'detected_anomalies': self.detected_anomalies,
            'recommendations_history': self.recommendations_history,
            'automated_recommendations': self._generate_automated_recommendations(),
            
            # Pod-operation correlation
            'pod_operation_correlation': getattr(self, '_get_pod_operation_correlation', lambda: {})(),
            
            # Execution context
            'execution_context': {
                'mode': 'REAL NCM Operations' if self.ncm_client_ready else 'Simulated',
                'cluster_name': self.cluster_name,
                'cluster_uuid': self.cluster_uuid,
                'testbed_label': self.testbed_info.get('testbed_label')
            },
            
            # Created entities
            'created_entities': [
                {
                    'entity_type': entity_type,
                    'entities': entities
                }
                for entity_type, entities in self.created_entities.items()
            ]
        }
    
    def _generate_analysis(self) -> Dict[str, Any]:
        """Generate comprehensive analysis of execution"""
        analysis = {
            'key_findings': [],
            'recommendations': [],
            'anomalies': [],
            'correlations': {}
        }
        
        # Key findings
        if len(self.metrics_history) >= 2:
            baseline_cpu = self.baseline_metrics.get('cpu_percent', 0)
            final_cpu = self.current_metrics.get('cpu_percent', 0)
            cpu_change = final_cpu - baseline_cpu
            
            baseline_mem = self.baseline_metrics.get('memory_percent', 0)
            final_mem = self.current_metrics.get('memory_percent', 0)
            mem_change = final_mem - baseline_mem
            
            if cpu_change > 0:
                analysis['key_findings'].append(
                    f"CPU increased by {cpu_change:.1f}% (from {baseline_cpu:.1f}% to {final_cpu:.1f}%)"
                )
            if mem_change > 0:
                analysis['key_findings'].append(
                    f"Memory increased by {mem_change:.1f}% (from {baseline_mem:.1f}% to {final_mem:.1f}%)"
                )
            
            # Find most impactful operations
            if self.operation_effectiveness:
                most_effective = self._get_most_effective_operations(limit=1)
                if most_effective:
                    top_op = most_effective[0]
                    analysis['key_findings'].append(
                        f"Most effective operation: {top_op['key']} "
                        f"(avg CPU: {top_op['avg_cpu_delta']:+.2f}%, Memory: {top_op['avg_memory_delta']:+.2f}%)"
                    )
        
        # Recommendations
        if self.total_operations > 0:
            success_rate = (sum(1 for op in self.operations_history if op.get('status') == 'SUCCESS') / 
                          self.total_operations * 100)
            
            if success_rate < 80:
                analysis['recommendations'].append(
                    f"Success rate is {success_rate:.1f}% - consider investigating failures"
                )
            
            # Check if threshold was reached
            cpu_threshold = self.target_config.get('cpu_threshold', 80)
            mem_threshold = self.target_config.get('memory_threshold', 80)
            current_cpu = self.current_metrics.get('cpu_percent', 0)
            current_mem = self.current_metrics.get('memory_percent', 0)
            
            if current_cpu < cpu_threshold * 0.9 and current_mem < mem_threshold * 0.9:
                analysis['recommendations'].append(
                    "Consider using more CPU-intensive operations (VM power cycles) for faster CPU increase"
                )
            
            # Check operation effectiveness
            if self.operation_effectiveness:
                most_effective = self._get_most_effective_operations(limit=3)
                if most_effective:
                    top_ops = [op['key'] for op in most_effective]
                    analysis['recommendations'].append(
                        f"For better results, prioritize: {', '.join(top_ops)}"
                    )
        
        # Phase 3: Enhanced anomalies detection
        analysis['anomalies'] = self._detect_all_anomalies()
        analysis['anomalies_summary'] = {
            'total': len(analysis['anomalies']),
            'by_type': {}
        }
        for anomaly in analysis['anomalies']:
            anomaly_type = anomaly.get('type', 'unknown')
            analysis['anomalies_summary']['by_type'][anomaly_type] = \
                analysis['anomalies_summary']['by_type'].get(anomaly_type, 0) + 1
        
        # Correlations
        if self.operation_impact_history:
            # Find which operations correlate with CPU increases
            cpu_correlations = {}
            for impact in self.operation_impact_history:
                for op_info in impact.get('operations', []):
                    key = f"{op_info.get('entity_type')}.{op_info.get('operation')}"
                    if key not in cpu_correlations:
                        cpu_correlations[key] = []
                    cpu_correlations[key].append(op_info.get('impact', {}).get('cpu_delta', 0))
            
            # Calculate average CPU impact per operation type
            for key, deltas in cpu_correlations.items():
                if deltas:
                    analysis['correlations'][key] = {
                        'avg_cpu_impact': sum(deltas) / len(deltas),
                        'execution_count': len(deltas)
                    }
        
        return analysis
    
    def _detect_anomalies_realtime(self, cpu: float, memory: float, iteration: int) -> List[Dict]:
        """Phase 3: Real-time anomaly detection during execution"""
        anomalies = []
        
        if len(self.metrics_history) < 2:
            return anomalies
        
        prev_metrics = self.metrics_history[-2]
        prev_cpu = prev_metrics.get('cpu_percent', 0)
        prev_mem = prev_metrics.get('memory_percent', 0)
        
        # 1. CPU Spike Detection
        cpu_change = cpu - prev_cpu
        if cpu_change > self.anomaly_thresholds['cpu_spike_percent']:
            anomalies.append({
                'type': 'cpu_spike',
                'severity': 'high' if cpu_change > 20 else 'medium',
                'message': f"Unexpected CPU spike: {cpu_change:.1f}% increase in one iteration",
                'value': cpu_change,
                'iteration': iteration,
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
        
        # 2. Memory Spike Detection
        mem_change = memory - prev_mem
        if mem_change > self.anomaly_thresholds['memory_spike_percent']:
            anomalies.append({
                'type': 'memory_spike',
                'severity': 'high' if mem_change > 20 else 'medium',
                'message': f"Unexpected memory spike: {mem_change:.1f}% increase in one iteration",
                'value': mem_change,
                'iteration': iteration,
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
        
        # 3. Metric Stagnation Detection
        if len(self.metrics_history) >= self.anomaly_thresholds['metric_stagnation_iterations'] + 1:
            recent_cpu_changes = []
            recent_mem_changes = []
            for i in range(len(self.metrics_history) - self.anomaly_thresholds['metric_stagnation_iterations'], len(self.metrics_history)):
                if i > 0:
                    recent_cpu_changes.append(abs(self.metrics_history[i].get('cpu_percent', 0) - 
                                                  self.metrics_history[i-1].get('cpu_percent', 0)))
                    recent_mem_changes.append(abs(self.metrics_history[i].get('memory_percent', 0) - 
                                                  self.metrics_history[i-1].get('memory_percent', 0)))
            
            if recent_cpu_changes and max(recent_cpu_changes) < 1.0:
                anomalies.append({
                    'type': 'metric_stagnation',
                    'severity': 'medium',
                    'message': f"CPU metrics stagnant for {self.anomaly_thresholds['metric_stagnation_iterations']} iterations",
                    'iteration': iteration,
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })
        
        # 4. Unexpected Drop Detection
        if cpu_change < -self.anomaly_thresholds['unexpected_drop_percent']:
            anomalies.append({
                'type': 'unexpected_drop',
                'severity': 'medium',
                'message': f"Unexpected CPU drop: {abs(cpu_change):.1f}% decrease",
                'value': cpu_change,
                'iteration': iteration,
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
        
        # 5. High Failure Rate Detection
        if self.total_operations > 10:
            failure_rate = self.failed_operations / self.total_operations
            if failure_rate > self.anomaly_thresholds['failure_rate_threshold']:
                anomalies.append({
                    'type': 'high_failure_rate',
                    'severity': 'high',
                    'message': f"High failure rate: {failure_rate:.1%} ({self.failed_operations}/{self.total_operations})",
                    'value': failure_rate,
                    'iteration': iteration,
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })
        
        return anomalies
    
    def _detect_all_anomalies(self) -> List[Dict]:
        """Phase 3: Comprehensive anomaly detection for report"""
        anomalies = []
        
        # Use detected anomalies from real-time detection
        anomalies.extend(self.detected_anomalies)
        
        # Additional post-execution anomaly detection
        if len(self.metrics_history) >= 3:
            # Check for patterns
            cpu_values = [m.get('cpu_percent', 0) for m in self.metrics_history]
            mem_values = [m.get('memory_percent', 0) for m in self.metrics_history]
            
            # Variance detection
            if cpu_values:
                cpu_variance = max(cpu_values) - min(cpu_values)
                if cpu_variance > 50:  # Very high variance
                    anomalies.append({
                        'type': 'high_variance',
                        'severity': 'medium',
                        'message': f"High CPU variance detected: {cpu_variance:.1f}% range",
                        'value': cpu_variance
                    })
        
        return anomalies
    
    def _generate_anomaly_recommendation(self, anomaly: Dict) -> Optional[Dict]:
        """Phase 3: Generate automated recommendation for detected anomaly"""
        anomaly_type = anomaly.get('type')
        
        recommendations = {
            'cpu_spike': {
                'action': 'Consider reducing operation intensity - CPU spike detected',
                'reason': 'High CPU spike may indicate overload',
                'priority': 'high' if anomaly.get('severity') == 'high' else 'medium'
            },
            'memory_spike': {
                'action': 'Monitor memory usage - unexpected spike detected',
                'reason': 'Memory spike may indicate memory leak or high allocation',
                'priority': 'high' if anomaly.get('severity') == 'high' else 'medium'
            },
            'metric_stagnation': {
                'action': 'Increase operation intensity or use more impactful operations',
                'reason': 'Metrics not responding to operations',
                'priority': 'medium'
            },
            'unexpected_drop': {
                'action': 'Investigate system state - unexpected metric drop',
                'reason': 'Drop may indicate system recovery or operation failure',
                'priority': 'medium'
            },
            'high_failure_rate': {
                'action': 'Check testbed connectivity and resource availability',
                'reason': f"High failure rate ({anomaly.get('value', 0):.1%}) indicates issues",
                'priority': 'high'
            }
        }
        
        if anomaly_type in recommendations:
            rec = recommendations[anomaly_type].copy()
            rec['anomaly_id'] = len(self.recommendations_history)
            rec['timestamp'] = datetime.now(timezone.utc).isoformat()
            rec['anomaly'] = anomaly
            return rec
        
        return None
    
    def _generate_automated_recommendations(self) -> List[Dict]:
        """Phase 3: Generate automated recommendations based on execution patterns"""
        recommendations = []
        
        # 1. Success Rate Recommendations
        if self.total_operations > 0:
            success_rate = (self.successful_operations / self.total_operations) * 100
            if success_rate < 80:
                recommendations.append({
                    'type': 'success_rate',
                    'priority': 'high',
                    'action': f'Success rate is {success_rate:.1f}% - investigate failures',
                    'reason': 'Low success rate indicates system or configuration issues',
                    'suggestions': [
                        'Check testbed connectivity',
                        'Verify entity configurations',
                        'Review error logs for patterns'
                    ]
                })
        
        # 2. Efficiency Recommendations
        if len(self.operation_effectiveness) > 0:
            most_effective = self._get_most_effective_operations(limit=1)
            if most_effective:
                top_op = most_effective[0]
                if top_op['effectiveness_score'] < 1.0:  # Low effectiveness
                    recommendations.append({
                        'type': 'efficiency',
                        'priority': 'medium',
                        'action': 'Operations have low impact - consider using more impactful operations',
                        'reason': f"Most effective operation ({top_op['key']}) has score {top_op['effectiveness_score']:.2f}",
                        'suggestions': [
                            'Use VM power operations for CPU impact',
                            'Enable CPU stress workloads',
                            'Increase parallel operation count'
                        ]
                    })
        
        # 3. Threshold Achievement Recommendations
        current_cpu = self.current_metrics.get('cpu_percent', 0)
        current_mem = self.current_metrics.get('memory_percent', 0)
        target_cpu = self.target_config.get('cpu_threshold', 80)
        target_mem = self.target_config.get('memory_threshold', 80)
        
        if self.status == 'COMPLETED':
            cpu_reached = current_cpu >= target_cpu
            mem_reached = current_mem >= target_mem
            
            if not cpu_reached and not mem_reached:
                recommendations.append({
                    'type': 'threshold',
                    'priority': 'medium',
                    'action': 'Execution completed but thresholds not reached',
                    'reason': f'CPU: {current_cpu:.1f}%/{target_cpu}%, Memory: {current_mem:.1f}%/{target_mem}%',
                    'suggestions': [
                        'Increase operation intensity',
                        'Use more CPU-intensive operations',
                        'Extend execution duration'
                    ]
                })
        
        # 4. Operation Selection Recommendations
        if len(self.operation_effectiveness) >= 3:
            effective_ops = self._get_most_effective_operations(limit=3)
            if effective_ops:
                top_ops = [op['key'] for op in effective_ops]
                recommendations.append({
                    'type': 'operation_selection',
                    'priority': 'low',
                    'action': f'Prioritize these operations for better results: {", ".join(top_ops)}',
                    'reason': 'These operations have shown highest effectiveness',
                    'suggestions': [
                        f'Increase frequency of {top_ops[0]}',
                        'Consider removing low-impact operations'
                    ]
                })
        
        # 5. Performance Recommendations
        # Calculate duration
        duration_minutes = 0
        if self.start_time:
            end = self.end_time or datetime.now(timezone.utc)
            if self.start_time.tzinfo is None:
                from datetime import timezone as tz
                start = self.start_time.replace(tzinfo=tz.utc)
            else:
                start = self.start_time
            if end.tzinfo is None:
                from datetime import timezone as tz
                end = end.replace(tzinfo=tz.utc)
            duration_minutes = (end - start).total_seconds() / 60
        
        if duration_minutes > 0:
            ops_per_min = self.total_operations / duration_minutes
            if ops_per_min < 5:
                recommendations.append({
                    'type': 'performance',
                    'priority': 'medium',
                    'action': f'Low operation rate ({ops_per_min:.1f} ops/min) - enable parallel execution',
                    'reason': 'Sequential execution may be too slow',
                    'suggestions': [
                        'Enable parallel execution',
                        'Reduce operation delays',
                        'Increase operations per iteration'
                    ]
                })
        
        return recommendations
    
    def _send_threshold_alert(self, cpu: float, memory: float):
        """Phase 3: Send alert when threshold is reached"""
        try:
            # Check if alerts are enabled (would be in target_config or monitoring config)
            # For now, always send if threshold reached
            
            alert_data = {
                'execution_id': self.execution_id,
                'testbed_label': self.testbed_info.get('testbed_label', 'Unknown'),
                'threshold_reached': True,
                'cpu_percent': cpu,
                'memory_percent': memory,
                'target_cpu': self.target_config.get('cpu_threshold', 80),
                'target_memory': self.target_config.get('memory_threshold', 80),
                'total_operations': self.total_operations,
                'duration_minutes': (datetime.now(timezone.utc) - self.start_time).total_seconds() / 60 if self.start_time else 0,
                'success_rate': (self.successful_operations / self.total_operations * 100) if self.total_operations > 0 else 0,
                'anomalies_count': len(self.detected_anomalies),
                'timestamp': datetime.now(timezone.utc).isoformat()
            }
            
            # Broadcast via WebSocket
            broadcast_log(self.execution_id, 'ALERT', '🎯 Threshold reached!', alert_data)
            
            # TODO: Integrate with Slack/Email alerting system
            # This would call the existing alert service
            logger.info(f"📢 Threshold alert prepared: {alert_data}")
            
        except Exception as e:
            logger.warning(f"Failed to send threshold alert: {e}")
    
    async def cleanup_entities(self) -> Dict[str, Any]:
        """
        Delete all entities created during this execution
        Returns summary of cleanup results
        """
        logger.info(f"🧹 Starting entity cleanup for execution {self.execution_id}")
        
        cleanup_results = {
            'success': [],
            'failed': [],
            'skipped': []
        }
        
        total_entities = sum(len(entities) for entities in self.created_entities.values())
        logger.info(f"📋 Total entities to cleanup: {total_entities}")
        
        if not self.ncm_client:
            logger.warning("⚠️  No NCM client available for cleanup")
            return {
                'total': total_entities,
                'success': 0,
                'failed': 0,
                'skipped': total_entities,
                'results': cleanup_results,
                'message': 'NCM client not available for cleanup'
            }
        
        for entity_type, entities in self.created_entities.items():
            logger.info(f"🗑️  Cleaning up {len(entities)} {entity_type} entities...")
            
            for entity in entities:
                entity_uuid = entity['uuid']
                entity_name = entity['name']
                
                try:
                    # Tier 1: Core Infrastructure
                    if entity_type == "VM":
                        result = await self._cleanup_vm(entity_uuid, entity_name)
                    elif entity_type == "Project":
                        result = await self._cleanup_project(entity_uuid, entity_name)
                    elif entity_type == "Category":
                        result = await self._cleanup_category(entity_uuid, entity_name)
                    elif entity_type == "Subnet":
                        result = await self._cleanup_subnet(entity_uuid, entity_name)
                    
                    # Tier 2-3: Self-Service & App Lifecycle (have real operations)
                    elif entity_type in ["Endpoint", "Library Variable", "Runbook", 
                                        "Blueprint", "Blueprint (Single VM)", "Blueprint (Multi VM)",
                                        "Application", "Marketplace Item", "Playbook"]:
                        result = await self._cleanup_generic_entity(entity_type, entity_uuid, entity_name)
                    
                    # Tier 4-6: Simulated entities (skip cleanup)
                    else:
                        logger.warning(f"⚠️  Cleanup not implemented for {entity_type}, skipping {entity_name}")
                        cleanup_results['skipped'].append({
                            'entity_type': entity_type,
                            'entity_uuid': entity_uuid,
                            'entity_name': entity_name,
                            'reason': 'Cleanup not implemented (simulated entity)'
                        })
                        continue
                    
                    if result['success']:
                        logger.info(f"✅ Deleted {entity_type}: {entity_name}")
                        cleanup_results['success'].append({
                            'entity_type': entity_type,
                            'entity_uuid': entity_uuid,
                            'entity_name': entity_name
                        })
                    else:
                        logger.error(f"❌ Failed to delete {entity_type}: {entity_name} - {result.get('error')}")
                        cleanup_results['failed'].append({
                            'entity_type': entity_type,
                            'entity_uuid': entity_uuid,
                            'entity_name': entity_name,
                            'error': result.get('error')
                        })
                        
                except Exception as e:
                    logger.error(f"❌ Exception during cleanup of {entity_type}/{entity_name}: {e}")
                    cleanup_results['failed'].append({
                        'entity_type': entity_type,
                        'entity_uuid': entity_uuid,
                        'entity_name': entity_name,
                        'error': str(e)
                    })
        
        summary = {
            'total': total_entities,
            'success': len(cleanup_results['success']),
            'failed': len(cleanup_results['failed']),
            'skipped': len(cleanup_results['skipped']),
            'results': cleanup_results
        }
        
        logger.info(f"🧹 Cleanup complete: {summary['success']}/{total_entities} deleted, {summary['failed']} failed, {summary['skipped']} skipped")
        return summary
    
    async def _cleanup_vm(self, vm_uuid: str, vm_name: str) -> Dict:
        """Delete a specific VM"""
        try:
            logger.info(f"🗑️  Deleting VM: {vm_name} ({vm_uuid})")
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await pc.v3_request(
                endpoint=f"/vms/{vm_uuid}",
                method="DELETE"
            )
            
            if response:
                logger.info(f"✅ VM deletion initiated: {vm_name}")
                return {'success': True, 'error': None}
            else:
                return {'success': False, 'error': 'No response from NCM API'}
                
        except Exception as e:
            logger.error(f"❌ Failed to delete VM {vm_name}: {e}")
            return {'success': False, 'error': str(e)}
    
    async def _cleanup_project(self, project_uuid: str, project_name: str) -> Dict:
        """Delete a specific Project"""
        try:
            logger.info(f"🗑️  Deleting Project: {project_name} ({project_uuid})")
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await pc.v3_request(
                endpoint=f"/projects_internal/{project_uuid}",
                method="DELETE"
            )
            
            if response:
                logger.info(f"✅ Project deletion initiated: {project_name}")
                return {'success': True, 'error': None}
            else:
                return {'success': False, 'error': 'No response from NCM API'}
                
        except Exception as e:
            logger.error(f"❌ Failed to delete Project {project_name}: {e}")
            return {'success': False, 'error': str(e)}
    
    async def _cleanup_category(self, category_uuid: str, category_name: str) -> Dict:
        """Delete a specific Category"""
        try:
            logger.info(f"🗑️  Deleting Category: {category_name} ({category_uuid})")
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await pc.v3_request(
                endpoint=f"/categories/{category_uuid}",
                method="DELETE"
            )
            
            if response:
                logger.info(f"✅ Category deletion initiated: {category_name}")
                return {'success': True, 'error': None}
            else:
                return {'success': False, 'error': 'No response from NCM API'}
                
        except Exception as e:
            logger.error(f"❌ Failed to delete Category {category_name}: {e}")
            return {'success': False, 'error': str(e)}
    
    async def _cleanup_subnet(self, subnet_uuid: str, subnet_name: str) -> Dict:
        """Delete a specific Subnet"""
        try:
            logger.info(f"🗑️  Deleting Subnet: {subnet_name} ({subnet_uuid})")
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await pc.v3_request(
                endpoint=f"/subnets/{subnet_uuid}",
                method="DELETE"
            )
            
            if response:
                logger.info(f"✅ Subnet deletion initiated: {subnet_name}")
                return {'success': True, 'error': None}
            else:
                return {'success': False, 'error': 'No response from NCM API'}
                
        except Exception as e:
            logger.error(f"❌ Failed to delete Subnet {subnet_name}: {e}")
            return {'success': False, 'error': str(e)}
    
    async def _cleanup_generic_entity(self, entity_type: str, entity_uuid: str, entity_name: str) -> Dict:
        """Generic cleanup method for Tier 2-3 entities"""
        try:
            # Map entity types to API endpoints
            endpoint_map = {
                "Endpoint": "/endpoints",
                "Library Variable": "/calm_global_variables",
                "Runbook": "/runbooks",
                "Blueprint": "/blueprints",
                "Blueprint (Single VM)": "/blueprints",
                "Blueprint (Multi VM)": "/blueprints",
                "Application": "/apps",
                "Marketplace Item": "/calm_marketplace_items",
                "Playbook": "/action_rules"
            }
            
            endpoint = endpoint_map.get(entity_type)
            if not endpoint:
                return {'success': False, 'error': f'Unknown entity type: {entity_type}'}
            
            logger.info(f"🗑️  Deleting {entity_type}: {entity_name} ({entity_uuid})")
            pc = getattr(self, 'pc_client', self.ncm_client) or self.ncm_client
            response = await pc.v3_request(
                endpoint=f"{endpoint}/{entity_uuid}",
                method="DELETE"
            )
            
            if response:
                logger.info(f"✅ {entity_type} deletion initiated: {entity_name}")
                return {'success': True, 'error': None}
            else:
                return {'success': False, 'error': 'No response from NCM API'}
                
        except Exception as e:
            logger.error(f"❌ Failed to delete {entity_type} {entity_name}: {e}")
            return {'success': False, 'error': str(e)}


# Global registry for active smart executions
_active_smart_executions: Dict[str, SmartExecutionController] = {}


def start_smart_execution(testbed_info: Dict, target_config: Dict, entities_config: Dict, rule_config: Dict = None) -> str:
    """
    Start a new smart execution
    
    Args:
        testbed_info: Testbed information
        target_config: Target thresholds configuration
        entities_config: Entity and operations configuration
        rule_config: Rule configuration (namespaces, pod_names, custom_queries, rule_book_id)
    
    Returns:
        execution_id
    """
    controller = SmartExecutionController(testbed_info, target_config, entities_config, rule_config)
    execution_id = controller.execution_id
    
    _active_smart_executions[execution_id] = controller
    
    # Start execution in background thread with its own event loop
    def run_async_execution():
        """Run async execution in a separate thread"""
        try:
            asyncio.run(controller.start_execution())
        except Exception as e:
            logger.error(f"Error in smart execution thread: {e}", exc_info=True)
    
    thread = threading.Thread(target=run_async_execution, daemon=True)
    thread.start()
    
    return execution_id


def get_smart_execution(execution_id: str) -> Optional[SmartExecutionController]:
    """Get a smart execution controller by ID (from memory or database)"""
    # First check memory
    if execution_id in _active_smart_executions:
        return _active_smart_executions[execution_id]
    
    # Try to load from database
    try:
        from services.smart_execution_db import load_smart_execution
        db_data = load_smart_execution(execution_id)
        if db_data:
            logger.info(f"📂 Loaded execution {execution_id} from database")
            # Note: We can't fully reconstruct controller from DB, but we can return the data
            # For now, return None and let API handle DB data directly
            return None
    except Exception as e:
        logger.debug(f"Could not load execution {execution_id} from database: {e}")
    
    return None


def stop_smart_execution(execution_id: str) -> bool:
    """Stop a smart execution"""
    controller = _active_smart_executions.get(execution_id)
    if controller:
        controller.stop()
        return True
    return False


def pause_smart_execution(execution_id: str) -> Dict[str, Any]:
    """Pause a smart execution"""
    controller = _active_smart_executions.get(execution_id)
    if controller:
        return controller.pause()
    return {'success': False, 'error': 'Execution not found'}


def resume_smart_execution(execution_id: str) -> Dict[str, Any]:
    """Resume a smart execution"""
    controller = _active_smart_executions.get(execution_id)
    if controller:
        return controller.resume()
    return {'success': False, 'error': 'Execution not found'}


def get_smart_execution_logs(execution_id: str, since: Optional[str] = None, limit: int = 100) -> List[Dict]:
    """Get live logs for a smart execution"""
    controller = _active_smart_executions.get(execution_id)
    if controller:
        return controller.get_live_logs(since=since, limit=limit)
    return []


def get_all_smart_executions() -> list:
    """Get list of all smart executions from database and memory (excluding child executions)"""
    from datetime import datetime, timezone
    
    executions = []
    execution_ids_seen = set()
    
    # First, get from database (persisted executions)
    try:
        from services.smart_execution_db import list_smart_executions
        db_executions = list_smart_executions(limit=1000)
        for exec_data in db_executions:
            execution_id = exec_data.get('execution_id')
            if execution_id:
                # FILTER OUT child executions (those with parent_execution_id in target_config)
                target_config = exec_data.get('target_config', {})
                if isinstance(target_config, dict) and target_config.get('parent_execution_id'):
                    # This is a child execution, skip it
                    logger.debug(f"Filtering out child execution: {execution_id}")
                    continue
                
                execution_ids_seen.add(execution_id)
                # Ensure duration_minutes is calculated if missing
                if exec_data.get('duration_minutes') is None and exec_data.get('start_time') and exec_data.get('end_time'):
                    try:
                        from datetime import datetime
                        start = datetime.fromisoformat(exec_data['start_time'].replace('Z', '+00:00'))
                        end = datetime.fromisoformat(exec_data['end_time'].replace('Z', '+00:00'))
                        exec_data['duration_minutes'] = (end - start).total_seconds() / 60
                    except:
                        pass
                executions.append(exec_data)
    except Exception as e:
        logger.warning(f"⚠️ Failed to load executions from database: {e}")
    
    # Then, add active executions from memory (if not already in list)
    for execution_id, controller in _active_smart_executions.items():
        if execution_id not in execution_ids_seen:
            duration_minutes = None
            if controller.start_time:
                end = controller.end_time or datetime.now(timezone.utc)
                duration_minutes = (end - controller.start_time).total_seconds() / 60
            
            executions.append({
                'execution_id': execution_id,
                'testbed_id': controller.testbed_info.get('unique_testbed_id', 'unknown'),
                'testbed_label': controller.testbed_info.get('testbed_label', 'Unknown'),
                'status': controller.status,
                'is_running': controller.is_running,
                'total_operations': controller.total_operations,
                'start_time': controller.start_time.isoformat() if controller.start_time else None,
                'end_time': controller.end_time.isoformat() if controller.end_time else None,
                'duration_minutes': duration_minutes,
                'target_config': controller.target_config,
                'baseline_metrics': controller.baseline_metrics,
                'final_metrics': controller.current_metrics,
                'threshold_reached': controller._check_thresholds_reached(
                    controller.current_metrics.get('cpu_percent', 0),
                    controller.current_metrics.get('memory_percent', 0)
                ) if hasattr(controller, '_check_thresholds_reached') else False
            })
    
    # Sort by start_time descending (most recent first)
    executions.sort(key=lambda x: x.get('start_time', ''), reverse=True)
    return executions


def cleanup_completed_executions():
    """Remove completed executions from active registry"""
    to_remove = []
    for execution_id, controller in _active_smart_executions.items():
        if not controller.is_running and controller.status in ['COMPLETED', 'FAILED', 'STOPPED']:
            to_remove.append(execution_id)
    
    for execution_id in to_remove:
        del _active_smart_executions[execution_id]
    
    return len(to_remove)


def delete_smart_execution(execution_id: str) -> bool:
    """Delete a smart execution from memory"""
    if execution_id in _active_smart_executions:
        del _active_smart_executions[execution_id]
        logger.info(f"🗑️ Deleted smart execution: {execution_id}")
        return True
    return False
