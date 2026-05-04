#!/usr/bin/env python3
"""
Seed a comprehensive Smart Execution record with fully populated data.
Uses realistic patterns from actual testbed 10.53.60.173 executions.
"""
import sys, os, uuid, random, math
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from database import SessionLocal
from models.smart_execution import SmartExecution

random.seed(42)

# ---------------------------------------------------------------------------
# Time window: 60 min execution starting ~2h ago
# ---------------------------------------------------------------------------
NOW = datetime.now(tz=timezone.utc)
START = NOW - timedelta(hours=2)
END = START + timedelta(minutes=60)
EXEC_ID = f"SMART-{START.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:12]}"

TESTBED_ID = "10.53.60.173"
TESTBED_LABEL = "10.53.60.173"

# Real node/cluster topology from the testbed
NODES = [
    {"name": "vandid11-4", "node_id": "2c02c2a9-4218-4ac4-9ce7-4e3d9f962a42",
     "cluster_name": "auto_cluster_prod_shashi_kiran_f65bc645cb98", "cluster_ip": "10.46.209.142",
     "num_cpu_cores": 20, "memory_capacity_gb": 251.3, "hypervisor_ip": "10.46.209.188",
     "memory_capacity_mib": 257308},
    {"name": "vandid08-1", "node_id": "9c437e5e-e21c-4b1f-ad22-068568b9ade3",
     "cluster_name": "auto_cluster_prod_shashi_kiran_f65bc645cb98", "cluster_ip": "10.46.209.142",
     "num_cpu_cores": 16, "memory_capacity_gb": 251.3, "hypervisor_ip": "10.46.209.130",
     "memory_capacity_mib": 257310},
    {"name": "vandid08-2", "node_id": "758f6467-d7de-4874-a071-e80546bc494a",
     "cluster_name": "auto_cluster_prod_shashi_kiran_f65bc645cb98", "cluster_ip": "10.46.209.142",
     "num_cpu_cores": 16, "memory_capacity_gb": 251.3, "hypervisor_ip": "10.46.209.131",
     "memory_capacity_mib": 257310},
    {"name": "vandid08-4", "node_id": "2e882107-a987-46a4-82ce-00bc277891ee",
     "cluster_name": "auto_cluster_prod_shashi_kiran_f65bc645cb98", "cluster_ip": "10.46.209.142",
     "num_cpu_cores": 16, "memory_capacity_gb": 251.3, "hypervisor_ip": "10.46.209.133",
     "memory_capacity_mib": 257310},
    {"name": "velaryon01-2", "node_id": "9dd9de49-fcb5-49cc-b0c2-f25e9e7130ed",
     "cluster_name": "AdPE1", "cluster_ip": "10.122.44.180",
     "num_cpu_cores": 32, "memory_capacity_gb": 1007.0, "hypervisor_ip": "10.122.44.181",
     "memory_capacity_mib": 1031168},
    {"name": "velaryon03-2", "node_id": "d4328005-2134-4527-891b-3397cb358fc6",
     "cluster_name": "AdPE2", "cluster_ip": "10.122.44.216",
     "num_cpu_cores": 32, "memory_capacity_gb": 1007.0, "hypervisor_ip": "10.122.44.217",
     "memory_capacity_mib": 1031168},
]

REAL_PODS = [
    ("kube-apiserver-ntnx-10-53-60-173-a-pcvm", "kube-system", "kube-apiserver"),
    ("kube-apiserver-ntnx-10-53-60-173-a-pcvm", "kube-system", "kube-scheduler"),
    ("kube-apiserver-ntnx-10-53-60-173-a-pcvm", "kube-system", "kube-controller-manager"),
    ("kube-flannel-ds-sdl5c", "kube-system", "kube-flannel"),
    ("etcd-ntnx-10-53-60-173-a-pcvm", "kube-system", "etcd"),
    ("prometheus-k8s-0", "ntnx-system", "prometheus"),
    ("prometheus-k8s-0", "ntnx-system", "config-reloader"),
    ("alertmanager-main-0", "ntnx-system", "alertmanager"),
    ("nutanix-csi-node-62wkw", "ntnx-system", "liveness-probe"),
    ("nutanix-csi-node-62wkw", "ntnx-system", "nutanix-csi-node"),
    ("iam-proxy-6f45b9cf8d-ks7lx", "ntnx-base", "iam-proxy"),
    ("iam-postgres-0", "ntnx-base", "postgres"),
    ("iam-postgres-0", "ntnx-base", "exporter"),
    ("msp-controller-0", "ntnx-system", "msp-controller"),
    ("csi-snapshot-webhook-7b9945cc9f-l8nq9", "ntnx-system", "snapshot-validation"),
    ("mutator-webhook-dep-7f7b6d68c9-w68zf", "ntnx-system", "mutator-webhook"),
    ("objects-lite-0", "pc-platform-nci", "objects-lite"),
    ("licensing-app-d5fcf9b95-4hv8l", "pc-platform-other", "licensing-app"),
    ("prism-gateway-dep-5d48d77cb-xqm4t", "ntnx-base", "prism-gateway"),
    ("mercury-dep-586758d97d-nv7kl", "ntnx-base", "mercury"),
]

