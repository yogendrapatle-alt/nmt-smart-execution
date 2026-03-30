"""
IsolationForest Anomaly Detector for Smart Execution

Detects abnormal metric patterns during execution (e.g., sudden CPU spikes,
unusual memory patterns, abnormal operation rates).

Features used:
  - cpu_percent
  - memory_percent
  - ops_per_minute
  - parallel_ops
"""

import numpy as np
import logging
from typing import Dict, List, Optional
from collections import deque

logger = logging.getLogger(__name__)

_SKLEARN_AVAILABLE = True
try:
    from sklearn.ensemble import IsolationForest
except ImportError:
    _SKLEARN_AVAILABLE = False


class MetricAnomalyDetector:
    """
    Uses IsolationForest for unsupervised anomaly detection on execution metrics.
    Maintains a rolling window of observations and retrains periodically.
    """

    FEATURE_KEYS = ['cpu_percent', 'memory_percent', 'ops_per_minute', 'parallel_ops']

    def __init__(
        self,
        window_size: int = 200,
        contamination: float = 0.05,
        retrain_interval: int = 50,
    ):
        if not _SKLEARN_AVAILABLE:
            logger.warning("scikit-learn not available; anomaly detector disabled")

        self._window = deque(maxlen=window_size)
        self._contamination = contamination
        self._retrain_interval = retrain_interval
        self._model: Optional[object] = None
        self._is_fitted = False
        self._samples_since_fit = 0
        self._anomaly_count = 0
        self._total_checked = 0

    def add_observation(self, metrics: Dict) -> Optional[Dict]:
        """
        Add a metric observation and return an anomaly verdict if model is ready.

        Returns:
            None if model not yet ready, otherwise dict with:
                is_anomaly: bool
                score: float (lower = more anomalous)
                features: dict of feature values used
        """
        row = self._extract_features(metrics)
        if row is None:
            return None

        self._window.append(row)
        self._samples_since_fit += 1

        if self._samples_since_fit >= self._retrain_interval and len(self._window) >= 30:
            self._fit()

        if not self._is_fitted:
            return None

        return self._predict(row, metrics)

    def _extract_features(self, metrics: Dict) -> Optional[np.ndarray]:
        """Extract feature vector from metrics dict."""
        try:
            row = np.array([
                float(metrics.get('cpu_percent', 0)),
                float(metrics.get('memory_percent', 0)),
                float(metrics.get('ops_per_minute', 0)),
                float(metrics.get('parallel_ops', 0)),
            ])
            return row
        except (TypeError, ValueError):
            return None

    def _fit(self):
        """Retrain IsolationForest on current window."""
        if not _SKLEARN_AVAILABLE:
            return
        try:
            X = np.array(list(self._window))
            self._model = IsolationForest(
                contamination=self._contamination,
                n_estimators=100,
                random_state=42,
                n_jobs=1,
            )
            self._model.fit(X)
            self._is_fitted = True
            self._samples_since_fit = 0
            logger.info(f"Anomaly detector retrained on {len(X)} samples")
        except Exception as e:
            logger.warning(f"Anomaly detector fit failed: {e}")

    def _predict(self, row: np.ndarray, raw_metrics: Dict) -> Dict:
        """Score a single observation."""
        self._total_checked += 1
        try:
            score = self._model.decision_function(row.reshape(1, -1))[0]
            label = self._model.predict(row.reshape(1, -1))[0]
            is_anomaly = label == -1

            if is_anomaly:
                self._anomaly_count += 1
                logger.warning(
                    f"Anomaly detected: score={score:.3f} "
                    f"cpu={raw_metrics.get('cpu_percent')}, "
                    f"mem={raw_metrics.get('memory_percent')}"
                )

            return {
                'is_anomaly': is_anomaly,
                'score': round(float(score), 4),
                'features': {k: raw_metrics.get(k, 0) for k in self.FEATURE_KEYS},
            }
        except Exception as e:
            logger.debug(f"Anomaly prediction failed: {e}")
            return None

    def get_stats(self) -> Dict:
        return {
            'is_fitted': self._is_fitted,
            'window_size': len(self._window),
            'total_checked': self._total_checked,
            'anomaly_count': self._anomaly_count,
            'anomaly_rate': round(
                self._anomaly_count / max(1, self._total_checked), 4
            ),
        }
