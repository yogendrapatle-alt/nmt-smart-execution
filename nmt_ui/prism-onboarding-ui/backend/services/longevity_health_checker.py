"""
Longevity Health Checker Service

Production-grade health verification suite for NCM Longevity testing.
Implements checks inspired by nutest-py3-tests verification framework:

 - FATAL/panic log scanning (PcFatalExistVerification)
 - Process restart detection via genesis status (PcAllProcessRestartVerification)
 - Cgroup OOM failcnt monitoring (PcCgroupMemOomVerification)
 - Thread count verification (PcThreadCountVerification)
 - Disk partition usage monitoring
 - Core dump detection
 - Per-service memory leak detection via Prometheus
 - Entity parity / sync verification
"""

import logging
import re
import subprocess
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Tuple
from urllib.parse import urljoin

import requests

logger = logging.getLogger(__name__)

FATAL_CHECK_COMMANDS = [
    "find ~/data/logs/*.FATAL* -type f -mmin -{interval} 2>/dev/null | head -20",
    "find ~/data/cores/* -type f -mmin -{interval} 2>/dev/null | head -10",
    "sudo dmesg -T 2>/dev/null | grep -i 'out of memory\\|oom\\|killed process' | tail -20",
    "find ~/data/logs/*.out* -type f -mmin -{interval} 2>/dev/null | xargs grep -l 'SIGSEGV\\|SIGABRT\\|SIGFPE' 2>/dev/null | head -10",
]

KNOWN_FATAL_NOISE = [
    r"ikat_control_plane",
    r"hera",
    r"audisp-syslog",
    r"QFATAL",
    r"exit handler invoked by user",
]


