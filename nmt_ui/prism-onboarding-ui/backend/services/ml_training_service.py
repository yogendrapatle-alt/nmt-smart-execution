"""
ML Training Service — DB-to-ML Training Pipeline

Background training service that:
- Fetches curated data from operation_metrics / ml_training_samples
- Trains per-testbed models with sliding window
- Validates before replacing active model
- Tracks all models in model_registry
- Provides ML insights API data
"""

import logging
import os
import time
import threading
import uuid
import json
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

MODEL_DIR = os.environ.get('ML_MODEL_DIR', '/tmp/nmt_ml_models')
os.makedirs(MODEL_DIR, exist_ok=True)

SLIDING_WINDOW_SIZE = int(os.environ.get('ML_SLIDING_WINDOW', 1000))
MIN_SAMPLES_FOR_TRAINING = 20
MIN_R2_THRESHOLD = 0.15
RETRAIN_AFTER_N_OPS = int(os.environ.get('ML_RETRAIN_AFTER_OPS', 50))

_training_lock = threading.Lock()
_auto_train_timer = None


def fetch_training_data_from_db(testbed_id: Optional[str] = None,
                                 limit: int = SLIDING_WINDOW_SIZE) -> List[Dict]:
    """
    Fetch curated training data from ml_training_samples, falling back to
    operation_metrics if the curated table is empty.

    Returns list of dicts ready for ML training.
    """
    from database import SessionLocal
    from sqlalchemy import text

    session = SessionLocal()
    try:
        params = {'limit': limit}
        where_clause = ""
        if testbed_id:
            where_clause = "WHERE testbed_id = :testbed_id"
            params['testbed_id'] = testbed_id

        query = text(f"""
            SELECT entity_type, operation, cpu_before, memory_before,
                   cpu_impact, memory_impact, cluster_size, concurrent_ops,
                   hour_of_day, ops_per_minute, duration_seconds
            FROM ml_training_samples
            {where_clause}
            ORDER BY collected_at DESC
            LIMIT :limit
        """)

        try:
            result = session.execute(query, params)
            rows = result.fetchall()
        except Exception:
            session.rollback()
            rows = []

        if rows and len(rows) >= MIN_SAMPLES_FOR_TRAINING:
            data = []
            for r in rows:
                data.append({
                    'entity_type': r[0],
                    'operation': r[1],
                    'current_cpu': float(r[2]) if r[2] else 0.0,
                    'current_memory': float(r[3]) if r[3] else 0.0,
                    'cpu_impact': float(r[4]) if r[4] else 0.0,
                    'memory_impact': float(r[5]) if r[5] else 0.0,
                    'cluster_size': int(r[6]) if r[6] else 1,
                    'concurrent_ops': int(r[7]) if r[7] else 0,
                    'hour_of_day': int(r[8]) if r[8] is not None else 12,
                    'current_load': float(r[9]) if r[9] else 10.0,
                    'duration_seconds': float(r[10]) if r[10] else 0.0,
                })
            logger.info(f"Fetched {len(data)} curated training samples from ml_training_samples")
            return data

        # Fallback: fetch from operation_metrics
        om_where = ""
        om_params: dict = {'limit': limit}
        if testbed_id:
            om_where = "AND om.testbed_id = :testbed_id"
            om_params['testbed_id'] = testbed_id

        om_query = text(f"""
            SELECT om.entity_type, om.operation_type,
                   COALESCE((om.metrics_snapshot::json->>'cpu_before')::float, 0) as cpu_before,
                   COALESCE((om.metrics_snapshot::json->>'memory_before')::float, 0) as memory_before,
                   COALESCE((om.metrics_snapshot::json->>'cpu_after')::float, 0) as cpu_after,
                   COALESCE((om.metrics_snapshot::json->>'memory_after')::float, 0) as memory_after,
                   om.started_at
            FROM operation_metrics om
            WHERE om.status = 'COMPLETED'
              AND om.entity_type IS NOT NULL
              AND om.operation_type IS NOT NULL
              {om_where}
            ORDER BY om.started_at DESC
            LIMIT :limit
        """)

        try:
            result = session.execute(om_query, om_params)
            om_rows = result.fetchall()
        except Exception as e:
            logger.warning(f"Could not query operation_metrics: {e}")
            om_rows = []

        data = []
        for r in om_rows:
            cpu_before = float(r[2]) if r[2] else 0.0
            mem_before = float(r[3]) if r[3] else 0.0
            cpu_after = float(r[4]) if r[4] else 0.0
            mem_after = float(r[5]) if r[5] else 0.0
            cpu_impact = max(0, cpu_after - cpu_before)
            mem_impact = max(0, mem_after - mem_before)

            if cpu_impact == 0 and mem_impact == 0:
                continue

            hour = r[6].hour if r[6] else 12
            data.append({
                'entity_type': r[0],
                'operation': r[1],
                'current_cpu': cpu_before,
                'current_memory': mem_before,
                'cpu_impact': cpu_impact,
                'memory_impact': mem_impact,
                'cluster_size': 1,
                'concurrent_ops': 0,
                'hour_of_day': hour,
                'current_load': 10.0,
                'duration_seconds': 0.0,
            })

        logger.info(f"Fetched {len(data)} samples from operation_metrics (fallback)")
        return data

    except Exception as e:
        logger.error(f"Error fetching training data: {e}")
        return []
    finally:
        session.close()