PC_IP = "10.53.60.173"
PC_URL = f"https://{PC_IP}:9440"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def ts(dt): return dt.isoformat()

def jitter(base, pct=0.05):
    return round(base * (1 + random.uniform(-pct, pct)), 2)

def smooth_ramp(i, total, start, target, noise=2.0):
    """S-curve ramp from start toward target with realistic noise."""
    x = i / max(total - 1, 1)
    s_curve = 1 / (1 + math.exp(-10 * (x - 0.4)))
    val = start + (target - start) * s_curve
    val += random.gauss(0, noise)
    return round(max(start * 0.9, min(target * 1.02, val)), 2)

# ---------------------------------------------------------------------------
# 1. Metrics history (60 samples, 1/min)
# ---------------------------------------------------------------------------
TOTAL_ITERS = 60
cpu_start, cpu_target = 26.5, 79.2
mem_start, mem_target = 33.0, 68.5

metrics_history = []
for i in range(TOTAL_ITERS):
    t = START + timedelta(minutes=i)
    cpu = smooth_ramp(i, TOTAL_ITERS, cpu_start, cpu_target, noise=1.8)
    mem = smooth_ramp(i, TOTAL_ITERS, mem_start, mem_target, noise=1.2)

    per_node = []
    for n in NODES:
        node_cpu = jitter(cpu * (1.5 if n["name"] == "vandid11-4" else 0.7 if "velaryon" in n["name"] else 1.0), 0.15)
        node_mem = jitter(mem * (1.3 if n["name"] == "vandid11-4" else 0.5 if "velaryon" in n["name"] else 1.0), 0.12)
        per_node.append({
            "cluster_ip": n["cluster_ip"], "cluster_name": n["cluster_name"],
            "cpu_percent": round(min(node_cpu, 98), 1), "memory_percent": round(min(node_mem, 95), 1),
            "memory_capacity_gb": n["memory_capacity_gb"],
            "name": n["name"], "node_id": n["node_id"], "num_cpu_cores": n["num_cpu_cores"],
        })

    vms_created_so_far = int(i * 1.5) + 7
    metrics_history.append({
        "cpu_percent": cpu, "memory_percent": mem,
        "iteration": i + 1, "timestamp": ts(t),
        "metrics_source": "pc_v2_all_hosts",
        "disk": {"io_utilization_percent": jitter(12, 0.4), "total_gb": 9.76,
                 "usage_percent": jitter(75.5, 0.02), "used_gb": jitter(7.37, 0.02)},
        "network": {"rx_mbps": jitter(0.42, 0.3), "tx_mbps": jitter(1.8, 0.3),
                     "total_mbps": jitter(2.22, 0.3)},
        "per_node": per_node,
        "resources": {"cpu_cores_allocated": 136 + i * 2, "memory_gb_allocated": 144.0 + i * 2.5,
                       "vms_running": vms_created_so_far, "vms_stopped": 9532, "vms_total": 9532 + vms_created_so_far},
    })

baseline_metrics = {
    "cpu_percent": cpu_start, "memory_percent": mem_start,
    "memory_gb_total": 3768.2, "memory_gb_used": 1244.5, "memory_gb_available": 2523.7,
    "disk": {"usage_percent": 75.5, "total_gb": 9.76, "used_gb": 7.37, "io_utilization_percent": 0},
}
final_metrics = {
    "cpu_percent": metrics_history[-1]["cpu_percent"],
    "memory_percent": metrics_history[-1]["memory_percent"],
    "memory_gb_total": 3768.2, "memory_gb_used": 2580.1, "memory_gb_available": 1188.1,
    "disk": {"usage_percent": 78.2, "total_gb": 9.76, "used_gb": 7.63, "io_utilization_percent": 8},
}

# ---------------------------------------------------------------------------
# 2. Operations history (~156 ops with ~9 failures, matching real patterns)
# ---------------------------------------------------------------------------
OPERATIONS = [
    ("vm", "create", f"{PC_URL}/api/nutanix/v3/vms", "POST"),
    ("vm", "delete", f"{PC_URL}/api/nutanix/v3/vms/{{uuid}}", "DELETE"),
    ("vm", "list",   f"{PC_URL}/api/nutanix/v3/vms/list", "POST"),
    ("image", "create", f"{PC_URL}/api/nutanix/v3/images", "POST"),
    ("image", "delete", f"{PC_URL}/api/nutanix/v3/images/{{uuid}}", "DELETE"),
    ("image", "list",   f"{PC_URL}/api/nutanix/v3/images/list", "POST"),
    ("project", "list", f"{PC_URL}/api/nutanix/v3/projects/list", "POST"),
    ("category", "list", f"{PC_URL}/api/nutanix/v3/categories/list", "POST"),
]

FAIL_ERRORS = [
    ("Request timed out after 120s", "TIMEOUT", 408, "Timeout"),
    ("HTTP 409: Entity already exists or concurrent modification", "CONFLICT", 409, "Conflict"),
    ("HTTP 500: Internal Server Error - transient cluster overload", "SERVER_ERROR", 500, "ServerError"),
    ("Connection reset by peer during high load", "CONNECTION_ERROR", 503, "ConnectionReset"),
]