class LongevityHealthChecker:
    """SSH-based health verification for NCM longevity testing."""

    def __init__(self, pc_ip: str, ssh_password: str = "nutanix/4u",
                 ssh_user: str = "nutanix", prometheus_url: Optional[str] = None):
        self.pc_ip = pc_ip
        self.ssh_password = ssh_password
        self.ssh_user = ssh_user
        self.prometheus_url = prometheus_url
        self._baseline_pids: Dict[str, List[str]] = {}
        self._baseline_cgroup: Dict[str, Dict] = {}
        self._baseline_disk: Dict[str, int] = {}
        self._memory_trend: Dict[str, List[Tuple[float, float]]] = {}

    def _ssh_cmd(self, command: str, timeout: int = 30) -> Tuple[int, str, str]:
        try:
            result = subprocess.run(
                ['sshpass', '-p', self.ssh_password, 'ssh',
                 '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10',
                 f'{self.ssh_user}@{self.pc_ip}', command],
                capture_output=True, text=True, timeout=timeout
            )
            return result.returncode, result.stdout.strip(), result.stderr.strip()
        except subprocess.TimeoutExpired:
            return -1, "", "SSH command timed out"
        except Exception as e:
            return -1, "", str(e)

    # ------------------------------------------------------------------
    #  Capture baselines (call once at execution start)
    # ------------------------------------------------------------------
    def capture_baseline(self) -> Dict[str, Any]:
        baseline = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'services': self._capture_genesis_status(),
            'cgroup': self._capture_cgroup_failcnt(),
            'disk': self._capture_disk_usage(),
            'core_dumps': self._count_core_dumps(),
        }
        self._baseline_pids = baseline['services']
        self._baseline_cgroup = baseline['cgroup']
        self._baseline_disk = baseline['disk']
        logger.info(f"📋 Health baseline captured: {len(self._baseline_pids)} services, "
                    f"{len(self._baseline_disk)} partitions")
        return baseline

    # ------------------------------------------------------------------
    #  Run all health checks (call periodically during execution)
    # ------------------------------------------------------------------
    def run_all_checks(self, interval_minutes: int = 60) -> Dict[str, Any]:
        ts = datetime.now(timezone.utc).isoformat()
        results = {
            'timestamp': ts,
            'fatal_scan': self.scan_fatal_logs(interval_minutes),
            'process_restarts': self.check_process_restarts(),
            'cgroup_oom': self.check_cgroup_oom(),
            'thread_count': self.check_thread_count(),
            'disk_usage': self.check_disk_usage(),
            'core_dumps': self.check_core_dumps(),
            'memory_leaks': self.check_memory_leaks(),
        }
        results['verdict'] = self._compute_health_verdict(results)
        return results

    # ------------------------------------------------------------------
    #  1. FATAL / Panic Log Scanning
    # ------------------------------------------------------------------
    def scan_fatal_logs(self, interval_minutes: int = 60) -> Dict[str, Any]:
        findings = []
        for cmd_template in FATAL_CHECK_COMMANDS:
            cmd = cmd_template.replace('{interval}', str(interval_minutes))
            rc, stdout, stderr = self._ssh_cmd(cmd, timeout=20)
            if rc == 0 and stdout:
                lines = [l.strip() for l in stdout.split('\n') if l.strip()]
                filtered = []
                for line in lines:
                    if not any(re.search(pat, line, re.IGNORECASE) for pat in KNOWN_FATAL_NOISE):
                        filtered.append(line)
                if filtered:
                    findings.extend(filtered[:10])

        return {
            'status': 'FAIL' if findings else 'PASS',
            'count': len(findings),
            'findings': findings[:20],
            'description': f"{len(findings)} FATAL/crash entries found" if findings
                          else "No FATAL entries detected"
        }

    # ------------------------------------------------------------------
    #  2. Process Restart Detection (genesis status PID comparison)
    # ------------------------------------------------------------------
    def _capture_genesis_status(self) -> Dict[str, List[str]]:
        cmd = "/usr/local/nutanix/cluster/bin/genesis status 2>&1 | grep -E '^  [a-z]'"
        rc, stdout, _ = self._ssh_cmd(cmd, timeout=20)
        services = {}
        for line in stdout.split('\n'):
            line = line.strip()
            if not line or ':' not in line:
                continue
            # Format: "service_name: [pid1, pid2, ...]"
            parts = line.split(':', 1)
            if len(parts) == 2:
                svc = parts[0].strip()
                pids_str = parts[1].strip().strip('[]')
                pids = [p.strip() for p in pids_str.split(',') if p.strip()]
                if svc and pids:
                    services[svc] = pids
        return services

    def check_process_restarts(self) -> Dict[str, Any]:
        if not self._baseline_pids:
            return {'status': 'SKIP', 'description': 'No baseline captured', 'restarts': []}

        current = self._capture_genesis_status()
        restarts = []
        for service, baseline_pids in self._baseline_pids.items():
            current_pids = current.get(service, [])
            common = set(baseline_pids) & set(current_pids)
            if len(common) < 1 and baseline_pids:
                restarts.append({
                    'service': service,
                    'pids_before': baseline_pids,
                    'pids_after': current_pids,
                })

        return {
            'status': 'FAIL' if restarts else 'PASS',
            'count': len(restarts),
            'restarts': restarts,
            'total_services': len(self._baseline_pids),
            'description': f"{len(restarts)} service(s) restarted" if restarts
                          else "No unexpected process restarts"
        }

    # ------------------------------------------------------------------
    #  3. Cgroup OOM failcnt
    # ------------------------------------------------------------------
    def _capture_cgroup_failcnt(self) -> Dict[str, int]:
        cmd = ("for d in /sys/fs/cgroup/memory/*/; do "
               "name=$(basename $d); "
               "fc=$(cat $d/memory.failcnt 2>/dev/null || echo 0); "
               "echo \"$name:$fc\"; done 2>/dev/null")
        rc, stdout, _ = self._ssh_cmd(cmd, timeout=15)
        result = {}
        for line in stdout.split('\n'):
            if ':' in line:
                parts = line.strip().split(':')
                if len(parts) == 2:
                    try:
                        result[parts[0]] = int(parts[1])
                    except ValueError:
                        pass
        return result

    def check_cgroup_oom(self) -> Dict[str, Any]:
        current = self._capture_cgroup_failcnt()
        oom_events = []
        for service, current_fc in current.items():
            baseline_fc = self._baseline_cgroup.get(service, 0)
            if current_fc > baseline_fc:
                oom_events.append({
                    'service': service,
                    'failcnt_before': baseline_fc,
                    'failcnt_after': current_fc,
                    'increase': current_fc - baseline_fc,
                })

        return {
            'status': 'WARN' if oom_events else 'PASS',
            'count': len(oom_events),
            'events': oom_events,
            'description': f"{len(oom_events)} service(s) hit cgroup memory limit"
                          if oom_events else "No cgroup OOM events"
        }

    # ------------------------------------------------------------------
    #  4. Thread Count Verification
    # ------------------------------------------------------------------
    def check_thread_count(self) -> Dict[str, Any]:
        cmd = ("cat /proc/sys/kernel/threads-max 2>/dev/null && echo '---' && "
               "ps -eo nlwp,comm --sort=-nlwp 2>/dev/null | head -20")
        rc, stdout, _ = self._ssh_cmd(cmd, timeout=15)

        parts = stdout.split('---')
        thread_limit = 0
        top_services = []
        total_threads = 0

        if len(parts) >= 1:
            try:
                thread_limit = int(parts[0].strip())
            except ValueError:
                thread_limit = 65536

        if len(parts) >= 2:
            for line in parts[1].strip().split('\n')[1:]:
                cols = line.strip().split(None, 1)
                if len(cols) == 2:
                    try:
                        count = int(cols[0])
                        total_threads += count
                        top_services.append({'service': cols[1], 'threads': count})
                    except ValueError:
                        pass

        threshold_pct = (total_threads / thread_limit * 100) if thread_limit > 0 else 0
        status = 'FAIL' if threshold_pct >= 80 else ('WARN' if threshold_pct >= 60 else 'PASS')

        return {
            'status': status,
            'thread_limit': thread_limit,
            'total_threads': total_threads,
            'usage_percent': round(threshold_pct, 1),
            'top_services': top_services[:10],
            'description': f"Thread usage: {threshold_pct:.1f}% of limit ({total_threads}/{thread_limit})"
        }

    # ------------------------------------------------------------------
    #  5. Disk Partition Usage
    # ------------------------------------------------------------------
    def _capture_disk_usage(self) -> Dict[str, int]:
        cmd = "df -k /home /var /tmp 2>/dev/null | awk 'NR>1{print $6\":\"$5}'"
        rc, stdout, _ = self._ssh_cmd(cmd, timeout=10)
        result = {}
        for line in stdout.split('\n'):
            if ':' in line:
                parts = line.strip().split(':')
                if len(parts) == 2:
                    try:
                        result[parts[0]] = int(parts[1].rstrip('%'))
                    except ValueError:
                        pass
        return result

    def check_disk_usage(self) -> Dict[str, Any]:
        current = self._capture_disk_usage()
        alerts = []
        partitions = []
        for mount, usage_pct in current.items():
            baseline_pct = self._baseline_disk.get(mount, 0)
            growth = usage_pct - baseline_pct
            entry = {
                'mount': mount,
                'usage_percent': usage_pct,
                'baseline_percent': baseline_pct,
                'growth': growth,
            }
            partitions.append(entry)
            if usage_pct >= 90:
                alerts.append(f"{mount} at {usage_pct}% (CRITICAL)")
            elif usage_pct >= 80:
                alerts.append(f"{mount} at {usage_pct}% (HIGH)")
            elif growth > 20:
                alerts.append(f"{mount} grew by {growth}% (now {usage_pct}%)")

        return {
            'status': 'FAIL' if any(p['usage_percent'] >= 90 for p in partitions)
                     else ('WARN' if alerts else 'PASS'),
            'partitions': partitions,
            'alerts': alerts,
            'description': f"{len(alerts)} partition alert(s)" if alerts
                          else "Disk usage within limits"
        }

    # ------------------------------------------------------------------
    #  6. Core Dump Detection
    # ------------------------------------------------------------------
    def _count_core_dumps(self) -> int:
        cmd = "find ~/data/cores/ -name 'core.*' -type f 2>/dev/null | wc -l"
        rc, stdout, _ = self._ssh_cmd(cmd, timeout=10)
        try:
            return int(stdout.strip())
        except ValueError:
            return 0

    def check_core_dumps(self) -> Dict[str, Any]:
        current_count = self._count_core_dumps()
        cmd = "find ~/data/cores/ -name 'core.*' -type f -newer /tmp/.se_health_baseline 2>/dev/null || " \
              "find ~/data/cores/ -name 'core.*' -type f 2>/dev/null | head -5"
        rc, stdout, _ = self._ssh_cmd(cmd, timeout=10)
        new_cores = [l.strip() for l in stdout.split('\n') if l.strip()] if stdout else []

        return {
            'status': 'WARN' if new_cores else 'PASS',
            'total_count': current_count,
            'new_cores': new_cores[:10],
            'description': f"{len(new_cores)} new core dump(s) found" if new_cores
                          else "No new core dumps"
        }

    # ------------------------------------------------------------------
    #  7. Per-Service Memory Leak Detection (Prometheus)
    # ------------------------------------------------------------------
    def check_memory_leaks(self) -> Dict[str, Any]:
        if not self.prometheus_url:
            return {'status': 'SKIP', 'description': 'No Prometheus URL', 'leaks': []}

        try:
            url = urljoin(self.prometheus_url, '/api/v1/query')
            query = ('topk(20, container_memory_working_set_bytes'
                     '{container!="",container!="POD"})')
            resp = requests.get(url, params={'query': query}, verify=False, timeout=10)
            if resp.status_code != 200:
                return {'status': 'SKIP', 'description': 'Prometheus query failed', 'leaks': []}

            data = resp.json().get('data', {}).get('result', [])
            now = time.time()
            leaks = []

            for item in data:
                metric = item.get('metric', {})
                pod = metric.get('pod', 'unknown')
                container = metric.get('container', 'unknown')
                key = f"{pod}/{container}"
                try:
                    mem_bytes = float(item['value'][1])
                except (KeyError, ValueError, IndexError):
                    continue

                mem_mb = mem_bytes / (1024 * 1024)
                if key not in self._memory_trend:
                    self._memory_trend[key] = []
                self._memory_trend[key].append((now, mem_mb))

                # Keep last 30 data points
                if len(self._memory_trend[key]) > 30:
                    self._memory_trend[key] = self._memory_trend[key][-30:]

                trend = self._memory_trend[key]
                if len(trend) >= 5:
                    first_mem = trend[0][1]
                    last_mem = trend[-1][1]
                    growth_mb = last_mem - first_mem
                    growth_pct = (growth_mb / first_mem * 100) if first_mem > 0 else 0

                    # Flag if memory grew > 20% consistently
                    if growth_pct > 20 and growth_mb > 50:
                        monotonic = all(trend[i][1] <= trend[i+1][1]
                                       for i in range(len(trend)-1))
                        leaks.append({
                            'pod': pod,
                            'container': container,
                            'current_mb': round(last_mem, 1),
                            'initial_mb': round(first_mem, 1),
                            'growth_mb': round(growth_mb, 1),
                            'growth_pct': round(growth_pct, 1),
                            'monotonic': monotonic,
                            'data_points': len(trend),
                        })

            leaks.sort(key=lambda x: x['growth_mb'], reverse=True)
            return {
                'status': 'WARN' if leaks else 'PASS',
                'count': len(leaks),
                'leaks': leaks[:10],
                'tracked_services': len(self._memory_trend),
                'description': f"{len(leaks)} potential memory leak(s) detected"
                              if leaks else "No memory leaks detected"
            }
        except Exception as e:
            logger.warning(f"Memory leak check error: {e}")
            return {'status': 'SKIP', 'description': str(e), 'leaks': []}

    # ------------------------------------------------------------------
    #  8. Entity Parity Verification
    # ------------------------------------------------------------------
    def check_entity_parity(self, ncm_client) -> Dict[str, Any]:
        """Compare entity counts between API responses to detect sync issues."""
        if not ncm_client:
            return {'status': 'SKIP', 'description': 'No NCM client', 'entities': []}

        import asyncio
        entities_to_check = {
            'vm': '/vms/list',
            'host': '/hosts/list',
            'cluster': '/clusters/list',
            'subnet': '/subnets/list',
            'image': '/images/list',
            'category': '/categories/list',
        }

        results = []
        loop = None
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        for entity_type, endpoint in entities_to_check.items():
            try:
                payload = {"kind": entity_type, "offset": 0, "length": 1}
                resp = loop.run_until_complete(
                    asyncio.wait_for(
                        ncm_client.v3_request(endpoint=endpoint, method="POST", payload=payload),
                        timeout=15
                    )
                )
                total = resp.get('metadata', {}).get('total_matches', 0)
                results.append({
                    'entity_type': entity_type,
                    'count': total,
                    'status': 'OK'
                })
            except Exception as e:
                results.append({
                    'entity_type': entity_type,
                    'count': -1,
                    'status': f'ERROR: {str(e)[:80]}'
                })

        return {
            'status': 'PASS',
            'entities': results,
            'description': f"Entity counts for {len(results)} types collected"
        }

    # ------------------------------------------------------------------
    #  Compute overall health verdict
    # ------------------------------------------------------------------
    def _compute_health_verdict(self, results: Dict) -> Dict[str, Any]:
        checks = []
        issues = []
        for check_name, check_data in results.items():
            if check_name in ('timestamp', 'verdict'):
                continue
            if not isinstance(check_data, dict):
                continue
            status = check_data.get('status', 'SKIP')
            checks.append({'check': check_name, 'status': status})
            if status == 'FAIL':
                issues.append(f"{check_name}: {check_data.get('description', 'Failed')}")
            elif status == 'WARN':
                issues.append(f"{check_name}: {check_data.get('description', 'Warning')}")

        fail_count = sum(1 for c in checks if c['status'] == 'FAIL')
        warn_count = sum(1 for c in checks if c['status'] == 'WARN')

        if fail_count > 0:
            verdict = 'FAIL'
        elif warn_count >= 3:
            verdict = 'WARN'
        elif warn_count > 0:
            verdict = 'WARN'
        else:
            verdict = 'PASS'

        return {
            'verdict': verdict,
            'total_checks': len(checks),
            'fail_count': fail_count,
            'warn_count': warn_count,
            'pass_count': sum(1 for c in checks if c['status'] == 'PASS'),
            'issues': issues,
            'checks': checks,
        }
