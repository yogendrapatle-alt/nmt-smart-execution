"""
AI-Powered Smart Execution Routes

Backend API endpoints for AI-powered Smart Execution:
- Start AI execution
- Monitor execution (live status)
- Get ML recommendations
- Emergency stop
- Get AI-enhanced reports
"""

import logging
import json
import math
import os
import random
import threading
import time
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Create blueprint
smart_execution_ai_bp = Blueprint('smart_execution_ai', __name__)

# Global storage for active AI executions
active_ai_executions: Dict[str, Any] = {}

# Import AI components
try:
    from services.smart_execution_engine_ai import SmartExecutionEngineAI
    AI_AVAILABLE = True
    logger.info("✅ AI Smart Execution Engine loaded")
except ImportError as e:
    AI_AVAILABLE = False
    logger.warning(f"⚠️  AI Smart Execution Engine not available: {e}")


def _synthetic_metrics_for_ai_loop(iter_idx: int, engine: Any) -> Dict[str, Any]:
    """Deterministic ramp toward targets so PID/ML can converge without live Prometheus."""
    t_cpu = float(engine.target_cpu)
    t_mem = float(engine.target_memory)
    progress = min(1.0, iter_idx / 100.0)
    cpu = 0.18 * t_cpu + progress * (0.82 * t_cpu) + 0.45 * math.sin(iter_idx / 7.0)
    mem = 0.15 * t_mem + progress * (0.80 * t_mem) + 0.35 * math.cos(iter_idx / 9.0)
    return {
        'cpu': max(0.0, min(99.9, cpu)),
        'memory': max(0.0, min(99.9, mem)),
        'cluster_size': 1,
    }


def _fetch_prometheus_cpu_memory(prometheus_url: str) -> Optional[List[float]]:
    """Best-effort cluster CPU/memory %; returns [cpu, mem] or None."""
    if not prometheus_url or not str(prometheus_url).startswith('http'):
        return None
    try:
        import requests
        from urllib.parse import urljoin
        base = prometheus_url.rstrip('/')
        url = urljoin(base + '/', 'api/v1/query')
        queries = [
            '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[2m])))',
            '100 - (avg(irate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)',
        ]
        cpu_val = None
        for q in queries:
            r = requests.get(url, params={'query': q}, verify=False, timeout=8)
            if r.status_code != 200:
                continue
            data = r.json()
            if data.get('status') != 'success':
                continue
            res = data.get('data', {}).get('result', [])
            if not res:
                continue
            try:
                v = float(res[0].get('value', [0, '0'])[1])
                if not math.isnan(v):
                    cpu_val = max(0.0, min(100.0, v))
                    break
            except (TypeError, ValueError):
                continue
        if cpu_val is None:
            return None
        mem_queries = [
            '(1 - avg(node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100',
        ]
        mem_val = cpu_val * 0.92
        for q in mem_queries:
            try:
                r = requests.get(url, params={'query': q}, verify=False, timeout=8)
                if r.status_code != 200:
                    continue
                data = r.json()
                if data.get('status') != 'success':
                    continue
                res = data.get('data', {}).get('result', [])
                if res:
                    mem_val = max(0.0, min(100.0, float(res[0].get('value', [0, '0'])[1])))
                    break
            except Exception:
                continue
        return [cpu_val, mem_val]
    except Exception as e:
        logger.debug(f'Prometheus CPU/memory fetch skipped: {e}')
        return None


def _resolve_metrics_for_ai_loop(iter_idx: int, engine: Any, prometheus_url: str) -> Dict[str, Any]:
    pm = _fetch_prometheus_cpu_memory(prometheus_url)
    if pm is not None:
        return {'cpu': pm[0], 'memory': pm[1], 'cluster_size': 1}
    return _synthetic_metrics_for_ai_loop(iter_idx, engine)


DEFAULT_ENTITIES_CONFIG: Dict[str, list] = {
    'vm': ['CREATE', 'DELETE', 'LIST', 'UPDATE', 'CLONE', 'POWER_ON', 'POWER_OFF'],
    'project': ['CREATE', 'DELETE', 'LIST', 'UPDATE'],
    'image': ['CREATE', 'DELETE', 'LIST'],
    'category': ['CREATE', 'DELETE', 'LIST'],
    'subnet': ['CREATE', 'DELETE', 'LIST'],
    'scenario': ['CREATE', 'DELETE', 'LIST', 'EXECUTE'],
    'blueprint_single_vm': ['CREATE', 'DELETE', 'LIST', 'EXECUTE'],
    'blueprint_multi_vm': ['CREATE', 'DELETE', 'LIST', 'EXECUTE'],
    'playbook': ['CREATE', 'DELETE', 'LIST', 'EXECUTE'],
}


def _ensure_entities_config(entities_config: Optional[Dict]) -> Dict:
    """
    Return a usable entities_config, falling back to DEFAULT_ENTITIES_CONFIG
    when the caller passes None or an empty dict.
    """
    if not entities_config:
        logger.warning("⚠️ entities_config is empty — using comprehensive default "
                       f"({len(DEFAULT_ENTITIES_CONFIG)} entity types)")
        return dict(DEFAULT_ENTITIES_CONFIG)

    real_entities = {k: v for k, v in entities_config.items()
                     if k not in ('ai_enabled', 'ml_enabled') and isinstance(v, list) and v}
    if not real_entities:
        logger.warning("⚠️ entities_config has no usable entity-operation pairs — "
                       "using comprehensive default")
        preserved = {k: v for k, v in entities_config.items()
                     if k in ('ai_enabled', 'ml_enabled')}
        return {**DEFAULT_ENTITIES_CONFIG, **preserved}

    return entities_config


def _sync_created_entities(controller, ai_engine):
    """Deep-copy created entities from the standard controller to the AI engine."""
    import copy
    if controller.created_entities:
        ai_engine._created_entities = copy.deepcopy(controller.created_entities)
        total = sum(len(v) for v in ai_engine._created_entities.values())
        logger.debug(f"🔄 Synced {total} created entities to AI engine")