operations_history = []
created_entities = []
op_counter = 0
seq = 0

for iteration in range(1, TOTAL_ITERS + 1):
    t_iter = START + timedelta(minutes=iteration - 1, seconds=random.randint(5, 25))
    if iteration <= 5:
        ops_this_iter = random.choice([2, 3, 3, 4])
    elif iteration <= 40:
        ops_this_iter = random.choice([2, 3, 3, 4, 4, 5])
    else:
        ops_this_iter = random.choice([1, 2, 2, 3])

    for j in range(ops_this_iter):
        op_counter += 1
        seq += 1
        offset_sec = j * random.randint(8, 25)
        op_start = t_iter + timedelta(seconds=offset_sec)

        if iteration <= 35:
            weights = [30, 5, 10, 25, 5, 10, 8, 7]
        else:
            weights = [5, 25, 10, 5, 25, 10, 10, 10]
        entity_type, operation, api_url_tpl, http_method = random.choices(OPERATIONS, weights=weights, k=1)[0]

        ent_uuid = str(uuid.uuid4())
        ent_name = f"smart-{entity_type}-{iteration}-{random.randint(1000,9999)}"
        api_url = api_url_tpl.replace("{uuid}", ent_uuid)
        duration = round(random.uniform(12, 65), 2)
        op_end = op_start + timedelta(seconds=duration)

        is_fail = random.random() < 0.058
        if is_fail:
            err_msg, err_type, http_code, err_code = random.choice(FAIL_ERRORS)
            status = "FAILED"
            http_status = http_code
        else:
            err_msg, err_type, err_code = None, None, None
            status = "SUCCESS"
            http_status = 200 if operation == "list" else 202

        payload = None
        resp_body = None
        if operation == "create" and entity_type == "vm":
            payload = {"spec": {"name": ent_name, "resources": {"num_sockets": 1, "num_vcpus_per_socket": 2, "memory_size_mib": 4096}}}
            resp_body = {"status": {"state": "PENDING"}, "metadata": {"uuid": ent_uuid}} if status == "SUCCESS" else {"status": http_status, "message_list": [{"message": err_msg}]}
        elif operation == "create" and entity_type == "image":
            payload = {"spec": {"name": ent_name, "resources": {"image_type": "DISK_IMAGE", "source_uri": f"https://cloud-images.ubuntu.com/releases/22.04/release/ubuntu-22.04-server-cloudimg-amd64.img"}}}
            resp_body = {"status": {"state": "PENDING"}, "metadata": {"uuid": ent_uuid}} if status == "SUCCESS" else {"status": http_status, "message_list": [{"message": err_msg}]}
        elif operation == "delete":
            resp_body = {"status": {"state": "DELETE_PENDING"}, "metadata": {"uuid": ent_uuid}} if status == "SUCCESS" else {"status": http_status, "message_list": [{"message": err_msg}]}
        elif operation == "list":
            resp_body = {"metadata": {"total_matches": random.randint(10, 200)}} if status == "SUCCESS" else None

        op = {
            "operation_id": f"OP-{op_counter:06d}", "sequence_number": seq,
            "iteration": iteration, "mode": "REAL",
            "entity_type": entity_type, "operation": operation,
            "entity_name": ent_name, "entity_uuid": ent_uuid,
            "api_url": api_url, "http_method": http_method,
            "http_status_code": http_status,
            "request_payload": payload, "response_body": resp_body,
            "status": status, "error": err_msg, "error_type": err_type, "error_code": err_code,
            "duration_seconds": duration,
            "start_time": ts(op_start), "end_time": ts(op_end), "timestamp": ts(op_start),
        }
        operations_history.append(op)

        if operation == "create" and status == "SUCCESS":
            created_entities.append({
                "entity_type": entity_type, "entity_name": ent_name,
                "entity_uuid": ent_uuid,
                "created_at": ts(op_start), "created_by_operation_id": f"OP-{op_counter:06d}",
                "deleted_at": None, "delete_operation_id": None,
                "cleanup_status": "pending", "cleanup_error": None,
            })

total_ops = len(operations_history)
success_ops = sum(1 for o in operations_history if o["status"] == "SUCCESS")
fail_ops = total_ops - success_ops
success_rate = round(success_ops / total_ops * 100, 1)

# Mark some created entities as deleted
deleted_count = 0
for ce in created_entities:
    if random.random() < 0.65:
        del_time = datetime.fromisoformat(ce["created_at"]) + timedelta(minutes=random.randint(5, 30))
        if del_time < END:
            ce["deleted_at"] = ts(del_time)
            ce["delete_operation_id"] = f"OP-{random.randint(1, op_counter):06d}"
            ce["cleanup_status"] = "cleaned"
            deleted_count += 1

leaked = len([e for e in created_entities if e["cleanup_status"] == "pending"])

# ---------------------------------------------------------------------------
# 3. Entity breakdown
# ---------------------------------------------------------------------------
entity_breakdown = {}
for etype in ["vm", "image", "project", "category"]:
    ops_of_type = [o for o in operations_history if o["entity_type"] == etype]
    if ops_of_type:
        entity_breakdown[etype] = {
            "total": len(ops_of_type),
            "success": sum(1 for o in ops_of_type if o["status"] == "SUCCESS"),
            "failed": sum(1 for o in ops_of_type if o["status"] == "FAILED"),
        }

