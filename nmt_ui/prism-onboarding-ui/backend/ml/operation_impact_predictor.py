"""
ML-Based Operation Impact Predictor

Predicts CPU and Memory impact of different entity operations using
supervised machine learning (scikit-learn).

Features:
- Predict impact of individual operations
- Recommend best operations to reach target
- Learn from historical execution data
- Handle categorical features (entity types, operations)
"""

import numpy as np
import logging
import joblib
import os
from typing import List, Dict, Tuple, Optional
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score

logger = logging.getLogger(__name__)


class OperationImpactPredictor:
    """
    Predicts CPU and Memory impact of NCM operations using ML
    
    Uses Gradient Boosting for prediction with the following features:
    - Entity Type (VM, Blueprint, etc.)
    - Operation Type (CREATE, DELETE, UPDATE, etc.)
    - Current System Metrics (CPU, Memory, Load)
    - Cluster Size
    """
    
    def __init__(self, model_dir: str = None):
        """
        Initialize the predictor
        
        Args:
            model_dir: Directory to save/load models (optional)
        """
        # ML Models for CPU and Memory prediction
        self.cpu_model = GradientBoostingRegressor(
            n_estimators=100,
            learning_rate=0.1,
            max_depth=5,
            min_samples_split=5,
            min_samples_leaf=2,
            random_state=42
        )
        
        self.memory_model = GradientBoostingRegressor(
            n_estimators=100,
            learning_rate=0.1,
            max_depth=5,
            min_samples_split=5,
            min_samples_leaf=2,
            random_state=42
        )
        
        # Encoders for categorical features
        self.entity_encoder = LabelEncoder()
        self.operation_encoder = LabelEncoder()
        
        # Training state
        self.is_trained = False
        self.feature_names = [
            'entity_encoded',
            'operation_encoded',
            'current_cpu',
            'current_memory',
            'cluster_size',
            'current_load'
        ]
        
        # Model directory
        self.model_dir = model_dir or '/tmp/nmt_ml_models'
        os.makedirs(self.model_dir, exist_ok=True)
        
        logger.info("🤖 ML Operation Impact Predictor initialized")
    
    def train(self, historical_data: List[Dict]) -> Dict:
        """
        Train the models on historical execution data
        
        Args:
            historical_data: List of execution records with:
                - entity_type: str (e.g., 'vm', 'blueprint')
                - operation: str (e.g., 'CREATE', 'DELETE')
                - current_cpu: float (CPU before operation)
                - current_memory: float (Memory before operation)
                - cluster_size: int
                - current_load: float (operations per minute)
                - cpu_impact: float (CPU increase after operation)
                - memory_impact: float (Memory increase after operation)
                
        Returns:
            Dictionary with training metrics
        """
        if len(historical_data) < 20:
            raise ValueError(f"Need at least 20 samples for training, got {len(historical_data)}")
        
        logger.info(f"📚 Training ML models on {len(historical_data)} samples...")
        
        # Extract features and targets
        X, y_cpu, y_memory = self._prepare_training_data(historical_data)
        
        # Split into train and test
        X_train, X_test, y_cpu_train, y_cpu_test, y_memory_train, y_memory_test = \
            train_test_split(X, y_cpu, y_memory, test_size=0.2, random_state=42)
        
        # Train CPU model
        logger.info("Training CPU impact model...")
        self.cpu_model.fit(X_train, y_cpu_train)
        cpu_pred = self.cpu_model.predict(X_test)
        cpu_mae = mean_absolute_error(y_cpu_test, cpu_pred)
        cpu_r2 = r2_score(y_cpu_test, cpu_pred)
        
        # Train Memory model
        logger.info("Training Memory impact model...")
        self.memory_model.fit(X_train, y_memory_train)
        memory_pred = self.memory_model.predict(X_test)
        memory_mae = mean_absolute_error(y_memory_test, memory_pred)
        memory_r2 = r2_score(y_memory_test, memory_pred)
        
        self.is_trained = True
        
        metrics = {
            'cpu_mae': round(cpu_mae, 3),
            'cpu_r2': round(cpu_r2, 3),
            'memory_mae': round(memory_mae, 3),
            'memory_r2': round(memory_r2, 3),
            'train_samples': len(X_train),
            'test_samples': len(X_test)
        }
        
        logger.info(f"✅ Training complete! CPU MAE={cpu_mae:.3f}, Memory MAE={memory_mae:.3f}")
        
        return metrics
    
    def _prepare_training_data(self, data: List[Dict]) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Convert raw data into feature matrix and target vectors
        
        Args:
            data: List of historical records
            
        Returns:
            Tuple of (X, y_cpu, y_memory)
        """
        # Extract all unique entities and operations for encoding
        entities = [d['entity_type'] for d in data]
        operations = [d['operation'] for d in data]
        
        # Fit encoders
        self.entity_encoder.fit(entities)
        self.operation_encoder.fit(operations)
        
        # Build feature matrix
        features = []
        cpu_targets = []
        memory_targets = []
        
        for record in data:
            entity_encoded = self.entity_encoder.transform([record['entity_type']])[0]
            operation_encoded = self.operation_encoder.transform([record['operation']])[0]
            
            feature_vector = [
                entity_encoded,
                operation_encoded,
                record.get('current_cpu', 0),
                record.get('current_memory', 0),
                record.get('cluster_size', 1),
                record.get('current_load', 10)
            ]
            
            features.append(feature_vector)
            cpu_targets.append(record.get('cpu_impact', 0))
            memory_targets.append(record.get('memory_impact', 0))
        
        return (
            np.array(features),
            np.array(cpu_targets),
            np.array(memory_targets)
        )
    
    def predict(self, entity_type: str, operation: str, current_metrics: Dict) -> Dict:
        """
        Predict impact of a specific operation
        
        Args:
            entity_type: Entity type (e.g., 'vm', 'blueprint')
            operation: Operation (e.g., 'CREATE', 'DELETE')
            current_metrics: Current system state with:
                - cpu: Current CPU %
                - memory: Current Memory %
                - cluster_size: Number of nodes
                - current_load: Current ops/min
                
        Returns:
            Dictionary with:
                - cpu_impact: Predicted CPU increase (%)
                - memory_impact: Predicted Memory increase (%)
                - confidence: Prediction confidence (0-1)
        """
        if not self.is_trained:
            raise RuntimeError("Model not trained yet. Call train() first.")
        
        # Check if entity/operation are known
        if entity_type not in self.entity_encoder.classes_:
            logger.warning(f"Unknown entity type: {entity_type}, using default")
            entity_type = self.entity_encoder.classes_[0]
        
        if operation not in self.operation_encoder.classes_:
            logger.warning(f"Unknown operation: {operation}, using default")
            operation = self.operation_encoder.classes_[0]
        
        # Encode features
        entity_encoded = self.entity_encoder.transform([entity_type])[0]
        operation_encoded = self.operation_encoder.transform([operation])[0]
        
        feature_vector = np.array([[
            entity_encoded,
            operation_encoded,
            current_metrics.get('cpu', 0),
            current_metrics.get('memory', 0),
            current_metrics.get('cluster_size', 1),
            current_metrics.get('current_load', 10)
        ]])
        
        # Predict
        cpu_impact = self.cpu_model.predict(feature_vector)[0]
        memory_impact = self.memory_model.predict(feature_vector)[0]
        
        # Estimate confidence (based on feature importances)
        # Higher for operations seen during training
        confidence = 0.8  # Default confidence
        
        return {
            'cpu_impact': round(max(0, cpu_impact), 3),
            'memory_impact': round(max(0, memory_impact), 3),
            'confidence': confidence
        }
    
    def recommend_operations(
        self,
        target_cpu_increase: float,
        target_memory_increase: float,
        current_metrics: Dict,
        top_k: int = 10
    ) -> List[Dict]:
        """
        Recommend best operations to reach target increase
        
        Args:
            target_cpu_increase: Desired CPU increase (%)
            target_memory_increase: Desired Memory increase (%)
            current_metrics: Current system state
            top_k: Number of recommendations to return
            
        Returns:
            List of recommended operations sorted by relevance
        """
        if not self.is_trained:
            logger.warning("Model not trained, returning default recommendations")
            return self._get_default_recommendations(top_k)
        
        recommendations = []
        
        # Try all known entity-operation combinations
        for entity_type in self.entity_encoder.classes_:
            for operation in self.operation_encoder.classes_:
                try:
                    prediction = self.predict(entity_type, operation, current_metrics)
                    
                    # Calculate how well this operation matches our target
                    # Using weighted distance (CPU more important typically)
                    cpu_diff = abs(prediction['cpu_impact'] - target_cpu_increase)
                    memory_diff = abs(prediction['memory_impact'] - target_memory_increase)
                    
                    # Weighted score (CPU weighted 60%, Memory 40%)
                    score = 1.0 / (1.0 + 0.6 * cpu_diff + 0.4 * memory_diff)
                    
                    recommendations.append({
                        'entity': entity_type,
                        'operation': operation,
                        'cpu_impact': prediction['cpu_impact'],
                        'memory_impact': prediction['memory_impact'],
                        'score': score,
                        'confidence': prediction['confidence']
                    })
                except Exception as e:
                    logger.debug(f"Prediction failed for {entity_type}-{operation}: {e}")
                    continue
        
        # Sort by score (highest first)
        recommendations.sort(key=lambda x: x['score'], reverse=True)
        
        return recommendations[:top_k]
    
    def _get_default_recommendations(self, top_k: int) -> List[Dict]:
        """Return default recommendations when model is not trained"""
        defaults = [
            {'entity': 'vm', 'operation': 'CREATE', 'cpu_impact': 2.5, 'memory_impact': 2.0, 'score': 0.8, 'confidence': 0.5},
            {'entity': 'blueprint_multi_vm', 'operation': 'CREATE', 'cpu_impact': 3.5, 'memory_impact': 3.0, 'score': 0.75, 'confidence': 0.5},
            {'entity': 'blueprint_multi_vm', 'operation': 'EXECUTE', 'cpu_impact': 4.0, 'memory_impact': 3.5, 'score': 0.7, 'confidence': 0.5},
            {'entity': 'vm', 'operation': 'DELETE', 'cpu_impact': 1.8, 'memory_impact': 1.5, 'score': 0.65, 'confidence': 0.5},
            {'entity': 'blueprint_single_vm', 'operation': 'CREATE', 'cpu_impact': 2.2, 'memory_impact': 1.8, 'score': 0.6, 'confidence': 0.5},
        ]
        return defaults[:top_k]
    
    def get_feature_importance(self) -> Dict:
        """
        Get feature importances from trained models
        
        Returns:
            Dictionary with feature importances for CPU and Memory models
        """
        if not self.is_trained:
            return {}
        
        cpu_importance = dict(zip(self.feature_names, self.cpu_model.feature_importances_))
        memory_importance = dict(zip(self.feature_names, self.memory_model.feature_importances_))
        
        return {
            'cpu_model': {k: round(v, 3) for k, v in cpu_importance.items()},
            'memory_model': {k: round(v, 3) for k, v in memory_importance.items()}
        }
    
    def save(self, name: str = 'default'):
        """
        Save trained models to disk
        
        Args:
            name: Model name (default: 'default')
        """
        if not self.is_trained:
            raise RuntimeError("Cannot save untrained model")
        
        model_path = os.path.join(self.model_dir, f'{name}_models.pkl')
        
        model_data = {
            'cpu_model': self.cpu_model,
            'memory_model': self.memory_model,
            'entity_encoder': self.entity_encoder,
            'operation_encoder': self.operation_encoder,
            'feature_names': self.feature_names
        }
        
        joblib.dump(model_data, model_path)
        logger.info(f"💾 Models saved to {model_path}")
    
    def load(self, name: str = 'default'):
        """
        Load trained models from disk
        
        Args:
            name: Model name (default: 'default')
        """
        model_path = os.path.join(self.model_dir, f'{name}_models.pkl')
        
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"No saved model found at {model_path}")
        
        model_data = joblib.load(model_path)
        
        self.cpu_model = model_data['cpu_model']
        self.memory_model = model_data['memory_model']
        self.entity_encoder = model_data['entity_encoder']
        self.operation_encoder = model_data['operation_encoder']
        self.feature_names = model_data['feature_names']
        self.is_trained = True
        
        logger.info(f"📂 Models loaded from {model_path}")


def generate_synthetic_training_data(num_samples: int = 100) -> List[Dict]:
    """
    Generate synthetic training data for testing
    
    This simulates historical execution data based on realistic operation impacts.
    
    Args:
        num_samples: Number of samples to generate
        
    Returns:
        List of training samples
    """
    import random
    
    entities = ['vm', 'blueprint_single_vm', 'blueprint_multi_vm', 'playbook', 
                'scenario', 'rate_card', 'business_unit', 'cost_center']
    
    operations = ['CREATE', 'DELETE', 'UPDATE', 'LIST', 'EXECUTE', 'READ']
    
    # Impact profiles (CPU, Memory) for different operations
    impact_profiles = {
        ('vm', 'CREATE'): (2.5, 2.0),
        ('vm', 'DELETE'): (1.5, 1.2),
        ('vm', 'LIST'): (0.3, 0.2),
        ('blueprint_multi_vm', 'CREATE'): (3.5, 3.0),
        ('blueprint_multi_vm', 'EXECUTE'): (4.5, 3.8),
        ('blueprint_multi_vm', 'DELETE'): (2.0, 1.8),
        ('blueprint_single_vm', 'CREATE'): (2.0, 1.7),
        ('playbook', 'CREATE'): (1.8, 1.5),
        ('playbook', 'EXECUTE'): (3.0, 2.5),
        ('scenario', 'CREATE'): (1.5, 1.3),
        ('scenario', 'DELETE'): (1.0, 0.8),
        ('rate_card', 'CREATE'): (0.8, 0.7),
        ('rate_card', 'UPDATE'): (0.6, 0.5),
        ('business_unit', 'CREATE'): (0.5, 0.4),
        ('business_unit', 'UPDATE'): (0.4, 0.3),
        ('cost_center', 'CREATE'): (0.5, 0.4),
    }
    
    data = []
    
    for _ in range(num_samples):
        entity = random.choice(entities)
        operation = random.choice(operations)
        
        # Get base impact (with random variation)
        base_cpu, base_mem = impact_profiles.get(
            (entity, operation),
            (random.uniform(0.5, 2.0), random.uniform(0.4, 1.8))
        )
        
        # Add noise
        cpu_impact = base_cpu * random.uniform(0.8, 1.2)
        memory_impact = base_mem * random.uniform(0.8, 1.2)
        
        # Current state
        current_cpu = random.uniform(20, 80)
        current_memory = random.uniform(20, 80)
        cluster_size = random.randint(1, 5)
        current_load = random.uniform(5, 50)
        
        # Impact increases with current load (system saturation effect)
        saturation_factor = 1.0 + (current_load / 100.0)
        cpu_impact *= saturation_factor
        memory_impact *= saturation_factor
        
        data.append({
            'entity_type': entity,
            'operation': operation,
            'current_cpu': current_cpu,
            'current_memory': current_memory,
            'cluster_size': cluster_size,
            'current_load': current_load,
            'cpu_impact': cpu_impact,
            'memory_impact': memory_impact
        })
    
    return data