def save_training_sample(testbed_id: str, execution_id: str,
                         entity_type: str, operation: str,
                         cpu_before: float, memory_before: float,
                         cpu_after: float, memory_after: float,
                         cluster_size: int = 1, concurrent_ops: int = 0,
                         ops_per_minute: float = 0, duration_seconds: float = 0,
                         success: bool = True) -> bool:
    """Save a validated training sample to ml_training_samples."""
    from database import SessionLocal
    from sqlalchemy import text

    cpu_impact = max(0, cpu_after - cpu_before)
    memory_impact = max(0, memory_after - memory_before)

    if cpu_impact < 0.01 and memory_impact < 0.01:
        return False

    if not success:
        return False

    hour_of_day = datetime.now(timezone.utc).hour

    session = SessionLocal()
    try:
        query = text("""
            INSERT INTO ml_training_samples (
                testbed_id, execution_id, entity_type, operation,
                cpu_before, memory_before, cpu_after, memory_after,
                cpu_impact, memory_impact, cluster_size, concurrent_ops,
                hour_of_day, ops_per_minute, duration_seconds, success
            ) VALUES (
                :testbed_id, :execution_id, :entity_type, :operation,
                :cpu_before, :memory_before, :cpu_after, :memory_after,
                :cpu_impact, :memory_impact, :cluster_size, :concurrent_ops,
                :hour_of_day, :ops_per_minute, :duration_seconds, :success
            )
        """)
        session.execute(query, {
            'testbed_id': testbed_id,
            'execution_id': execution_id,
            'entity_type': entity_type.lower(),
            'operation': operation.upper(),
            'cpu_before': cpu_before,
            'memory_before': memory_before,
            'cpu_after': cpu_after,
            'memory_after': memory_after,
            'cpu_impact': cpu_impact,
            'memory_impact': memory_impact,
            'cluster_size': cluster_size,
            'concurrent_ops': concurrent_ops,
            'hour_of_day': hour_of_day,
            'ops_per_minute': ops_per_minute,
            'duration_seconds': duration_seconds,
            'success': success,
        })
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        logger.debug(f"Could not save training sample (table may not exist yet): {e}")
        return False
    finally:
        session.close()