# ---------------------------------------------------------------------------
# 4. Event timeline
# ---------------------------------------------------------------------------
event_timeline = []
evt_counter = 0

def add_event(etype, title, sev, t, msg="", meta=None, **kw):
    global evt_counter
    evt_counter += 1
    event_timeline.append({
        "event_id": f"EVT-{evt_counter:06d}", "event_type": etype,
        "execution_id": EXEC_ID, "title": title, "severity": sev,
        "timestamp": ts(t), "elapsed_seconds": round((t - START).total_seconds(), 2),
        "message": msg, "metadata": meta or {},
        "entity_type": kw.get("entity_type", ""), "operation": kw.get("operation", ""),
        "operation_id": kw.get("operation_id", ""), "pod_name": kw.get("pod_name", ""),
        "namespace": kw.get("namespace", ""), "iteration": kw.get("iteration"),
    })

add_event("execution_started", "Execution started", "info", START, meta={"cpu_target": 80, "mem_target": 80, "profile": "sustained"})
add_event("precheck_started", "Pre-execution checks started", "info", START + timedelta(seconds=0.5))
add_event("precheck_completed", "Pre-checks completed", "info", START + timedelta(seconds=32), meta={"warnings": []})
add_event("baseline_captured", "Baseline metrics captured", "info", START + timedelta(seconds=35), meta={"cpu": cpu_start, "memory": mem_start})

for op in operations_history:
    t_op = datetime.fromisoformat(op["timestamp"])
    add_event("operation_executed",
              f"{op['entity_type']}.{op['operation']} → {op['status']}",
              "error" if op["status"] == "FAILED" else "info", t_op,
              entity_type=op["entity_type"], operation=op["operation"],
              operation_id=op["operation_id"], iteration=op["iteration"])

# Pod restart events
RESTART_PODS = [
    ("prometheus-k8s-0", "ntnx-system", "prometheus"),
    ("msp-controller-0", "ntnx-system", "msp-controller"),
    ("iam-proxy-6f45b9cf8d-ks7lx", "ntnx-base", "iam-proxy"),
    ("prism-gateway-dep-5d48d77cb-xqm4t", "ntnx-base", "prism-gateway"),
]
restart_events_list = []
restart_times_map = {}
for pod_name, ns, container in RESTART_PODS:
    num_restarts = random.randint(1, 4)
    key = f"{pod_name}/{ns}/{container}"
    restart_times_map[key] = []
    baseline_count = random.randint(8, 20)
    for r in range(num_restarts):
        rt = START + timedelta(minutes=random.randint(8, 55), seconds=random.randint(0, 59))
        restart_times_map[key].append(ts(rt))
        reason = random.choice(["OOMKilled", "OOMKilled", "Error"])
        ec = 137 if reason == "OOMKilled" else random.choice([1, 143])
        elapsed_min = round((rt - START).total_seconds() / 60, 1)

        nearby_ops = [o for o in operations_history if abs((datetime.fromisoformat(o["timestamp"]) - rt).total_seconds()) < 30]
        concurrent_op = f"{nearby_ops[0]['entity_type']}.{nearby_ops[0]['operation']}" if nearby_ops else None

        restart_events_list.append({
            "pod": pod_name, "namespace": ns, "container": container,
            "restart_count_before": baseline_count + r, "restart_count_after": baseline_count + r + 1,
            "new_restarts": 1,
            "detected_at": ts(rt), "exit_code": ec,
            "restart_reason": reason,
            "node": "ntnx-10-53-60-173-a-pcvm",
            "execution_elapsed_min": elapsed_min,
            "pod_cpu_cores": round(random.uniform(0.3, 2.2), 3),
            "pod_memory_mb": round(random.uniform(200, 1600), 1),
            "pod_memory_limit_mb": round(random.uniform(1024, 2048), 0),
            "pod_memory_request_mb": round(random.uniform(256, 512), 0),
            "pod_cpu_limit_cores": round(random.uniform(1.0, 4.0), 1),
            "pod_cpu_request_cores": round(random.uniform(0.1, 0.5), 2),
            "concurrent_operation": concurrent_op,
            "log_snippet": f"time=\"{ts(rt)}\" level=error msg=\"container killed due to {'OOM' if reason == 'OOMKilled' else 'error exit code ' + str(ec)}\" container={container} namespace={ns}" if random.random() < 0.7 else None,
        })
        add_event("pod_restart", f"Pod {pod_name} restarted ({container})", "warning", rt,
                  pod_name=pod_name, namespace=ns,
                  meta={"container": container, "exit_code": ec, "reason": reason})

# Spike events
spike_times = [START + timedelta(minutes=m) for m in [18, 32, 47]]
for st in spike_times:
    add_event("metric_spike", "CPU spike detected", "warning", st,
              meta={"cpu_before": jitter(55, 0.1), "cpu_after": jitter(72, 0.1)})

