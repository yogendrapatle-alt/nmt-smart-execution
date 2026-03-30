"""
Failure Probability Predictor

Predicts whether an operation is likely to fail given current system state.
Uses a lightweight Random Forest classifier trained on historical execution data.
"""

import logging
from typing import Dict, List, Optional
from collections import defaultdict

logger = logging.getLogger(__name__)

_SKLEARN_OK = True
try:
    from sklearn.ensemble import RandomForestClassifier
    import numpy as np
except ImportError:
    _SKLEARN_OK = False


class FailurePredictor:
    """
    Lightweight failure probability estimator that tracks per-operation
    failure rates under different CPU/memory ranges and, optionally,
    trains a Random Forest classifier when enough data is collected.
    """

    def __init__(self, min_samples_for_ml: int = 50):
        self._history: List[Dict] = []
        self._failure_rates: Dict[str, Dict] = defaultdict(lambda: {'success': 0, 'fail': 0})
        self._model = None
        self._is_trained = False
        self._min_samples = min_samples_for_ml

    def record(self, entity_type: str, operation: str,
               cpu: float, memory: float, success: bool):
        """Record an operation outcome for future predictions."""
        key = f"{entity_type}.{operation}"
        if success:
            self._failure_rates[key]['success'] += 1
        else:
            self._failure_rates[key]['fail'] += 1

        self._history.append({
            'entity_type': entity_type,
            'operation': operation,
            'cpu': cpu,
            'memory': memory,
            'success': success,
        })

        if len(self._history) > 5000:
            self._history = self._history[-5000:]

        if len(self._history) % self._min_samples == 0 and _SKLEARN_OK:
            self._train()

    def predict_failure_probability(self, entity_type: str, operation: str,
                                    cpu: float, memory: float) -> float:
        """
        Return estimated failure probability (0.0 = safe, 1.0 = certain failure).
        Falls back to historical rate if ML model not ready.
        """
        if self._is_trained and _SKLEARN_OK:
            try:
                from ml.operation_impact_predictor import encode_entity, encode_operation
                features = np.array([[
                    encode_entity(entity_type),
                    encode_operation(operation),
                    cpu, memory,
                ]])
                proba = self._model.predict_proba(features)[0]
                fail_idx = list(self._model.classes_).index(False) if False in self._model.classes_ else 0
                return round(float(proba[fail_idx]), 3)
            except Exception:
                pass

        key = f"{entity_type}.{operation}"
        stats = self._failure_rates.get(key)
        if not stats:
            return 0.1
        total = stats['success'] + stats['fail']
        if total == 0:
            return 0.1
        return round(stats['fail'] / total, 3)

    def should_skip(self, entity_type: str, operation: str,
                    cpu: float, memory: float,
                    threshold: float = 0.7) -> bool:
        """Return True if predicted failure probability exceeds threshold."""
        return self.predict_failure_probability(entity_type, operation, cpu, memory) > threshold

    def _train(self):
        """Train Random Forest on collected history."""
        if not _SKLEARN_OK or len(self._history) < self._min_samples:
            return
        try:
            from ml.operation_impact_predictor import encode_entity, encode_operation
            X = np.array([
                [encode_entity(h['entity_type']), encode_operation(h['operation']),
                 h['cpu'], h['memory']]
                for h in self._history
            ])
            y = np.array([h['success'] for h in self._history])

            if len(set(y)) < 2:
                return

            clf = RandomForestClassifier(n_estimators=50, max_depth=5, random_state=42)
            clf.fit(X, y)
            self._model = clf
            self._is_trained = True
            logger.info(f"Failure predictor trained on {len(self._history)} samples")
        except Exception as e:
            logger.debug(f"Failure predictor training failed: {e}")

    def get_stats(self) -> Dict:
        return {
            'total_records': len(self._history),
            'is_trained': self._is_trained,
            'per_operation': {
                k: {'total': v['success'] + v['fail'],
                     'failure_rate': round(v['fail'] / max(1, v['success'] + v['fail']), 3)}
                for k, v in self._failure_rates.items()
            }
        }