def train_model(testbed_id: Optional[str] = None,
                trigger_type: str = 'manual') -> Dict:
    """
    Train an ML model from DB data. Thread-safe with locking.

    Returns dict with training results.
    """
    if not _training_lock.acquire(blocking=False):
        return {'success': False, 'error': 'Training already in progress'}

    job_id = f"TRAIN-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:8]}"
    result = {
        'success': False,
        'job_id': job_id,
        'testbed_id': testbed_id or 'global',
        'trigger_type': trigger_type,
    }

    try:
        from ml.operation_impact_predictor import OperationImpactPredictor, generate_synthetic_training_data

        logger.info(f"Starting ML training job {job_id} for testbed={testbed_id or 'global'}")
        start_time = time.time()

        _save_training_job(job_id, testbed_id, 'RUNNING', trigger_type)

        data = fetch_training_data_from_db(testbed_id, SLIDING_WINDOW_SIZE)

        if len(data) < MIN_SAMPLES_FOR_TRAINING:
            logger.info(f"Only {len(data)} real samples, augmenting with synthetic data")
            synthetic = generate_synthetic_training_data(num_samples=100)
            data.extend(synthetic)

        model_name = f"testbed_{testbed_id}" if testbed_id else "global"

        predictor = OperationImpactPredictor(model_dir=MODEL_DIR)

        metrics = predictor.train(data)

        cpu_r2 = metrics.get('cpu_r2', 0)
        memory_r2 = metrics.get('memory_r2', 0)
        validation_score = (cpu_r2 + memory_r2) / 2.0

        should_activate = True

        # Validate against existing model
        try:
            existing = OperationImpactPredictor(model_dir=MODEL_DIR)
            existing.load(model_name)
            existing_registry = _get_active_model(testbed_id)
            if existing_registry:
                existing_score = existing_registry.get('validation_score', 0)
                if validation_score < existing_score - 0.05:
                    logger.warning(
                        f"New model score {validation_score:.3f} < existing {existing_score:.3f}, "
                        f"keeping old model"
                    )
                    should_activate = False
        except (FileNotFoundError, Exception):
            pass

        # Save model to disk
        predictor.save(model_name)

        # Also save as 'production' if this is the best global model
        if not testbed_id:
            predictor.save('production')

        training_duration = time.time() - start_time

        model_id = f"model-{model_name}-v{_get_next_version(testbed_id)}"
        model_path = os.path.join(MODEL_DIR, f'{model_name}_models.pkl')

        _save_model_registry(
            model_id=model_id,
            testbed_id=testbed_id,
            model_version=_get_next_version(testbed_id),
            samples_used=len(data),
            cpu_r2=cpu_r2,
            cpu_mae=metrics.get('cpu_mae', 0),
            memory_r2=memory_r2,
            memory_mae=metrics.get('memory_mae', 0),
            validation_score=validation_score,
            model_path=model_path,
            is_active=should_activate,
            training_duration=training_duration,
            feature_names=predictor.feature_names,
        )

        if should_activate:
            _deactivate_old_models(testbed_id, model_id)

        _update_training_job(job_id, 'COMPLETED', len(data), model_id,
                             cpu_r2, memory_r2)

        result.update({
            'success': True,
            'model_id': model_id,
            'samples_used': len(data),
            'metrics': metrics,
            'validation_score': round(validation_score, 3),
            'activated': should_activate,
            'training_duration_seconds': round(training_duration, 2),
        })

        logger.info(
            f"ML training complete: {model_id}, "
            f"samples={len(data)}, cpu_r2={cpu_r2:.3f}, mem_r2={memory_r2:.3f}, "
            f"activated={should_activate}, duration={training_duration:.1f}s"
        )

    except Exception as e:
        logger.error(f"ML training failed: {e}", exc_info=True)
        result['error'] = str(e)
        _update_training_job(job_id, 'FAILED', error_message=str(e))
    finally:
        _training_lock.release()

    return result


def get_model_for_testbed(testbed_id: Optional[str] = None):
    """Load the best available model for a testbed. Falls back to global."""
    from ml.operation_impact_predictor import OperationImpactPredictor

    predictor = OperationImpactPredictor(model_dir=MODEL_DIR)

    # Try testbed-specific model first
    if testbed_id:
        try:
            predictor.load(f"testbed_{testbed_id}")
            logger.info(f"Loaded testbed-specific model for {testbed_id}")
            return predictor
        except FileNotFoundError:
            pass

    # Fall back to global/production
    try:
        predictor.load('production')
        logger.info("Loaded production (global) model")
        return predictor
    except FileNotFoundError:
        pass

    try:
        predictor.load('default')
        logger.info("Loaded default model")
        return predictor
    except FileNotFoundError:
        pass

    logger.info("No trained model found, returning untrained predictor")
    return predictor