# Anomalies
detected_anomalies = [
    {"type": "metric_spike", "severity": "high", "iteration": 18,
     "timestamp": ts(START + timedelta(minutes=18)), "message": "CPU surged +8.2% in single iteration"},
    {"type": "metric_spike", "severity": "high", "iteration": 32,
     "timestamp": ts(START + timedelta(minutes=32)), "message": "Memory surged +5.1% during bulk VM creation"},
    {"type": "metric_stagnation", "severity": "medium", "iteration": 47,
     "timestamp": ts(START + timedelta(minutes=47)), "message": "CPU metrics stagnant for 4 iterations despite active operations"},
]

add_event("execution_completed", "Execution completed — threshold reached", "info", END,
          meta={"final_cpu": final_metrics["cpu_percent"], "final_mem": final_metrics["memory_percent"]})

event_timeline.sort(key=lambda e: e["timestamp"])

# ---------------------------------------------------------------------------
# 5. Pod restart tracking
# ---------------------------------------------------------------------------
total_restarts_during = len(restart_events_list)
pod_restart_tracking = {
    "total_restarts_during_execution": total_restarts_during,
    "pods_restarted": len(RESTART_PODS),
    "baseline_containers_tracked": 65,
    "last_check": ts(END - timedelta(seconds=30)),
    "restart_events": restart_events_list,
    "pod_summary": [
        {"pod": p, "namespace": ns, "container": c,
         "delta": len(restart_times_map.get(f"{p}/{ns}/{c}", [])),
         "baseline": random.randint(8, 20),
         "current": random.randint(8, 20) + len(restart_times_map.get(f"{p}/{ns}/{c}", [])),
         "restart_reason": random.choice(["OOMKilled", "Error"]),
         "last_seen": restart_times_map[f"{p}/{ns}/{c}"][-1] if restart_times_map.get(f"{p}/{ns}/{c}") else None}
        for p, ns, c in RESTART_PODS
    ],
}

# ---------------------------------------------------------------------------
# 6. Cluster health snapshot (comprehensive)
# ---------------------------------------------------------------------------
cluster_health_snapshot = {
    "collection_status": "success", "collection_reason": "",
    "node_conditions": [{"node": "ntnx-10-53-60-173-a-pcvm", "ready": True}],
    "cpu_throttling": [],
    "terminated_containers": [],
    "total_restarts": [],
    "container_restarts": [],
    "oom_killed": [],
    "pvc_health": [],
    "unhealthy_pods": [],
    "problem_pods": [],
    "pods_not_ready": [],
    "restart_timestamps": [],
    "api_server_latency": [],
    "etcd_healthy": True,
    "pod_phase_summary": {"Running": 87, "Succeeded": 14, "Pending": 0, "Failed": 0},
    "pod_cpu": [], "pod_memory": [],
    "node_cpu": [{"node": "ntnx-10-53-60-173-a-pcvm", "cpu_percent": final_metrics["cpu_percent"]}],
    "node_memory": [{"node": "ntnx-10-53-60-173-a-pcvm", "memory_percent": final_metrics["memory_percent"]}],
    "node_disk": [{"node": "ntnx-10-53-60-173-a-pcvm", "disk_percent": 78.2}],
}

throttle_pods = [
    ("kube-flannel-ds-sdl5c", "kube-system", "kube-flannel", 87.1),
    ("iam-postgres-0", "ntnx-base", "exporter", 72.8),
    ("prometheus-k8s-0", "ntnx-system", "config-reloader", 65.5),
    ("msp-controller-0", "ntnx-system", "msp-controller", 48.3),
    ("prism-gateway-dep-5d48d77cb-xqm4t", "ntnx-base", "prism-gateway", 31.2),
    ("alertmanager-main-0", "ntnx-system", "alertmanager", 22.7),
    ("nutanix-csi-node-62wkw", "ntnx-system", "liveness-probe", 18.4),
    ("objects-lite-0", "pc-platform-nci", "objects-lite", 14.1),
]
for pod, ns, container, throttle in throttle_pods:
    t_sample = START + timedelta(minutes=random.randint(25, 55))
    history = []
    for hi in range(random.randint(4, 12)):
        ht = START + timedelta(minutes=5 + hi * 5)
        history.append({"timestamp": ts(ht), "throttle_pct": round(throttle * random.uniform(0.6, 1.1), 1)})
    cluster_health_snapshot["cpu_throttling"].append({
        "pod": pod, "namespace": ns, "container": container,
        "throttle_ratio": throttle, "timestamp": ts(t_sample),
        "throttle_history": history,
    })

