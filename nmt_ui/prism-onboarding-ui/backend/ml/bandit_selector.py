"""
Thompson Sampling Multi-Armed Bandit for Operation Selection

Learns which operations increase CPU/memory fastest by balancing
exploration (trying uncertain operations) vs exploitation (using known good ones).

Reward signal: actual metric increase after operation.
"""

import numpy as np
import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class ThompsonBanditSelector:
    """
    Thompson Sampling bandit that selects operations based on observed rewards.
    Uses ML predictions as informed priors when available.
    """

    def __init__(self, exploration_bonus: float = 0.15):
        self.alpha: Dict[str, float] = {}
        self.beta: Dict[str, float] = {}
        self.exploration_bonus = exploration_bonus
        self._total_selections = 0
        self._total_rewards = 0.0

    def initialize_from_ml(self, ml_recommendations: List[Dict]):
        """Seed priors from ML predictions (higher score = higher alpha)."""
        for rec in ml_recommendations:
            arm = f"{rec.get('entity', '')}.{rec.get('operation', '')}"
            if arm not in self.alpha:
                score = rec.get('score', 0.5)
                self.alpha[arm] = 1.0 + score * 5.0
                self.beta[arm] = 1.0 + (1.0 - score) * 5.0

    def select(self, available_arms: List[str], k: int = 3) -> List[str]:
        """Select k arms using Thompson Sampling from Beta distribution."""
        if not available_arms:
            return []

        samples = {}
        for arm in available_arms:
            a = self.alpha.get(arm, 1.0)
            b = self.beta.get(arm, 1.0)
            samples[arm] = np.random.beta(a, b)

        ranked = sorted(samples.keys(), key=lambda x: samples[x], reverse=True)
        self._total_selections += min(k, len(ranked))
        return ranked[:k]

    def update(self, arm: str, reward: float):
        """
        Update arm posterior based on observed reward.

        Args:
            arm: "entity_type.operation" string
            reward: metric increase caused by this operation (can be 0+)
        """
        if arm not in self.alpha:
            self.alpha[arm] = 1.0
            self.beta[arm] = 1.0

        normalized = min(reward / 5.0, 1.0) if reward > 0 else 0.0

        self.alpha[arm] += normalized
        self.beta[arm] += (1.0 - normalized)
        self._total_rewards += reward

    def get_stats(self) -> Dict:
        """Return bandit statistics for monitoring/reporting."""
        arm_stats = {}
        for arm in self.alpha:
            a = self.alpha[arm]
            b = self.beta[arm]
            arm_stats[arm] = {
                'alpha': round(a, 2),
                'beta': round(b, 2),
                'mean': round(a / (a + b), 3),
                'samples': int(a + b - 2),
            }

        return {
            'total_selections': self._total_selections,
            'total_rewards': round(self._total_rewards, 2),
            'num_arms': len(self.alpha),
            'arms': arm_stats,
        }

    def get_top_arms(self, k: int = 5) -> List[Dict]:
        """Return top-k arms ranked by expected reward."""
        arms = []
        for arm in self.alpha:
            a = self.alpha[arm]
            b = self.beta[arm]
            arms.append({
                'arm': arm,
                'expected_reward': round(a / (a + b), 3),
                'confidence': round(1.0 - b / (a + b), 3),
                'samples': int(a + b - 2),
            })
        arms.sort(key=lambda x: x['expected_reward'], reverse=True)
        return arms[:k]