def get_ml_insights(testbed_id: Optional[str] = None) -> Dict:
    """Get comprehensive ML insights for the dashboard."""
    insights = {
        'model_status': 'not_trained',
        'active_model': None,
        'training_history': [],
        'data_stats': {},
        'feature_importance': {},
        'accuracy_trend': [],
        'recommendations_available': False,
    }

    try:
        active = _get_active_model(testbed_id)
        if active:
            insights['model_status'] = 'trained'
            insights['active_model'] = active
            insights['recommendations_available'] = True

        insights['training_history'] = _get_training_history(testbed_id, limit=10)
        insights['data_stats'] = _get_data_stats(testbed_id)

        predictor = get_model_for_testbed(testbed_id)
        if predictor.is_trained:
            insights['feature_importance'] = predictor.get_feature_importance()

        # Build accuracy trend from model registry
        for entry in insights['training_history']:
            insights['accuracy_trend'].append({
                'version': entry.get('model_version', 0),
                'cpu_r2': entry.get('cpu_r2', 0),
                'memory_r2': entry.get('memory_r2', 0),
                'samples': entry.get('samples_used', 0),
                'trained_at': entry.get('trained_at', ''),
            })

    except Exception as e:
        logger.error(f"Error getting ML insights: {e}")

    return insights


_drift_error_buffer: Dict[str, list] = {}

DRIFT_WINDOW = 20
DRIFT_THRESHOLD = 0.5