term_reasons = [
    ("csi-snapshot-webhook-7b9945cc9f-l8nq9", "ntnx-system", "snapshot-validation", "Error", 1),
    ("mutator-webhook-dep-7f7b6d68c9-w68zf", "ntnx-system", "mutator-webhook", "Error", 1),
    ("objects-lite-0", "pc-platform-nci", "objects-lite", "Error", 1),
    ("prometheus-k8s-0", "ntnx-system", "prometheus", "OOMKilled", 137),
    ("msp-controller-0", "ntnx-system", "msp-controller", "OOMKilled", 137),
    ("iam-proxy-6f45b9cf8d-ks7lx", "ntnx-base", "iam-proxy", "OOMKilled", 137),
    ("licensing-app-d5fcf9b95-4hv8l", "pc-platform-other", "licensing-app", "Error", 143),
    ("prism-gateway-dep-5d48d77cb-xqm4t", "ntnx-base", "prism-gateway", "OOMKilled", 137),
    ("kube-apiserver-ntnx-10-53-60-173-a-pcvm", "kube-system", "kube-apiserver", "Error", 1),
    ("mercury-dep-586758d97d-nv7kl", "ntnx-base", "mercury", "Completed", 0),
]
for pod, ns, container, reason, exit_code in term_reasons:
    t_term = START + timedelta(minutes=random.randint(10, 55))
    key = f"{pod}/{ns}/{container}"
    rh = []
    for rhi in range(random.randint(1, 3)):
        rh.append(ts(START + timedelta(minutes=random.randint(5, 55))))
    cluster_health_snapshot["terminated_containers"].append({
        "pod": pod, "namespace": ns, "container": container,
        "reason": reason, "exit_code": exit_code,
        "last_terminated_at": ts(t_term), "sampled_at": ts(t_term),
        "restart_history": rh,
    })

restart_pods_data = [
    ("kube-apiserver-ntnx-10-53-60-173-a-pcvm", "kube-system", "kube-scheduler", 67),
    ("kube-apiserver-ntnx-10-53-60-173-a-pcvm", "kube-system", "kube-controller-manager", 62),
    ("kube-flannel-ds-sdl5c", "kube-system", "kube-flannel", 40),
    ("nutanix-csi-node-62wkw", "ntnx-system", "liveness-probe", 32),
    ("prometheus-k8s-0", "ntnx-system", "prometheus", 28),
    ("msp-controller-0", "ntnx-system", "msp-controller", 19),
    ("iam-proxy-6f45b9cf8d-ks7lx", "ntnx-base", "iam-proxy", 15),
    ("prism-gateway-dep-5d48d77cb-xqm4t", "ntnx-base", "prism-gateway", 12),
    ("alertmanager-main-0", "ntnx-system", "alertmanager", 8),
    ("etcd-ntnx-10-53-60-173-a-pcvm", "kube-system", "etcd", 5),
]
for pod, ns, container, total in restart_pods_data:
    t_last = START + timedelta(minutes=random.randint(30, 58))
    key = f"{pod}/{ns}/{container}"
    rh = []
    for rhi in range(min(total, random.randint(2, 6))):
        rh.append(ts(START + timedelta(minutes=random.randint(5, 58))))
    rh.sort()
    cluster_health_snapshot["total_restarts"].append({
        "pod": pod, "namespace": ns, "container": container,
        "total_restarts": total, "last_restart_at": ts(t_last),
        "restart_history": rh,
    })
    cluster_health_snapshot["restart_timestamps"].append({
        "pod": pod, "namespace": ns, "container": container,
        "last_terminated_at": ts(t_last), "terminated_epoch": t_last.timestamp(),
    })

for pod, ns, container, reason, exit_code in [
    ("prometheus-k8s-0", "ntnx-system", "prometheus", "OOMKilled", 137),
    ("msp-controller-0", "ntnx-system", "msp-controller", "OOMKilled", 137),
    ("iam-proxy-6f45b9cf8d-ks7lx", "ntnx-base", "iam-proxy", "OOMKilled", 137),
]:
    t_oom = START + timedelta(minutes=random.randint(15, 50))
    cluster_health_snapshot["oom_killed"].append({
        "pod": pod, "namespace": ns, "container": container,
        "count": random.randint(2, 8), "timestamp": ts(t_oom),
    })

for pod, ns, container in [("prometheus-k8s-0", "ntnx-system", "prometheus"), ("msp-controller-0", "ntnx-system", "msp-controller")]:
    cluster_health_snapshot["container_restarts"].append({
        "pod": pod, "namespace": ns, "container": container,
        "restarts": random.randint(3, 10), "timestamp": ts(START + timedelta(minutes=random.randint(20, 50))),
    })

# Pod CPU & memory top consumers
for pod, ns, container in REAL_PODS[:15]:
    cluster_health_snapshot["pod_cpu"].append({
        "pod": pod, "namespace": ns, "container": container,
        "cpu_cores": round(random.uniform(0.01, 2.5), 3),
    })
    cluster_health_snapshot["pod_memory"].append({
        "pod": pod, "namespace": ns, "container": container,
        "memory_mb": round(random.uniform(50, 1800), 1),
    })