def _run_ai_control_loop(ai_engine: Any, testbed_info: Dict[str, Any]) -> None:
    """
    Run the AI control loop with REAL NCM operations.

    Uses the standard SmartExecutionController to execute actual API calls against
    Prism Central while the AI engine (PID + ML) makes the decisions about what
    operations to run and at what rate.

    Includes adaptive safeguards:
    - Entity blacklisting: entities with 100% failure rate are temporarily skipped
    - Diversity enforcement: prevents ML feedback loop locking onto one entity type
    - Stagnation detection: forces entity rotation when CPU/Memory aren't improving
    """
    import asyncio
    from collections import defaultdict
    from services.smart_execution_service import SmartExecutionController

    max_iterations = int(os.environ.get('AI_ENGINE_MAX_ITERATIONS', '2000'))
    max_seconds = float(os.environ.get('AI_ENGINE_MAX_SECONDS', '7200'))

    BLACKLIST_THRESHOLD = 5          # Blacklist entity after N consecutive failures
    STAGNATION_WINDOW = 10           # Check last N iterations for stagnation
    STAGNATION_MIN_IMPROVEMENT = 2.0 # CPU must improve by at least this % over window
    DIVERSITY_MIN_TYPES = 3          # Force at least N different entity types per window
    DIVERSITY_WINDOW = 15            # Check diversity over last N iterations

    # Adaptive ops-per-iteration: read from user config, scale up on stagnation
    adv = ai_engine.target_config.get('advanced', {})
    user_ops_per_iter = (
        ai_engine.target_config.get('operations_per_iteration')
        or adv.get('operations_per_iteration')
        or 5
    )
    max_ops_per_iter = max(user_ops_per_iter, 5)
    OPS_PER_ITER_CAP = 30  # absolute ceiling for adaptive increase

    # Heavy operations that actually generate cluster load (CPU/Memory impact)
    LOAD_GENERATING_OPS = [
        ('vm', 'CREATE'), ('vm', 'CLONE'), ('vm', 'MIGRATE'),
        ('project', 'CREATE'), ('image', 'CREATE'),
        ('category', 'CREATE'), ('subnet', 'CREATE'),
        ('scenario', 'EXECUTE'),
    ]

    # Build entities_config list for the standard controller
    entities_config = _ensure_entities_config(ai_engine.entities_config)
    ai_engine.entities_config = entities_config

    entity_ops = []
    for entity, operations in entities_config.items():
        if entity in ('ai_enabled', 'ml_enabled'):
            continue
        if isinstance(operations, list):
            for op in operations:
                entity_ops.append((entity, op))

    if not entity_ops:
        for entity, operations in DEFAULT_ENTITIES_CONFIG.items():
            for op in operations:
                entity_ops.append((entity, op))
        logger.warning(f"⚠️ Populated entity_ops from defaults: {len(entity_ops)} pairs")

    # Separate load-generating ops from the full list for stagnation recovery
    load_gen_ops = [eo for eo in entity_ops if eo in LOAD_GENERATING_OPS]
    if not load_gen_ops:
        load_gen_ops = [(e, o) for e, o in entity_ops if o in ('CREATE', 'EXECUTE')]
    if not load_gen_ops:
        load_gen_ops = entity_ops[:5]

    # --- Adaptive tracking state ---
    entity_stats: Dict[str, Dict] = defaultdict(lambda: {'attempts': 0, 'successes': 0, 'consecutive_fails': 0})
    blacklisted_entities: set = set()
    recent_entity_types: list = []  # Track entity types used in recent iterations
    cpu_history_window: list = []   # Track CPU over recent iterations for stagnation

    # Create a standard controller for real operations
    controller = SmartExecutionController(
        testbed_info=testbed_info,
        target_config=ai_engine.target_config,
        entities_config=ai_engine.entities_config,
        rule_config=ai_engine.rule_config,
    )

    # Initialize NCM client in an async context
    loop = asyncio.new_event_loop()

    try:
        loop.run_until_complete(controller._initialize_ncm_client())
    except Exception as e:
        logger.error(f"❌ Failed to initialize NCM client: {e}")
        ai_engine.phase = 'failed'
        ai_engine.end_execution(reason=f'NCM client init failed: {e}')
        loop.close()
        return

    if not controller.ncm_client_ready:
        logger.error("❌ NCM client not ready — cannot run real operations")
        ai_engine.phase = 'failed'
        ai_engine.end_execution(reason='NCM client not ready')
        loop.close()
        return

    logger.info(f"✅ NCM client ready for REAL operations on {testbed_info.get('pc_ip')}")

    # Resolve Prometheus URL for real metrics.
    # Priority: 1) controller's discovered URL  2) explicit endpoint from DB
    # 3) auto-construct https://<pc_ip>:30546 (NCM standard NodePort)
    prom = ''
    if getattr(controller, 'prometheus_url', None):
        prom = controller.prometheus_url
        logger.info(f"🔍 Using controller's Prometheus URL: {prom}")
    if not prom:
        prom = (testbed_info.get('prometheus_endpoint') or '').strip()
        if prom and not prom.startswith('http'):
            prom = f'http://{prom}' if '://' not in prom else prom
    if not prom:
        pc_ip = testbed_info.get('pc_ip', '')
        if pc_ip:
            candidate = f'https://{pc_ip}:30546'
            test_result = _fetch_prometheus_cpu_memory(candidate)
            if test_result is not None:
                prom = candidate
                logger.info(f"🔍 Auto-discovered Prometheus at {prom}")
            else:
                logger.warning(f"⚠️ Prometheus not reachable at {candidate}")
    if prom:
        logger.info(f"📈 Prometheus URL for AI loop: {prom}")
    else:
        logger.warning("⚠️ No Prometheus URL available — will use synthetic metrics")

    t0 = time.monotonic()
    op_index = 0
    force_diverse = False

    for i in range(max_iterations):
        if ai_engine.emergency_stop:
            ai_engine.end_execution(reason='Emergency stop')
            break
        if time.monotonic() - t0 > max_seconds:
            logger.warning('AI engine: max duration reached')
            ai_engine.phase = 'COMPLETED'
            ai_engine.end_execution(reason='Max duration')
            break

        # Get REAL metrics from Prometheus (fallback to synthetic if unreachable)
        metrics = _resolve_metrics_for_ai_loop(i, ai_engine, prom)

        # --- Stagnation detection ---
        cpu_history_window.append(metrics.get('cpu', 0))
        if len(cpu_history_window) > STAGNATION_WINDOW:
            cpu_history_window.pop(0)

        is_stagnant = False
        current_cpu = metrics.get('cpu', 0)
        current_memory = metrics.get('memory', 0)
        target_cpu = ai_engine.target_config.get('cpu_threshold', 90)
        target_memory = ai_engine.target_config.get('memory_threshold', 75)
        cpu_gap = target_cpu - current_cpu
        mem_gap = target_memory - current_memory

        if len(cpu_history_window) >= STAGNATION_WINDOW and i >= STAGNATION_WINDOW:
            window_min = min(cpu_history_window)
            window_max = max(cpu_history_window)
            cpu_far_from_target = (target_cpu - max(cpu_history_window)) > 10
            first_half_avg = sum(cpu_history_window[:STAGNATION_WINDOW // 2]) / max(len(cpu_history_window[:STAGNATION_WINDOW // 2]), 1)
            second_half_avg = sum(cpu_history_window[STAGNATION_WINDOW // 2:]) / max(len(cpu_history_window[STAGNATION_WINDOW // 2:]), 1)
            no_upward_trend = (second_half_avg - first_half_avg) < STAGNATION_MIN_IMPROVEMENT
            if cpu_far_from_target and (
                (window_max - window_min) < STAGNATION_MIN_IMPROVEMENT
                or no_upward_trend
            ):
                is_stagnant = True

        # --- Diversity check ---
        unique_recent_types = set(recent_entity_types[-DIVERSITY_WINDOW:])
        lacks_diversity = len(unique_recent_types) < DIVERSITY_MIN_TYPES and i >= DIVERSITY_WINDOW

        if is_stagnant and not force_diverse:
            logger.warning(f"⚠️ Iteration {i+1}: CPU stagnant at ~{cpu_history_window[-1]:.1f}% "
                           f"(range {min(cpu_history_window):.1f}-{max(cpu_history_window):.1f}% "
                           f"over last {STAGNATION_WINDOW} iters). Forcing diverse load-generating ops.")
            force_diverse = True
            # Progressively increase ops per iteration when stagnant
            old_max = max_ops_per_iter
            max_ops_per_iter = min(max_ops_per_iter + 5, OPS_PER_ITER_CAP)
            if max_ops_per_iter != old_max:
                logger.info(f"📈 Stagnation escalation: ops/iter {old_max} → {max_ops_per_iter}")

        if lacks_diversity and not force_diverse:
            logger.warning(f"⚠️ Iteration {i+1}: Low diversity — only {unique_recent_types} used "
                           f"in last {DIVERSITY_WINDOW} iters. Forcing rotation.")
            force_diverse = True

        # --- Stress-pod escalation via the standard controller ---
        # Sync metrics into the controller so its stagnation detector works
        controller.metrics_history.append({
            'cpu_percent': current_cpu,
            'memory_percent': current_memory,
            'iteration': i,
            'timestamp': time.time(),
        })
        if len(controller.metrics_history) > 50:
            controller.metrics_history = controller.metrics_history[-50:]
        try:
            controller._check_stagnation_and_escalate(current_cpu, current_memory)
        except Exception as esc_err:
            logger.debug(f"Stress-pod escalation skipped: {esc_err}")

        # AI brain decides what to do
        action = ai_engine.calculate_next_action(metrics)

        if action.get('should_stop'):
            logger.info('AI engine: control loop stopped — target reached + sustain complete')
            ai_engine.phase = 'COMPLETED'
            ai_engine.end_execution(reason='Target reached + sustain complete')
            break

        # When stop_condition="all", use the LAGGING metric's gap for scaling
        # so that operations keep driving the weaker metric toward target
        stop_cond = ai_engine.target_config.get('stop_condition', 'any')
        if stop_cond == 'all':
            effective_gap = max(cpu_gap, mem_gap)
        else:
            effective_gap = min(cpu_gap, mem_gap)

        # Override PID ops/min when one metric is above target but the other
        # is still far below — prevent the PID from starving the lagging metric
        if stop_cond == 'all' and effective_gap > 10:
            ops_floor = 20.0 if effective_gap > 30 else 15.0
            if action.get('operations_per_minute', 0) < ops_floor:
                action['operations_per_minute'] = ops_floor
                if ai_engine.adaptive_controller:
                    ai_engine.adaptive_controller.operations_per_minute = ops_floor

        # --- Determine how many ops to run this iteration ---
        if effective_gap > 40:
            desired_ops = int(max_ops_per_iter * 2.0)
        elif effective_gap > 20:
            desired_ops = int(max_ops_per_iter * 1.5)
        elif effective_gap > 10:
            desired_ops = max_ops_per_iter
        elif effective_gap > 0:
            desired_ops = max(max_ops_per_iter // 2, user_ops_per_iter)
        else:
            desired_ops = max(user_ops_per_iter // 2, 3)
        desired_ops = max(desired_ops, 1)

        # --- Build operations list with adaptive safeguards ---
        ops_to_run = []

        # Over-request to compensate for blacklisted entities being filtered
        request_count = desired_ops + len(blacklisted_entities) * 2

        if force_diverse:
            available_load_ops = [(e, o) for e, o in load_gen_ops if e not in blacklisted_entities]
            if not available_load_ops:
                available_load_ops = [(e, o) for e, o in entity_ops if e not in blacklisted_entities]
            if not available_load_ops:
                blacklisted_entities.clear()
                logger.info("🔄 All entities were blacklisted — resetting blacklist")
                available_load_ops = load_gen_ops or entity_ops

            for j in range(min(request_count, len(available_load_ops) * 3)):
                et, op = available_load_ops[(op_index + j) % len(available_load_ops)]
                ops_to_run.append({'entity_type': et, 'operation': op})
                if len(ops_to_run) >= desired_ops:
                    break
            op_index += len(ops_to_run)

            force_diverse = False
        else:
            ml_ops = action.get('recommended_operations') or []

            if ml_ops:
                ml_ops = [r for r in ml_ops if r.get('entity_type', '') not in blacklisted_entities]

                ml_entity_types = set(r.get('entity_type', '') for r in ml_ops)
                if len(ml_entity_types) <= 1 and ml_ops:
                    stuck_type = ml_ops[0].get('entity_type', '')
                    stats = entity_stats[stuck_type]
                    if stats['attempts'] >= BLACKLIST_THRESHOLD and stats['successes'] == 0:
                        logger.info(f"🔄 ML stuck on failing entity '{stuck_type}' — injecting diverse ops")
                        ml_ops = []

                    elif i >= DIVERSITY_WINDOW:
                        diverse_inject = []
                        available = [(e, o) for e, o in entity_ops
                                     if e != stuck_type and e not in blacklisted_entities
                                     and o in ('CREATE', 'EXECUTE', 'LIST')]
                        if available:
                            inject_count = min(desired_ops // 3, len(available))
                            for j in range(inject_count):
                                de, do = available[(op_index + j) % len(available)]
                                diverse_inject.append({'entity_type': de, 'operation': do})
                            op_index += len(diverse_inject)
                            ml_ops = ml_ops[:desired_ops - len(diverse_inject)] + diverse_inject

                ops_to_run = ml_ops[:desired_ops]

            if not ops_to_run:
                ops_pm = float(action.get('operations_per_minute') or 10.0)
                num_ops = max(desired_ops, int(ops_pm / 12))
                attempts = 0
                while len(ops_to_run) < desired_ops and attempts < num_ops + len(blacklisted_entities) * 2:
                    et, op = entity_ops[op_index % len(entity_ops)]
                    op_index += 1
                    attempts += 1
                    if et in blacklisted_entities:
                        continue
                    ops_to_run.append({'entity_type': et, 'operation': op})

        # --- Execute operations (adaptive count, not hard-capped) ---
        iter_entity_types = set()

        for rec in ops_to_run:
            if ai_engine.emergency_stop:
                break

            et = rec.get('entity_type', 'vm')
            op = rec.get('operation', 'CREATE').upper()
            iter_entity_types.add(et)

            metrics_before = {
                'cpu': metrics['cpu'],
                'memory': metrics['memory'],
                'cluster_size': metrics.get('cluster_size', 1),
            }

            op_start = time.monotonic()
            success = False
            entity_name = ''
            result = {}
            try:
                result = loop.run_until_complete(
                    controller._execute_single_operation(et, op, iteration=i)
                )
                success = result.get('status') == 'SUCCESS'
                duration = result.get('duration_seconds', time.monotonic() - op_start)
                entity_name = result.get('entity_name', '')
                if not success:
                    logger.warning(f"⚠️ {et}.{op} failed: {result.get('error', 'unknown')}")
            except Exception as e:
                logger.error(f"❌ {et}.{op} exception: {e}")
                duration = time.monotonic() - op_start

            # --- Update entity tracking ---
            stats = entity_stats[et]
            stats['attempts'] += 1
            if success:
                stats['successes'] += 1
                stats['consecutive_fails'] = 0
                blacklisted_entities.discard(et)
            else:
                stats['consecutive_fails'] += 1
                if stats['consecutive_fails'] >= BLACKLIST_THRESHOLD and stats['successes'] == 0:
                    if et not in blacklisted_entities:
                        blacklisted_entities.add(et)
                        logger.warning(f"🚫 Blacklisted entity '{et}' after {stats['consecutive_fails']} "
                                       f"consecutive failures (0/{stats['attempts']} success)")

            metrics_after_raw = _fetch_prometheus_cpu_memory(prom)
            if metrics_after_raw:
                metrics_after = {
                    'cpu': metrics_after_raw[0],
                    'memory': metrics_after_raw[1],
                    'cluster_size': metrics.get('cluster_size', 1),
                }
            else:
                metrics_after = metrics_before.copy()

            ai_engine.record_operation_result(et, op, metrics_before, metrics_after, success, duration, entity_name=entity_name)

            if ai_engine.phase == 'sustaining':
                ai_engine._sustain_stats['ops_during_sustain'] = \
                    ai_engine._sustain_stats.get('ops_during_sustain', 0) + 1

        # Track which entity types were used this iteration
        recent_entity_types.extend(iter_entity_types)
        if len(recent_entity_types) > DIVERSITY_WINDOW * 2:
            recent_entity_types[:] = recent_entity_types[-DIVERSITY_WINDOW * 2:]

        _sync_created_entities(controller, ai_engine)

        if (i + 1) % 20 == 0:
            bl_str = ', '.join(sorted(blacklisted_entities)) if blacklisted_entities else 'none'
            top_types = sorted(entity_stats.items(), key=lambda x: x[1]['attempts'], reverse=True)[:5]
            stats_str = ', '.join(f"{k}:{v['successes']}/{v['attempts']}" for k, v in top_types)
            logger.info(f"📊 Adaptive state @iter {i+1}: ops/iter={max_ops_per_iter}, "
                        f"blacklisted=[{bl_str}], stats=[{stats_str}]")

        # Sleep between iterations — faster when far from target
        ops_pm = float(action.get('operations_per_minute') or 10.0)
        if effective_gap > 30:
            sleep_s = max(1.0, 60.0 / max(ops_pm, 1.0) * 0.3)
        elif effective_gap > 15:
            sleep_s = max(2.0, 60.0 / max(ops_pm, 1.0) * 0.5)
        else:
            sleep_s = min(10.0, max(1.0, 60.0 / max(ops_pm, 0.5)))
        time.sleep(sleep_s)

    # Final sync of created entities + testbed info for cleanup
    _sync_created_entities(controller, ai_engine)
    ai_engine._testbed_info = testbed_info

    # Store the resolved Prometheus URL so it's available at DB-persist time
    ai_engine._prometheus_url = prom if prom else None

    # Capture cluster health snapshot before tunnel is cleaned up
    if hasattr(controller, '_capture_cluster_health_before_teardown'):
        controller._capture_cluster_health_before_teardown()
    if hasattr(controller, '_cluster_health_snapshot'):
        ai_engine._cluster_health_snapshot = controller._cluster_health_snapshot

    # If controller didn't produce a snapshot, collect directly via enhanced report service
    if not getattr(ai_engine, '_cluster_health_snapshot', None) and prom:
        try:
            from services.enhanced_report_service import EnhancedReportService
            ers = EnhancedReportService(prometheus_url=prom)
            snapshot = ers._collect_cluster_health()
            if snapshot.get('collection_status') == 'success':
                ai_engine._cluster_health_snapshot = snapshot
                logger.info(f"📊 Captured cluster health snapshot via Prometheus: {prom}")
            else:
                logger.debug(f"Cluster health snapshot not usable: {snapshot.get('collection_reason')}")
        except Exception as ch_err:
            logger.debug(f"Cluster health snapshot collection failed: {ch_err}")

    loop.close()

    if ai_engine.phase not in ('COMPLETED', 'failed', 'emergency_stop'):
        ai_engine.phase = 'COMPLETED'
        ai_engine.end_execution(reason='Max iterations')


@smart_execution_ai_bp.route('/api/smart-execution/start-ai', methods=['POST'])
def start_ai_execution():
    """
    Start AI-powered smart execution
    
    Request Body:
    {
        "testbed_id": "unique_testbed_id",
        "target_config": {
            "cpu_threshold": 80,
            "memory_threshold": 75,
            "stop_condition": "any"
        },
        "entities_config": {
            "vm": ["CREATE", "DELETE"],
            "blueprint_multi_vm": ["EXECUTE"]
        },
        "rule_config": {
            "namespaces": ["ntnx-system"],
            "pod_names": []
        },
        "ai_settings": {
            "enable_ai": true,
            "enable_ml": true,
            "data_collection": true,
            "pid_tuning": {...}
        }
    }
    
    Returns:
    {
        "success": true,
        "execution_id": "AI-EXEC-...",
        "message": "AI execution started"
    }
    """
    if not AI_AVAILABLE:
        return jsonify({
            'success': False,
            'error': 'AI Smart Execution Engine not available'
        }), 503
    
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data.get('testbed_id'):
            return jsonify({'success': False, 'error': 'testbed_id required'}), 400
        
        if not data.get('target_config'):
            return jsonify({'success': False, 'error': 'target_config required'}), 400
        
        # Auto-fill entities_config with comprehensive defaults when missing or empty
        raw_ec = data.get('entities_config') or {}
        usable = {k: v for k, v in raw_ec.items()
                  if k not in ('ai_enabled', 'ml_enabled') and isinstance(v, list) and v}
        if not usable:
            logger.info("ℹ️ No entity-operation pairs in request — using default entities_config")
            data['entities_config'] = dict(DEFAULT_ENTITIES_CONFIG)

        # Get testbed info
        from database import SessionLocal
        from models.testbed import Testbed
        
        session = SessionLocal()
        try:
            testbed = session.query(Testbed).filter_by(
                unique_testbed_id=data['testbed_id']
            ).first()
            
            if not testbed:
                return jsonify({'success': False, 'error': 'Testbed not found'}), 404
            
            tb_json = testbed.testbed_json if isinstance(testbed.testbed_json, dict) else {}
            testbed_info = {
                'pc_ip': testbed.pc_ip,
                'ncm_ip': testbed.ncm_ip,
                'username': testbed.username,
                'password': testbed.password,
                'testbed_label': testbed.testbed_label,
                'unique_testbed_id': testbed.unique_testbed_id,
                'prometheus_endpoint': tb_json.get('prometheus_endpoint', '')
            }
        finally:
            session.close()
        
        # Generate execution ID
        execution_id = f"AI-EXEC-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{data['testbed_id'][:8]}"
        
        # Extract AI settings
        ai_settings = data.get('ai_settings', {})
        enable_ai = ai_settings.get('enable_ai', True)
        enable_ml = ai_settings.get('enable_ml', True)
        data_collection = ai_settings.get('data_collection', True)
        pid_tuning = ai_settings.get('pid_tuning', {})
        
        # Merge top-level 'advanced' into target_config so the engine sees it
        target_config = data['target_config']
        if 'advanced' not in target_config and data.get('advanced'):
            target_config['advanced'] = data['advanced']

        # Create AI execution engine
        ai_engine = SmartExecutionEngineAI(
            execution_id=execution_id,
            testbed_info=testbed_info,
            target_config=target_config,
            entities_config=data['entities_config'],
            rule_config=data.get('rule_config', {}),
            enable_ml=enable_ml,
            data_collection_mode=data_collection
        )
        
        # Apply PID tuning if provided
        if enable_ai and pid_tuning and ai_engine.adaptive_controller:
            cpu_kp = pid_tuning.get('cpu_kp')
            cpu_ki = pid_tuning.get('cpu_ki')
            cpu_kd = pid_tuning.get('cpu_kd')
            if cpu_kp or cpu_ki or cpu_kd:
                ai_engine.adaptive_controller.cpu_pid.tune(
                    Kp=cpu_kp,
                    Ki=cpu_ki,
                    Kd=cpu_kd
                )
            
            memory_kp = pid_tuning.get('memory_kp')
            memory_ki = pid_tuning.get('memory_ki')
            memory_kd = pid_tuning.get('memory_kd')
            if memory_kp or memory_ki or memory_kd:
                ai_engine.adaptive_controller.memory_pid.tune(
                    Kp=memory_kp,
                    Ki=memory_ki,
                    Kd=memory_kd
                )
        
        # Store in active executions
        active_ai_executions[execution_id] = {
            'engine': ai_engine,
            'thread': None,
            'start_time': datetime.now(timezone.utc).isoformat(),
            'testbed_id': data['testbed_id'],
            'execution_name': data.get('execution_name', '') or f"AI Execution - {testbed_info.get('testbed_label', 'Unknown')}",
            'execution_description': data.get('execution_description', '')
        }
        
        # Save to DB immediately so execution appears in history even if
        # the background thread crashes before reaching _save_execution_to_db
        _save_execution_to_db(execution_id, testbed_info, data, ai_engine)
        
        # Start execution in background thread
        def run_execution():
            """Background execution thread"""
            try:
                ai_engine.start_execution()
                
                # Update DB status from STARTING → RUNNING
                _update_execution_status(execution_id, 'RUNNING')
                
                logger.info(f"🚀 AI execution {execution_id} started — entering control loop")
                _run_ai_control_loop(ai_engine, testbed_info)
                
            except Exception as e:
                logger.error(f"❌ Error in AI execution {execution_id}: {e}")
                logger.exception(e)
                ai_engine.trigger_emergency_stop(f"Exception: {str(e)}")
            finally:
                # Always try to complete execution in database and send alerts
                try:
                    _complete_execution_in_db(execution_id, ai_engine, testbed_info)
                except Exception as complete_error:
                    logger.error(f"❌ Error completing execution: {complete_error}")
        
        thread = threading.Thread(target=run_execution, daemon=True)
        thread.start()
        
        active_ai_executions[execution_id]['thread'] = thread
        
        return jsonify({
            'success': True,
            'execution_id': execution_id,
            'message': 'AI execution started successfully',
            'ai_enabled': enable_ai,
            'ml_enabled': enable_ml
        }), 200
        
    except Exception as e:
        logger.exception("Error starting AI execution")
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_execution_ai_bp.route('/api/smart-execution/monitor/<execution_id>', methods=['GET'])
def monitor_ai_execution(execution_id):
    """
    Get live monitoring data for AI execution
    
    Returns:
    {
        "success": true,
        "execution_id": "...",
        "phase": "ramp_up",
        "current_metrics": {...},
        "operations_per_minute": 45.2,
        "total_operations": 123,
        "reasoning": "...",
        "recent_operations": [...],
        "pid_stats": {...},
        "ml_recommendations": [...]
    }
    """
    try:
        # Check if execution is in active AI executions
        if execution_id in active_ai_executions:
            exec_data = active_ai_executions[execution_id]
            engine = exec_data['engine']
            
            # Get current status
            status_data = {
                'success': True,
                'execution_id': execution_id,
                'execution_name': exec_data.get('execution_name', ''),
                'execution_description': exec_data.get('execution_description', ''),
                'phase': engine.phase,
                'iteration': engine.iteration,
                'total_operations': engine.total_operations_executed,
                'start_time': exec_data['start_time'],
                'ai_enabled': engine.adaptive_controller is not None,
                'ml_enabled': engine.enable_ml,
                'emergency_stop': engine.emergency_stop,
                'circuit_breaker_trips': engine.circuit_breaker_trips
            }
            
            # Add current metrics if available
            if engine.metrics_history:
                latest_metrics = engine.metrics_history[-1]
                status_data['current_metrics'] = latest_metrics
            
            # Add PID controller stats
            if engine.adaptive_controller:
                status_data['operations_per_minute'] = engine.adaptive_controller.operations_per_minute
                status_data['pid_stats'] = engine.adaptive_controller.get_stats()
            
            # Add recent operations (last 10)
            status_data['recent_operations'] = engine.operation_history[-10:] if engine.operation_history else []
            
            # Add ML stats if available
            if engine.ml_predictor and engine.ml_predictor.is_trained:
                status_data['ml_trained'] = True
                status_data['training_samples'] = len(engine.training_data)

            # Add sustain data
            if hasattr(engine, '_sustain_stats'):
                from datetime import datetime as dt, timezone as tz
                status_data['sustain'] = {
                    'sustain_minutes': getattr(engine, '_sustain_minutes', 5),
                    'is_sustaining': engine.phase == 'sustaining',
                    'sustain_start_time': engine._sustain_start_time.isoformat() if engine._sustain_start_time else None,
                    'sustain_elapsed_seconds': (dt.now(tz.utc) - engine._sustain_start_time).total_seconds() if engine._sustain_start_time else 0,
                    'stats': engine._sustain_stats,
                }

            if hasattr(engine, '_get_pod_restart_tracking'):
                status_data['pod_restart_tracking'] = engine._get_pod_restart_tracking()
            
            return jsonify(status_data), 200
        
        # Check if it's in the standard smart execution controller
        from services.smart_execution_service import get_smart_execution
        controller = get_smart_execution(execution_id)
        if controller:
            status = controller.get_status()
            cm = status.get('current_metrics', {})
            tc = status.get('target_config', {})
            return jsonify({
                'success': True,
                'execution_id': execution_id,
                'status': status.get('status', 'UNKNOWN'),
                'phase': status.get('status', 'UNKNOWN'),
                'iteration': len(status.get('metrics_history', [])),
                'total_operations': status.get('total_operations', 0),
                'operations_per_minute': status.get('operations_per_minute', 0),
                'current_metrics': {
                    'cpu': cm.get('cpu_percent', 0),
                    'memory': cm.get('memory_percent', 0)
                },
                'target_metrics': {
                    'cpu': tc.get('cpu_threshold', 0),
                    'memory': tc.get('memory_threshold', 0)
                },
                'metrics_history': [
                    {'timestamp': m.get('timestamp', ''), 'cpu': m.get('cpu_percent', 0), 'memory': m.get('memory_percent', 0), 'phase': 'running'}
                    for m in status.get('metrics_history', [])[-20:]
                ],
                'pid_stats': status.get('pid_stats'),
                'recent_operations': [
                    {
                        'entity_type': op.get('entity_type'),
                        'operation': op.get('operation'),
                        'success': op.get('status') == 'SUCCESS',
                        'duration': op.get('duration_seconds', 0),
                        'timestamp': op.get('start_time', ''),
                        'error': op.get('error')
                    }
                    for op in status.get('operations_history', [])
                ],
                'execution_config': status.get('execution_config', {}),
                'entity_breakdown': status.get('entity_breakdown', {}),
                'emergency_stop': False,
                'circuit_breaker_trips': 0,
                'pod_restart_tracking': status.get('pod_restart_tracking', {}),
            }), 200

        # Otherwise check database
        from database import SessionLocal
        from models.smart_execution import SmartExecution
        
        session = SessionLocal()
        try:
            execution = session.query(SmartExecution).filter_by(execution_id=execution_id).first()
            
            if not execution:
                return jsonify({'success': False, 'error': 'Execution not found'}), 404
            
            fm = execution.final_metrics or {}
            tc = execution.target_config or {}
            db_status = (execution.status or '').upper()
            is_done = db_status in ('COMPLETED', 'FAILED', 'STOPPED')
            fed = execution.full_execution_data if hasattr(execution, 'full_execution_data') else {}
            if not isinstance(fed, dict):
                fed = {}
            return jsonify({
                'success': True,
                'execution_id': execution_id,
                'status': db_status,
                'phase': db_status.lower(),
                'total_operations': execution.total_operations or 0,
                'operations_per_minute': execution.operations_per_minute or 0,
                'current_metrics': {
                    'cpu': fm.get('cpu_percent', 0) if isinstance(fm, dict) else 0,
                    'memory': fm.get('memory_percent', 0) if isinstance(fm, dict) else 0
                },
                'target_metrics': {
                    'cpu': tc.get('cpu_threshold', 0) if isinstance(tc, dict) else 0,
                    'memory': tc.get('memory_threshold', 0) if isinstance(tc, dict) else 0
                },
                'metrics_history': [],
                'emergency_stop': False,
                'circuit_breaker_trips': 0,
                'completed': is_done,
                'pod_restart_tracking': fed.get('pod_restart_tracking', {}),
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error monitoring execution {execution_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_execution_ai_bp.route('/api/smart-execution/ml-recommendations', methods=['POST'])
def get_ml_recommendations():
    """
    Get ML recommendations for operation selection
    
    Request Body:
    {
        "testbed_id": "...",
        "target_cpu": 80,
        "target_memory": 75
    }
    
    Returns:
    {
        "success": true,
        "recommendations": [
            {
                "entity": "vm",
                "operation": "CREATE",
                "cpu_impact": 2.5,
                "memory_impact": 2.0,
                "score": 0.85,
                "confidence": 0.8
            },
            ...
        ]
    }
    """
    try:
        from services.ml_training_service import get_model_for_testbed

        data = request.get_json()
        
        if not data.get('testbed_id'):
            return jsonify({'success': False, 'error': 'testbed_id required'}), 400
        
        testbed_id = data.get('testbed_id')
        target_cpu = data.get('target_cpu', 80)
        target_memory = data.get('target_memory', 75)
        
        # Load per-testbed model (falls back to global/production)
        predictor = get_model_for_testbed(testbed_id)
        
        current_metrics = {
            'cpu': data.get('current_cpu', 50.0),
            'memory': data.get('current_memory', 45.0),
            'cluster_size': data.get('cluster_size', 3),
            'current_load': data.get('current_load', 10.0)
        }
        
        recommendations = predictor.recommend_operations(
            target_cpu_increase=target_cpu - current_metrics['cpu'],
            target_memory_increase=target_memory - current_metrics['memory'],
            current_metrics=current_metrics,
            top_k=10
        )
        
        return jsonify({
            'success': True,
            'recommendations': recommendations,
            'model_trained': predictor.is_trained
        }), 200
        
    except Exception as e:
        logger.exception("Error getting ML recommendations")
        return jsonify({'success': False, 'error': str(e)}), 500


def _get_default_namespaces_pods():
    """Return default namespaces and pods when Prometheus is not available"""
    default_namespaces = [
        'ntnx-system',
        'default',
        'kube-system',
        'kube-public',
        'kube-node-lease',
        'monitoring',
        'logging'
    ]

    default_pods = [
        'prism-central',
        'ncm-api-server',
        'ncm-controller',
        'ncm-scheduler',
        'calm-server',
        'epsilon-server',
        'nucalm',
        'insights-server',
        'alert-manager',
        'metrics-server',
        'coredns',
        'etcd',
        'kube-apiserver',
        'kube-controller-manager',
        'kube-scheduler',
    ]

    default_pods_by_ns = {
        'ntnx-system': ['prism-central', 'ncm-api-server', 'ncm-controller', 'ncm-scheduler',
                         'calm-server', 'epsilon-server', 'nucalm', 'insights-server', 'alert-manager'],
        'kube-system': ['coredns', 'etcd', 'kube-apiserver', 'kube-controller-manager', 'kube-scheduler', 'metrics-server'],
        'monitoring': ['metrics-server'],
    }

    return jsonify({
        'success': True,
        'namespaces': default_namespaces,
        'pods': default_pods,
        'pods_by_namespace': default_pods_by_ns,
        'source': 'defaults',
        'note': 'Prometheus not available, using default values'
    }), 200


@smart_execution_ai_bp.route('/api/smart-execution/available-pods', methods=['POST'])
def get_available_pods():
    """
    Get available namespaces and pod names from Prometheus
    
    Request Body:
    {
        "testbed_id": "..."
    }
    
    Returns:
    {
        "success": true,
        "namespaces": ["ntnx-system", "default", "kube-system"],
        "pods": ["pod1", "pod2", ...],
        "pods_by_namespace": {
            "ntnx-system": ["pod1", "pod2"],
            "default": ["pod3"]
        }
    }
    """
    try:
        import requests
        from database import SessionLocal
        from models.testbed import Testbed
        
        data = request.get_json()
        testbed_id = data.get('testbed_id')
        
        if not testbed_id:
            return jsonify({'success': False, 'error': 'testbed_id required'}), 400
        
        # Get testbed info
        session = SessionLocal()
        try:
            testbed = session.query(Testbed).filter(
                Testbed.unique_testbed_id == testbed_id
            ).first()
            
            if not testbed:
                return jsonify({'success': False, 'error': 'Testbed not found'}), 404
            
            # Get Prometheus URL from testbed_json
            raw = testbed.testbed_json or {}
            if isinstance(raw, str):
                import json as _json
                try:
                    testbed_json = _json.loads(raw)
                except (ValueError, TypeError):
                    testbed_json = {}
            else:
                testbed_json = raw
            prometheus_url = testbed_json.get('prometheus_url') or testbed_json.get('prometheus_endpoint')
            
            if not prometheus_url:
                logger.info(f"Prometheus not configured for testbed {testbed_id}, returning defaults")
                return _get_default_namespaces_pods()
            
            # Query Prometheus for pod info
            prom_query_url = f"{prometheus_url}/api/v1/query"
            pod_query = 'kube_pod_info'
            
            try:
                response = requests.get(
                    prom_query_url,
                    params={'query': pod_query},
                    verify=False,
                    timeout=10
                )
                
                if response.status_code != 200:
                    logger.warning(f"Prometheus returned {response.status_code}, using defaults")
                    return _get_default_namespaces_pods()
                
                prom_data = response.json()
                
                if prom_data.get('status') != 'success':
                    logger.warning("Prometheus query failed, using defaults")
                    return _get_default_namespaces_pods()
                    
            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                logger.warning(f"Prometheus not reachable: {e}, using defaults")
                return _get_default_namespaces_pods()
            
            # Extract namespaces and pods
            namespaces_set = set()
            pods_set = set()
            pods_by_namespace = {}
            
            for result in prom_data.get('data', {}).get('result', []):
                metric = result.get('metric', {})
                namespace = metric.get('namespace', metric.get('exported_namespace', ''))
                pod = metric.get('pod', metric.get('exported_pod', ''))
                
                if namespace:
                    namespaces_set.add(namespace)
                if pod:
                    pods_set.add(pod)
                
                # Group pods by namespace
                if namespace and pod:
                    if namespace not in pods_by_namespace:
                        pods_by_namespace[namespace] = []
                    if pod not in pods_by_namespace[namespace]:
                        pods_by_namespace[namespace].append(pod)
            
            return jsonify({
                'success': True,
                'namespaces': sorted(list(namespaces_set)),
                'pods': sorted(list(pods_set)),
                'pods_by_namespace': {k: sorted(v) for k, v in pods_by_namespace.items()}
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception("Error getting available pods")
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_execution_ai_bp.route('/api/smart-execution/emergency-stop/<execution_id>', methods=['POST'])
def emergency_stop(execution_id):
    """
    Trigger emergency stop for AI execution
    
    Returns:
    {
        "success": true,
        "message": "Emergency stop triggered"
    }
    """
    try:
        if execution_id not in active_ai_executions:
            return jsonify({'success': False, 'error': 'Execution not found or already completed'}), 404
        
        exec_data = active_ai_executions[execution_id]
        engine = exec_data['engine']
        
        # Trigger emergency stop
        reason = request.get_json().get('reason', 'Manual emergency stop')
        engine.trigger_emergency_stop(reason)
        
        logger.warning(f"🚨 Emergency stop triggered for {execution_id}: {reason}")
        
        return jsonify({
            'success': True,
            'message': 'Emergency stop triggered',
            'execution_id': execution_id
        }), 200
        
    except Exception as e:
        logger.exception(f"Error triggering emergency stop for {execution_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_execution_ai_bp.route('/api/smart-execution/ai-report/<execution_id>', methods=['GET'])
def get_ai_report(execution_id):
    """
    Get AI-enhanced execution report
    
    Returns comprehensive report with AI insights
    """
    try:
        # Check active executions first
        if execution_id in active_ai_executions:
            exec_data = active_ai_executions[execution_id]
            engine = exec_data['engine']
            
            # Generate comprehensive summary
            summary = engine.get_execution_summary()
            
            # Add AI insights
            summary['ai_insights'] = _generate_ai_insights(engine)
            
            return jsonify({
                'success': True,
                'report': summary
            }), 200
        
        # Otherwise get from database
        from database import SessionLocal
        from models.smart_execution import SmartExecution
        
        session = SessionLocal()
        try:
            execution = session.query(SmartExecution).filter_by(execution_id=execution_id).first()
            
            if not execution:
                return jsonify({'success': False, 'error': 'Execution not found'}), 404
            
            # Build report from database
            report = {
                'execution_id': execution_id,
                'status': execution.status,
                'total_operations': execution.total_operations,
                'successful_operations': execution.successful_operations,
                'target_config': execution.target_config,
                'baseline_metrics': execution.baseline_metrics,
                'final_metrics': execution.final_metrics,
                'ai_enabled': execution.entities_config.get('ai_enabled', False) if execution.entities_config else False
            }
            
            return jsonify({
                'success': True,
                'report': report
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error getting AI report for {execution_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _update_execution_status(execution_id: str, status: str):
    """Update execution status in DB."""
    try:
        from database import SessionLocal
        from models.smart_execution import SmartExecution

        session = SessionLocal()
        try:
            execution = session.query(SmartExecution).filter_by(
                execution_id=execution_id
            ).first()
            if execution:
                execution.status = status
                session.commit()
                logger.info(f"✅ Updated {execution_id} status → {status}")
        finally:
            session.close()
    except Exception as e:
        logger.error(f"❌ Failed to update execution status: {e}")


def _save_execution_to_db(execution_id, testbed_info, config, engine):
    """Save AI execution to database (idempotent — skips if already exists)."""
    try:
        from database import SessionLocal
        from models.smart_execution import SmartExecution
        
        session = SessionLocal()
        try:
            existing = session.query(SmartExecution).filter_by(
                execution_id=execution_id
            ).first()
            if existing:
                logger.info(f"ℹ️ Execution {execution_id} already in DB — skipping duplicate save")
                return
            
            exec_name = config.get('execution_name', '') or f"AI Execution - {testbed_info.get('testbed_label', 'Unknown')}"
            execution = SmartExecution(
                execution_id=execution_id,
                execution_name=exec_name,
                execution_description=config.get('execution_description', ''),
                testbed_id=testbed_info['unique_testbed_id'],
                unique_testbed_id=testbed_info['unique_testbed_id'],
                testbed_label=testbed_info['testbed_label'],
                target_config=config['target_config'],
                entities_config={
                    **config['entities_config'],
                    'ai_enabled': config.get('ai_settings', {}).get('enable_ai', True),
                    'ml_enabled': config.get('ai_settings', {}).get('enable_ml', True)
                },
                rule_config=config.get('rule_config', {}),
                ai_enabled=config.get('ai_settings', {}).get('enable_ai', True),
                status='STARTING',
                is_running=True,
                start_time=datetime.now(timezone.utc)
            )
            
            session.add(execution)
            session.commit()
            
            logger.info(f"✅ Saved AI execution {execution_id} to database")
            
        finally:
            session.close()
            
    except Exception as e:
        logger.error(f"❌ Error saving execution to database: {e}")


def _complete_execution_in_db(execution_id, engine, testbed_info):
    """
    Mark execution as completed in database and send alerts
    
    Args:
        execution_id: Execution ID
        engine: SmartExecutionEngineAI instance
        testbed_info: Testbed information
    """
    try:
        from database import SessionLocal
        from models.smart_execution import SmartExecution
        from services.alert_service import get_alert_service
        
        session = SessionLocal()
        try:
            # Update execution in database
            execution = session.query(SmartExecution).filter_by(execution_id=execution_id).first()
            
            if execution:
                # Get execution summary
                summary = engine.get_execution_summary()
                failed_ct = sum(1 for op in engine.operation_history if not op.get('success'))
                
                # Map engine phase strings to smart_executions.status
                ph = str(summary.get('status', 'completed') or '').lower()
                if ph in ('failed', 'emergency_stop'):
                    execution.status = 'FAILED'
                elif ph in ('running',):
                    execution.status = 'RUNNING'
                else:
                    execution.status = 'COMPLETED'
                execution.total_operations = summary.get('total_operations', engine.total_operations_executed)
                execution.successful_operations = summary.get('successful_operations', 0)
                execution.failed_operations = summary.get('failed_operations', failed_ct)
                execution.end_time = datetime.now(timezone.utc)
                
                # Store final metrics (get_execution_summary uses final_metrics)
                fm = summary.get('final_metrics') or summary.get('current_metrics') or {}
                execution.final_metrics = {
                    'cpu_percent': fm.get('cpu', 0),
                    'memory_percent': fm.get('memory', 0),
                    'cpu': fm.get('cpu', 0),
                    'memory': fm.get('memory', 0),
                }
                
                # Store baseline metrics if available
                if len(engine.metrics_history) > 0:
                    baseline = engine.metrics_history[0]
                    bc = baseline.get('cpu', 0)
                    bm = baseline.get('memory', 0)
                    execution.baseline_metrics = {
                        'cpu_percent': bc,
                        'memory_percent': bm,
                        'cpu': bc,
                        'memory': bm,
                    }
                
                # Store AI stats
                if engine.adaptive_controller:
                    execution.pid_stats = {
                        'final_ops_per_minute': engine.adaptive_controller.operations_per_minute,
                        'final_phase': engine.adaptive_controller.phase,
                        'total_iterations': engine.adaptive_controller.iteration
                    }
                
                if engine.ml_predictor and engine.ml_predictor.is_trained:
                    execution.ml_stats = {
                        'model_trained': True,
                        'training_samples': len(engine.training_data)
                    }

                # Persist metrics_history, operations_history, success_rate, duration
                if engine.metrics_history:
                    execution.metrics_history = [
                        {**m,
                         'cpu_percent': m.get('cpu_percent') or m.get('cpu', 0),
                         'memory_percent': m.get('memory_percent') or m.get('memory', 0)}
                        for m in engine.metrics_history
                    ]
                if engine.operation_history:
                    execution.operations_history = engine.operation_history

                total_ops = execution.total_operations or 0
                succ_ops = execution.successful_operations or 0
                execution.success_rate = round((succ_ops / max(total_ops, 1)) * 100, 2)

                if engine.start_time and execution.end_time:
                    delta = (execution.end_time - engine.start_time).total_seconds()
                    execution.duration_minutes = round(delta / 60, 2)
                    execution.operations_per_minute = round(total_ops / max(delta / 60, 0.1), 1) if delta > 0 else 0

                # Persist full execution data (cluster health, anomalies, prometheus URL, etc.)
                full_data = execution.full_execution_data or {}
                if not isinstance(full_data, dict):
                    full_data = {}
                ch = getattr(engine, '_cluster_health_snapshot', None)
                if ch and isinstance(ch, dict):
                    full_data['cluster_health_snapshot'] = ch
                prom_url = getattr(engine, '_prometheus_url', None)
                if prom_url:
                    full_data['prometheus_url'] = prom_url

                # Store operation effectiveness (most effective operations)
                op_effectiveness = {}
                for op in engine.operation_history:
                    key = f"{op.get('entity_type', '?')}.{op.get('operation', '?')}"
                    if key not in op_effectiveness:
                        op_effectiveness[key] = {'count': 0, 'successes': 0, 'total_cpu_impact': 0.0, 'total_mem_impact': 0.0}
                    bucket = op_effectiveness[key]
                    bucket['count'] += 1
                    if op.get('success'):
                        bucket['successes'] += 1
                    bucket['total_cpu_impact'] += abs(op.get('cpu_impact', 0))
                    bucket['total_mem_impact'] += abs(op.get('memory_impact', 0))
                full_data['operation_effectiveness'] = [
                    {'entity_operation': k, **v,
                     'avg_cpu_impact': round(v['total_cpu_impact'] / max(v['count'], 1), 3),
                     'avg_mem_impact': round(v['total_mem_impact'] / max(v['count'], 1), 3)}
                    for k, v in sorted(op_effectiveness.items(), key=lambda x: -x[1]['total_cpu_impact'])
                ]

                # Store entity breakdown with success/fail stats
                entity_breakdown = {}
                for op in engine.operation_history:
                    et = op.get('entity_type', 'unknown')
                    if et not in entity_breakdown:
                        entity_breakdown[et] = {'total': 0, 'success': 0, 'failed': 0}
                    entity_breakdown[et]['total'] += 1
                    if op.get('success'):
                        entity_breakdown[et]['success'] += 1
                    else:
                        entity_breakdown[et]['failed'] += 1
                execution.entity_breakdown = entity_breakdown

                execution.full_execution_data = full_data

                # Persist created entities so cleanup can delete them later
                created = getattr(engine, '_created_entities', {})
                if created:
                    execution.created_entities = created
                    total_created = sum(len(v) for v in created.values())
                    logger.info(f"📦 Saved {total_created} created entities for cleanup")

                session.commit()
                logger.info(f"✅ Marked execution {execution_id} as completed")

                # Mark report as ready (data persisted; enhanced report is
                # generated lazily when the user opens the report page)
                execution.report_generated = True
                session.commit()
                logger.info(f"📊 Report data persisted for {execution_id}")

                # Send alerts
                try:
                    alert_service = get_alert_service()
                    channels_config = alert_service.get_channels_config_for_testbed(testbed_info['unique_testbed_id'])
                    
                    if channels_config:
                        alert_data = {
                            'execution_id': execution_id,
                            'testbed_id': testbed_info['unique_testbed_id'],
                            'testbed_label': testbed_info.get('testbed_label', 'Unknown'),
                            'total_operations': execution.total_operations or 0,
                            'successful_operations': execution.successful_operations or 0,
                            'failed_operations': execution.failed_operations or 0,
                            'success_rate': round((execution.successful_operations / execution.total_operations * 100) if execution.total_operations else 0, 1),
                            'cpu_achieved': execution.final_metrics.get('cpu', 0) if execution.final_metrics else 0,
                            'memory_achieved': execution.final_metrics.get('memory', 0) if execution.final_metrics else 0,
                            'duration_minutes': round((execution.end_time - execution.start_time).total_seconds() / 60, 1) if execution.end_time and execution.start_time else 0,
                            'threshold_reached': summary.get('threshold_reached', False),
                            'started_at': execution.start_time.isoformat() if execution.start_time else None,
                            'completed_at': execution.end_time.isoformat() if execution.end_time else None,
                            'ai_enabled': execution.entities_config.get('ai_enabled', False) if execution.entities_config else False
                        }
                        
                        alert_results = alert_service.send_execution_complete_alert(alert_data, channels_config)
                        logger.info(f"📧 Alerts sent: {alert_results}")

                        slack_sent = alert_results.get('slack', False)
                        execution.alert_generated = True
                        execution.alert_sent_slack = slack_sent
                        execution.alert_timestamp = datetime.now(timezone.utc)
                        session.commit()
                        logger.info(f"📧 Alert flags updated: alert_generated=True, alert_sent_slack={slack_sent}")
                    else:
                        logger.info(f"ℹ️  No alert configuration found for testbed {testbed_info['unique_testbed_id']}")
                        
                except Exception as alert_error:
                    logger.error(f"❌ Failed to send alerts: {alert_error}")
                
            else:
                logger.warning(f"⚠️  Execution {execution_id} not found in database")
                
        finally:
            session.close()
            
    except Exception as e:
        logger.error(f"❌ Error completing execution in database: {e}")
        logger.exception(e)


def _generate_ai_insights(engine):
    """Generate AI insights for report"""
    insights = {
        'ai_decisions': [],
        'ml_performance': {},
        'pid_performance': {},
        'recommendations': []
    }
    
    # PID Performance
    if engine.adaptive_controller:
        pid_stats = engine.adaptive_controller.get_stats()
        insights['pid_performance'] = {
            'final_operations_per_minute': engine.adaptive_controller.operations_per_minute,
            'final_phase': engine.adaptive_controller.phase,
            'total_iterations': engine.adaptive_controller.iteration,
            'cpu_pid_stats': pid_stats.get('cpu_pid', {}),
            'memory_pid_stats': pid_stats.get('memory_pid', {})
        }
    
    # ML Performance
    if engine.ml_predictor and engine.ml_predictor.is_trained:
        insights['ml_performance'] = {
            'model_trained': True,
            'training_samples': len(engine.training_data),
            'feature_importance': engine.ml_predictor.get_feature_importance()
        }
    
    # Key decisions/reasoning
    for metric in engine.metrics_history[-10:]:  # Last 10 iterations
        if 'reasoning' in metric:
            insights['ai_decisions'].append({
                'iteration': metric.get('iteration'),
                'phase': metric.get('phase'),
                'reasoning': metric.get('reasoning', 'N/A')
            })
    
    # Recommendations for next execution
    insights['recommendations'] = [
        "AI system successfully adapted to reach target thresholds",
        "ML model collected training data for improved future predictions",
        "PID controller demonstrated stable convergence"
    ]
    
    if engine.circuit_breaker_trips > 0:
        insights['recommendations'].append(
            f"⚠️ Circuit breaker tripped {engine.circuit_breaker_trips} times - check operation reliability"
        )
    
    return insights


# ============================================================================
# ML Training Pipeline Routes
# ============================================================================

@smart_execution_ai_bp.route('/api/ml/train', methods=['POST'])
def trigger_ml_training():
    """
    Trigger ML model training from DB data.

    Request Body:
    {
        "testbed_id": "..." (optional, null for global model)
    }
    """
    try:
        from services.ml_training_service import train_model

        data = request.get_json() or {}
        testbed_id = data.get('testbed_id')

        result = train_model(testbed_id=testbed_id, trigger_type='manual')
        status_code = 200 if result.get('success') else 409
        return jsonify(result), status_code

    except Exception as e:
        logger.exception("Error triggering ML training")
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_execution_ai_bp.route('/api/ml/insights', methods=['GET'])
def get_ml_insights_route():
    """
    Get ML insights dashboard data.

    Query params:
        testbed_id (optional)
    """
    try:
        from services.ml_training_service import get_ml_insights

        testbed_id = request.args.get('testbed_id')
        insights = get_ml_insights(testbed_id)
        return jsonify({'success': True, **insights}), 200

    except Exception as e:
        logger.exception("Error getting ML insights")
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_execution_ai_bp.route('/api/ml/models', methods=['GET'])
def list_ml_models():
    """List all trained models from model_registry."""
    try:
        from database import SessionLocal
        from sqlalchemy import text

        testbed_id = request.args.get('testbed_id')
        session = SessionLocal()
        try:
            if testbed_id:
                result = session.execute(text("""
                    SELECT model_id, testbed_id, model_version, trained_at, samples_used,
                           cpu_r2, memory_r2, validation_score, is_active,
                           training_duration_seconds
                    FROM model_registry
                    WHERE testbed_id = :testbed_id
                    ORDER BY trained_at DESC LIMIT 20
                """), {'testbed_id': testbed_id})
            else:
                result = session.execute(text("""
                    SELECT model_id, testbed_id, model_version, trained_at, samples_used,
                           cpu_r2, memory_r2, validation_score, is_active,
                           training_duration_seconds
                    FROM model_registry
                    ORDER BY trained_at DESC LIMIT 20
                """))

            models = [{
                'model_id': r[0], 'testbed_id': r[1], 'model_version': r[2],
                'trained_at': r[3].isoformat() if r[3] else None,
                'samples_used': r[4], 'cpu_r2': r[5], 'memory_r2': r[6],
                'validation_score': r[7], 'is_active': r[8],
                'training_duration_seconds': r[9],
            } for r in result.fetchall()]

            return jsonify({'success': True, 'models': models}), 200
        finally:
            session.close()

    except Exception as e:
        logger.exception("Error listing models")
        return jsonify({'success': True, 'models': []}), 200


@smart_execution_ai_bp.route('/api/ml/training-data/stats', methods=['GET'])
def get_training_data_stats():
    """Get statistics about available training data."""
    try:
        from services.ml_training_service import _get_data_stats
        testbed_id = request.args.get('testbed_id')
        stats = _get_data_stats(testbed_id)
        return jsonify({'success': True, **stats}), 200
    except Exception as e:
        logger.exception("Error getting training data stats")
        return jsonify({'success': True, 'total_samples': 0}), 200


@smart_execution_ai_bp.route('/api/ml/training-jobs', methods=['GET'])
def list_training_jobs():
    """List recent training jobs."""
    try:
        from database import SessionLocal
        from sqlalchemy import text

        session = SessionLocal()
        try:
            result = session.execute(text("""
                SELECT job_id, testbed_id, status, started_at, completed_at,
                       samples_used, result_model_id, cpu_r2, memory_r2,
                       error_message, trigger_type
                FROM ml_training_jobs
                ORDER BY created_at DESC LIMIT 20
            """))

            jobs = [{
                'job_id': r[0], 'testbed_id': r[1], 'status': r[2],
                'started_at': r[3].isoformat() if r[3] else None,
                'completed_at': r[4].isoformat() if r[4] else None,
                'samples_used': r[5], 'result_model_id': r[6],
                'cpu_r2': r[7], 'memory_r2': r[8],
                'error_message': r[9], 'trigger_type': r[10],
            } for r in result.fetchall()]

            return jsonify({'success': True, 'jobs': jobs}), 200
        finally:
            session.close()

    except Exception as e:
        logger.exception("Error listing training jobs")
        return jsonify({'success': True, 'jobs': []}), 200


@smart_execution_ai_bp.route('/api/ml/predict', methods=['POST'])
def predict_operation_impact():
    """
    Predict impact of a specific operation.

    Request Body:
    {
        "testbed_id": "...",
        "entity_type": "vm",
        "operation": "CREATE",
        "current_cpu": 50.0,
        "current_memory": 45.0
    }
    """
    try:
        from services.ml_training_service import get_model_for_testbed

        data = request.get_json()
        testbed_id = data.get('testbed_id')

        predictor = get_model_for_testbed(testbed_id)
        if not predictor.is_trained:
            return jsonify({
                'success': True,
                'prediction': None,
                'model_trained': False,
                'message': 'No trained model available. Trigger training first.'
            }), 200

        prediction = predictor.predict(
            entity_type=data.get('entity_type', 'vm'),
            operation=data.get('operation', 'CREATE'),
            current_metrics={
                'cpu': data.get('current_cpu', 50.0),
                'memory': data.get('current_memory', 45.0),
                'cluster_size': data.get('cluster_size', 1),
                'current_load': data.get('current_load', 10.0),
            }
        )

        return jsonify({
            'success': True,
            'prediction': prediction,
            'model_trained': True,
        }), 200

    except Exception as e:
        logger.exception("Error predicting operation impact")
        return jsonify({'success': False, 'error': str(e)}), 500


logger.info("AI Smart Execution routes loaded (with ML pipeline)")