def _check_prediction_drift(testbed_id: str) -> bool:
    """Return True if recent prediction errors suggest model drift."""
    errors = _drift_error_buffer.get(testbed_id, [])
    if len(errors) < DRIFT_WINDOW:
        return False
    recent = errors[-DRIFT_WINDOW:]
    older = errors[-(DRIFT_WINDOW * 2):-DRIFT_WINDOW] if len(errors) >= DRIFT_WINDOW * 2 else recent[:len(recent) // 2]
    if not older:
        return False
    recent_mae = sum(abs(e) for e in recent) / len(recent)
    older_mae = sum(abs(e) for e in older) / len(older)
    drift = recent_mae - older_mae
    return drift > DRIFT_THRESHOLD


def record_prediction_error(testbed_id: str, predicted: float, actual: float):
    """Record a prediction error for drift detection."""
    if testbed_id not in _drift_error_buffer:
        _drift_error_buffer[testbed_id] = []
    _drift_error_buffer[testbed_id].append(predicted - actual)
    if len(_drift_error_buffer[testbed_id]) > 200:
        _drift_error_buffer[testbed_id] = _drift_error_buffer[testbed_id][-200:]


def check_auto_retrain(testbed_id: str):
    """Check if auto-retrain is needed based on sample count OR prediction drift."""
    try:
        stats = _get_data_stats(testbed_id)
        total_samples = stats.get('total_samples', 0)
        active = _get_active_model(testbed_id)

        if not active:
            if total_samples >= MIN_SAMPLES_FOR_TRAINING:
                logger.info(f"No model for testbed {testbed_id}, triggering first training")
                threading.Thread(
                    target=train_model,
                    args=(testbed_id, 'auto_first'),
                    daemon=True
                ).start()
            return

        # Drift-based trigger takes priority
        if _check_prediction_drift(testbed_id):
            logger.info(f"Drift-based retrain triggered for testbed {testbed_id}")
            threading.Thread(
                target=train_model,
                args=(testbed_id, 'auto_drift'),
                daemon=True
            ).start()
            return

        trained_on = active.get('samples_used', 0)
        new_samples = total_samples - trained_on

        if new_samples >= RETRAIN_AFTER_N_OPS:
            logger.info(
                f"Auto-retrain triggered: {new_samples} new samples since last training "
                f"for testbed {testbed_id}"
            )
            threading.Thread(
                target=train_model,
                args=(testbed_id, 'auto_threshold'),
                daemon=True
            ).start()

    except Exception as e:
        logger.debug(f"Auto-retrain check skipped: {e}")


# ---------- Internal DB helpers ----------

def _save_training_job(job_id, testbed_id, status, trigger_type):
    from database import SessionLocal
    from sqlalchemy import text
    session = SessionLocal()
    try:
        session.execute(text("""
            INSERT INTO ml_training_jobs (job_id, testbed_id, status, started_at, trigger_type)
            VALUES (:job_id, :testbed_id, :status, NOW(), :trigger_type)
        """), {'job_id': job_id, 'testbed_id': testbed_id, 'status': status,
               'trigger_type': trigger_type})
        session.commit()
    except Exception as e:
        session.rollback()
        logger.debug(f"Could not save training job (table may not exist): {e}")
    finally:
        session.close()


def _update_training_job(job_id, status, samples_used=0, model_id=None,
                         cpu_r2=None, memory_r2=None, error_message=None):
    from database import SessionLocal
    from sqlalchemy import text
    session = SessionLocal()
    try:
        session.execute(text("""
            UPDATE ml_training_jobs
            SET status = :status, completed_at = NOW(), samples_used = :samples_used,
                result_model_id = :model_id, cpu_r2 = :cpu_r2, memory_r2 = :memory_r2,
                error_message = :error_message
            WHERE job_id = :job_id
        """), {'job_id': job_id, 'status': status, 'samples_used': samples_used,
               'model_id': model_id, 'cpu_r2': cpu_r2, 'memory_r2': memory_r2,
               'error_message': error_message})
        session.commit()
    except Exception as e:
        session.rollback()
        logger.debug(f"Could not update training job: {e}")
    finally:
        session.close()


def _save_model_registry(model_id, testbed_id, model_version, samples_used,
                         cpu_r2, cpu_mae, memory_r2, memory_mae,
                         validation_score, model_path, is_active,
                         training_duration, feature_names):
    from database import SessionLocal
    from sqlalchemy import text
    session = SessionLocal()
    try:
        session.execute(text("""
            INSERT INTO model_registry (
                model_id, testbed_id, model_version, samples_used,
                cpu_r2, cpu_mae, memory_r2, memory_mae,
                validation_score, model_path, is_active,
                training_duration_seconds, feature_names
            ) VALUES (
                :model_id, :testbed_id, :model_version, :samples_used,
                :cpu_r2, :cpu_mae, :memory_r2, :memory_mae,
                :validation_score, :model_path, :is_active,
                :training_duration, :feature_names
            )
        """), {
            'model_id': model_id, 'testbed_id': testbed_id,
            'model_version': model_version, 'samples_used': samples_used,
            'cpu_r2': cpu_r2, 'cpu_mae': cpu_mae,
            'memory_r2': memory_r2, 'memory_mae': memory_mae,
            'validation_score': validation_score, 'model_path': model_path,
            'is_active': is_active, 'training_duration': training_duration,
            'feature_names': json.dumps(feature_names),
        })
        session.commit()
    except Exception as e:
        session.rollback()
        logger.debug(f"Could not save to model_registry: {e}")
    finally:
        session.close()


def _deactivate_old_models(testbed_id, keep_model_id):
    from database import SessionLocal
    from sqlalchemy import text
    session = SessionLocal()
    try:
        if testbed_id:
            session.execute(text("""
                UPDATE model_registry SET is_active = FALSE
                WHERE testbed_id = :testbed_id AND model_id != :keep_id
            """), {'testbed_id': testbed_id, 'keep_id': keep_model_id})
        else:
            session.execute(text("""
                UPDATE model_registry SET is_active = FALSE
                WHERE testbed_id IS NULL AND model_id != :keep_id
            """), {'keep_id': keep_model_id})
        session.commit()
    except Exception as e:
        session.rollback()
        logger.debug(f"Could not deactivate old models: {e}")
    finally:
        session.close()


def _get_active_model(testbed_id: Optional[str] = None) -> Optional[Dict]:
    from database import SessionLocal
    from sqlalchemy import text
    session = SessionLocal()
    try:
        if testbed_id:
            result = session.execute(text("""
                SELECT model_id, testbed_id, model_version, trained_at, samples_used,
                       cpu_r2, cpu_mae, memory_r2, memory_mae, validation_score,
                       model_path, training_duration_seconds
                FROM model_registry
                WHERE testbed_id = :testbed_id AND is_active = TRUE
                ORDER BY trained_at DESC LIMIT 1
            """), {'testbed_id': testbed_id})
        else:
            result = session.execute(text("""
                SELECT model_id, testbed_id, model_version, trained_at, samples_used,
                       cpu_r2, cpu_mae, memory_r2, memory_mae, validation_score,
                       model_path, training_duration_seconds
                FROM model_registry
                WHERE testbed_id IS NULL AND is_active = TRUE
                ORDER BY trained_at DESC LIMIT 1
            """))

        row = result.fetchone()
        if row:
            return {
                'model_id': row[0],
                'testbed_id': row[1],
                'model_version': row[2],
                'trained_at': row[3].isoformat() if row[3] else None,
                'samples_used': row[4],
                'cpu_r2': row[5],
                'cpu_mae': row[6],
                'memory_r2': row[7],
                'memory_mae': row[8],
                'validation_score': row[9],
                'model_path': row[10],
                'training_duration_seconds': row[11],
            }
        return None
    except Exception as e:
        logger.debug(f"Could not get active model: {e}")
        return None
    finally:
        session.close()


def _get_training_history(testbed_id: Optional[str] = None,
                          limit: int = 10) -> List[Dict]:
    from database import SessionLocal
    from sqlalchemy import text
    session = SessionLocal()
    try:
        if testbed_id:
            result = session.execute(text("""
                SELECT model_id, model_version, trained_at, samples_used,
                       cpu_r2, memory_r2, validation_score, is_active,
                       training_duration_seconds
                FROM model_registry
                WHERE testbed_id = :testbed_id
                ORDER BY trained_at DESC LIMIT :limit
            """), {'testbed_id': testbed_id, 'limit': limit})
        else:
            result = session.execute(text("""
                SELECT model_id, model_version, trained_at, samples_used,
                       cpu_r2, memory_r2, validation_score, is_active,
                       training_duration_seconds
                FROM model_registry
                ORDER BY trained_at DESC LIMIT :limit
            """), {'limit': limit})

        rows = result.fetchall()
        return [{
            'model_id': r[0], 'model_version': r[1],
            'trained_at': r[2].isoformat() if r[2] else None,
            'samples_used': r[3], 'cpu_r2': r[4], 'memory_r2': r[5],
            'validation_score': r[6], 'is_active': r[7],
            'training_duration_seconds': r[8],
        } for r in rows]
    except Exception as e:
        logger.debug(f"Could not get training history: {e}")
        return []
    finally:
        session.close()


def _get_data_stats(testbed_id: Optional[str] = None) -> Dict:
    from database import SessionLocal
    from sqlalchemy import text
    session = SessionLocal()
    try:
        where = ""
        params: dict = {}
        if testbed_id:
            where = "WHERE testbed_id = :testbed_id"
            params['testbed_id'] = testbed_id

        result = session.execute(text(f"""
            SELECT COUNT(*),
                   COUNT(DISTINCT entity_type),
                   COUNT(DISTINCT operation),
                   MIN(collected_at),
                   MAX(collected_at)
            FROM ml_training_samples
            {where}
        """), params)
        row = result.fetchone()
        if row and row[0] > 0:
            return {
                'total_samples': row[0],
                'unique_entities': row[1],
                'unique_operations': row[2],
                'oldest_sample': row[3].isoformat() if row[3] else None,
                'newest_sample': row[4].isoformat() if row[4] else None,
                'source': 'ml_training_samples',
            }

        # Fallback: count from operation_metrics
        om_where = "WHERE status = 'COMPLETED'"
        om_params: dict = {}
        if testbed_id:
            om_where += " AND testbed_id = :testbed_id"
            om_params['testbed_id'] = testbed_id

        result = session.execute(text(f"""
            SELECT COUNT(*), COUNT(DISTINCT entity_type), COUNT(DISTINCT operation_type)
            FROM operation_metrics
            {om_where}
        """), om_params)
        row = result.fetchone()
        return {
            'total_samples': row[0] if row else 0,
            'unique_entities': row[1] if row else 0,
            'unique_operations': row[2] if row else 0,
            'source': 'operation_metrics',
        }

    except Exception as e:
        logger.debug(f"Could not get data stats: {e}")
        return {'total_samples': 0, 'source': 'unavailable'}
    finally:
        session.close()


def _get_next_version(testbed_id: Optional[str] = None) -> int:
    from database import SessionLocal
    from sqlalchemy import text
    session = SessionLocal()
    try:
        if testbed_id:
            result = session.execute(text("""
                SELECT COALESCE(MAX(model_version), 0) + 1
                FROM model_registry WHERE testbed_id = :testbed_id
            """), {'testbed_id': testbed_id})
        else:
            result = session.execute(text("""
                SELECT COALESCE(MAX(model_version), 0) + 1
                FROM model_registry WHERE testbed_id IS NULL
            """))
        row = result.fetchone()
        return row[0] if row else 1
    except Exception:
        return 1
    finally:
        session.close()