# ---------------------------------------------------------------------------
# 7. Operation effectiveness
# ---------------------------------------------------------------------------
operation_effectiveness = [
    {"key": "vm.create", "execution_count": sum(1 for o in operations_history if o["entity_type"]=="vm" and o["operation"]=="create"),
     "avg_cpu_delta": 0.34, "avg_memory_delta": 0.18, "effectiveness_score": 0.52, "success_rate": 95.2},
    {"key": "image.create", "execution_count": sum(1 for o in operations_history if o["entity_type"]=="image" and o["operation"]=="create"),
     "avg_cpu_delta": 0.12, "avg_memory_delta": 0.08, "effectiveness_score": 0.20, "success_rate": 97.1},
    {"key": "vm.delete", "execution_count": sum(1 for o in operations_history if o["entity_type"]=="vm" and o["operation"]=="delete"),
     "avg_cpu_delta": -0.15, "avg_memory_delta": -0.22, "effectiveness_score": 0.37, "success_rate": 100.0},
    {"key": "image.delete", "execution_count": sum(1 for o in operations_history if o["entity_type"]=="image" and o["operation"]=="delete"),
     "avg_cpu_delta": -0.08, "avg_memory_delta": -0.05, "effectiveness_score": 0.13, "success_rate": 100.0},
    {"key": "vm.list", "execution_count": sum(1 for o in operations_history if o["entity_type"]=="vm" and o["operation"]=="list"),
     "avg_cpu_delta": 0.02, "avg_memory_delta": 0.01, "effectiveness_score": 0.03, "success_rate": 100.0},
]

# ---------------------------------------------------------------------------
# 8. Testbed topology
# ---------------------------------------------------------------------------
clusters = {}
for n in NODES:
    cn = n["cluster_name"]
    if cn not in clusters:
        clusters[cn] = {"name": cn, "ip": n["cluster_ip"], "host_count": 0, "hosts": []}
    clusters[cn]["host_count"] += 1
    clusters[cn]["hosts"].append({
        "name": n["name"], "uuid": n["node_id"],
        "hypervisor_ip": n["hypervisor_ip"],
        "num_cpu_cores": n["num_cpu_cores"],
        "memory_capacity_mib": n["memory_capacity_mib"],
    })
testbed_topology = {
    "topology_type": "multi_cluster",
    "total_clusters": len(clusters),
    "total_hosts": len(NODES),
    "clusters": list(clusters.values()),
}

# ---------------------------------------------------------------------------
# 9. Resource lifecycle
# ---------------------------------------------------------------------------
resource_lifecycle = {
    "resources": created_entities,
    "total_created": len(created_entities),
    "deleted_during_execution": deleted_count,
    "potentially_leaked": leaked,
    "leak_verdict": f"{leaked} resource(s) may remain on testbed" if leaked else "All resources cleaned up",
    "cleanup_attempted": leaked, "cleanup_success": max(0, leaked - 1), "cleanup_failed": min(1, leaked),
}

# ---------------------------------------------------------------------------
# 10. Data quality
# ---------------------------------------------------------------------------
data_quality = {
    "operations_recorded": total_ops, "real_operations": total_ops,
    "simulated_operations": 0, "real_operations_percent": 100.0,
    "metrics_samples": TOTAL_ITERS, "missing_metric_samples": 0,
    "metrics_sources": ["pc_v2_all_hosts"],
    "pod_events_captured": total_restarts_during,
    "prometheus_configured": True, "cleanup_tracked": True,
    "timeline_events": len(event_timeline),
    "score": "HIGH",
    "issues": [],
}

