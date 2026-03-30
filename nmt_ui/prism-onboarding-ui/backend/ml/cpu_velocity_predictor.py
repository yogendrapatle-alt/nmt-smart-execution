"""
CPU Velocity Predictor

Uses recent CPU measurements to compute instantaneous velocity (rate of change)
and predicts whether the next iteration will overshoot the threshold.

If the predicted CPU exceeds the threshold, the module recommends reducing
the operation count by a proportional factor.

This is a zero-dependency module (no scikit-learn required).
"""

import logging
from typing import Dict, List, Optional
from collections import deque

logger = logging.getLogger(__name__)


class CPUVelocityPredictor:
    """
    Predicts CPU value at the next iteration using linear velocity extrapolation.

    velocity = cpu_now - cpu_previous
    predicted  = cpu_now + velocity

    When predicted >= threshold, returns a throttle factor (0..1) that should
    be multiplied with the planned operation count to avoid overshoot.
    """

    def __init__(self, window: int = 5, safety_margin: float = 2.0):
        """
        Args:
            window: Number of recent readings to average velocity over.
            safety_margin: Extra percentage below threshold to start throttling.
        """
        self._window = window
        self._safety_margin = safety_margin
        self._history: deque = deque(maxlen=max(window + 1, 10))
        self._predictions: List[Dict] = []

    def record(self, cpu: float):
        """Record a CPU measurement."""
        self._history.append(cpu)

    def predict(self, cpu_threshold: float) -> Dict:
        """
        Predict next-iteration CPU and recommend throttle factor.

        Returns:
            {
                'current_cpu': float,
                'velocity': float,        # %/iteration
                'predicted_cpu': float,    # extrapolated
                'will_overshoot': bool,
                'throttle_factor': float,  # 1.0 = no change, 0.0 = stop
                'confidence': str,
            }
        """
        if len(self._history) < 2:
            return {
                'current_cpu': self._history[-1] if self._history else 0,
                'velocity': 0.0,
                'predicted_cpu': self._history[-1] if self._history else 0,
                'will_overshoot': False,
                'throttle_factor': 1.0,
                'confidence': 'low',
            }

        velocities = []
        items = list(self._history)
        for i in range(1, len(items)):
            velocities.append(items[i] - items[i - 1])

        recent = velocities[-self._window:] if len(velocities) >= self._window else velocities
        avg_velocity = sum(recent) / len(recent)

        current = items[-1]
        predicted = current + avg_velocity
        effective_threshold = cpu_threshold - self._safety_margin

        will_overshoot = predicted >= effective_threshold and avg_velocity > 0

        throttle = 1.0
        if will_overshoot:
            headroom = max(effective_threshold - current, 0.5)
            overshoot_amount = predicted - effective_threshold
            throttle = max(0.1, headroom / (headroom + overshoot_amount))

        confidence = 'high' if len(recent) >= self._window else 'medium' if len(recent) >= 2 else 'low'

        result = {
            'current_cpu': round(current, 2),
            'velocity': round(avg_velocity, 3),
            'predicted_cpu': round(predicted, 2),
            'will_overshoot': will_overshoot,
            'throttle_factor': round(throttle, 3),
            'confidence': confidence,
        }

        self._predictions.append(result)
        if len(self._predictions) > 100:
            self._predictions = self._predictions[-100:]

        if will_overshoot:
            logger.info(
                f"CPU velocity warning: v={avg_velocity:+.2f}%/iter, "
                f"predicted={predicted:.1f}%, threshold={cpu_threshold}%, "
                f"throttle={throttle:.2f}"
            )

        return result

    def get_stats(self) -> Dict:
        """Return predictor statistics."""
        items = list(self._history)
        if len(items) < 2:
            return {
                'readings': len(items),
                'avg_velocity': 0,
                'overshoot_warnings': 0,
            }

        velocities = [items[i] - items[i - 1] for i in range(1, len(items))]
        warnings = sum(1 for p in self._predictions if p.get('will_overshoot'))

        return {
            'readings': len(items),
            'avg_velocity': round(sum(velocities) / len(velocities), 3),
            'max_velocity': round(max(velocities), 3),
            'min_velocity': round(min(velocities), 3),
            'overshoot_warnings': warnings,
            'total_predictions': len(self._predictions),
        }