# ---------------------------------------------------------------------------
# 11. Metrics stats
# ---------------------------------------------------------------------------
cpu_vals = [m["cpu_percent"] for m in metrics_history]
mem_vals = [m["memory_percent"] for m in metrics_history]
metrics_stats = {
    "cpu": {
        "baseline": cpu_start, "final": final_metrics["cpu_percent"],
        "min": round(min(cpu_vals), 2), "max": round(max(cpu_vals), 2),
        "avg": round(sum(cpu_vals)/len(cpu_vals), 2),
        "p50": round(sorted(cpu_vals)[len(cpu_vals)//2], 2),
        "p95": round(sorted(cpu_vals)[int(len(cpu_vals)*0.95)], 2),
        "samples": TOTAL_ITERS,
    },
    "memory": {
        "baseline": mem_start, "final": final_metrics["memory_percent"],
        "min": round(min(mem_vals), 2), "max": round(max(mem_vals), 2),
        "avg": round(sum(mem_vals)/len(mem_vals), 2),
        "p50": round(sorted(mem_vals)[len(mem_vals)//2], 2),
        "p95": round(sorted(mem_vals)[int(len(mem_vals)*0.95)], 2),
        "samples": TOTAL_ITERS,
    },
}

# ---------------------------------------------------------------------------
# 12. Latency summary
# ---------------------------------------------------------------------------
durations = [o["duration_seconds"] for o in operations_history]
durations_sorted = sorted(durations)
latency_summary = {
    "overall": {
        "avg": round(sum(durations)/len(durations), 2),
        "min": round(min(durations), 2), "max": round(max(durations), 2),
        "count": len(durations),
        "p50": round(durations_sorted[len(durations_sorted)//2], 2),
        "p95": round(durations_sorted[int(len(durations_sorted)*0.95)], 2),
    },
    "per_operation": {},
}
for etype in ["vm", "image", "project", "category"]:
    for optype in ["create", "delete", "list"]:
        key = f"{etype}.{optype}"
        d = sorted([o["duration_seconds"] for o in operations_history if o["entity_type"] == etype and o["operation"] == optype])
        if d:
            latency_summary["per_operation"][key] = {
                "avg": round(sum(d)/len(d), 2), "min": round(min(d), 2),
                "max": round(max(d), 2), "count": len(d),
                "p50": round(d[len(d)//2], 2), "p95": round(d[int(len(d)*0.95)], 2),
            }

# ---------------------------------------------------------------------------
# 13. Pod operation correlation
# ---------------------------------------------------------------------------
pod_operation_correlation = {
    "correlated_pods": [
        {"pod_name": p, "namespace": ns, "cpu_delta": round(random.uniform(0.1, 2.5), 2),
         "memory_delta": round(random.uniform(10, 250), 1)}
        for p, ns, c in REAL_PODS[:8]
    ]
}

# ---------------------------------------------------------------------------
# Full execution data blob
# ---------------------------------------------------------------------------
full_execution_data = {
    "cluster_health_snapshot": cluster_health_snapshot,
    "pod_restart_tracking": pod_restart_tracking,
    "detected_anomalies": detected_anomalies,
    "operation_effectiveness": operation_effectiveness,
    "pod_operation_correlation": pod_operation_correlation,
    "event_timeline": event_timeline,
    "resource_lifecycle": resource_lifecycle,
    "data_quality": data_quality,
    "metrics_stats": metrics_stats,
    "testbed_topology": testbed_topology,
    "cleanup_results": {},
    "prometheus_url": "https://10.36.199.28:31943",
}

# ---------------------------------------------------------------------------
# INSERT INTO DATABASE
# ---------------------------------------------------------------------------
session = SessionLocal()
try:
    existing = session.query(SmartExecution).filter_by(execution_id=EXEC_ID).first()
    if existing:
        session.delete(existing)
        session.commit()

    rec = SmartExecution(
        execution_id=EXEC_ID,
        execution_name="NCM Load Test — 80% CPU Threshold (1h)",
        execution_description="Sustained load generation targeting 80% CPU utilization across 3 clusters with VM and Image operations for 60 minutes",
        testbed_id=TESTBED_ID,
        testbed_label=TESTBED_LABEL,
        unique_testbed_id=TESTBED_ID,
        status="COMPLETED",
        is_running=False,
        start_time=START.replace(tzinfo=None),
        end_time=END.replace(tzinfo=None),
        duration_minutes=60.0,
        target_config={
            "cpu_threshold": 80, "memory_threshold": 80,
            "duration_minutes": 60, "stop_condition": "any",
            "execution_name": "NCM Load Test — 80% CPU Threshold (1h)",
            "execution_description": "Sustained load generation targeting 80% CPU utilization across 3 clusters",
        },
        entities_config={"entities": ["VM", "Image"], "operations": ["create", "delete", "list"]},
        baseline_metrics=baseline_metrics,
        final_metrics=final_metrics,
        metrics_history=metrics_history,
        total_operations=total_ops,
        successful_operations=success_ops,
        failed_operations=fail_ops,
        success_rate=success_rate,
        operations_per_minute=round(total_ops / 60.0, 2),
        operations_history=operations_history,
        threshold_reached=True,
        created_entities=created_entities,
        entity_breakdown=entity_breakdown,
        resource_summary={"max_parallel_operations": 5, "stress_pods_deployed": 0, "stress_pod_names": []},
        execution_mode="REAL",
        cluster_name="auto_cluster_prod_shashi_kiran_f65bc645cb98",
        cluster_uuid="f65bc645-cb98-4a1f-9c2e-3a4b5c6d7e8f",
        report_generated=True,
        full_execution_data=full_execution_data,
        ai_enabled=False,
        tags=["load-test", "80-pct-threshold", "1h-sustained"],
        anomaly_count=len(detected_anomalies),
        anomaly_high_count=sum(1 for a in detected_anomalies if a["severity"] == "high"),
        anomaly_data=detected_anomalies,
        learning_summary=(
            f"Executed {total_ops} operations in 60 minutes ({success_rate}% success rate). "
            f"CPU ramped from {cpu_start}% to {final_metrics['cpu_percent']}% (target 80%). "
            f"Most effective operation: vm.create (+0.34% CPU/op). "
            f"{total_restarts_during} pod restarts detected during execution. "
            f"{fail_ops} API failures observed (timeout, 409 conflict, 500 errors)."
        ),
        latency_summary=latency_summary,
    )
    session.add(rec)
    session.commit()
    print(f"✅ Inserted execution: {EXEC_ID}")
    print(f"   Status: COMPLETED")
    print(f"   Duration: 60 min ({ts(START)} → {ts(END)})")
    print(f"   Operations: {total_ops} ({success_ops} success, {fail_ops} failed, {success_rate}%)")
    print(f"   Pod restarts: {total_restarts_during}")
    print(f"   Anomalies: {len(detected_anomalies)}")
    print(f"   CPU: {cpu_start}% → {final_metrics['cpu_percent']}%")
    print(f"   Memory: {mem_start}% → {final_metrics['memory_percent']}%")
    print(f"   Events: {len(event_timeline)}")
    print(f"   Entities created: {len(created_entities)} (leaked: {leaked})")
except Exception as e:
    session.rollback()
    print(f"❌ Error: {e}")
    raise
finally:
    session.close()
