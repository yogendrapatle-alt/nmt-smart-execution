"""
Cost Calculation Service

Calculate and track costs for Smart Executions.
Provides cost optimization recommendations.
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class CostCalculator:
    """
    Calculate costs based on resource consumption
    
    Default rates (customizable):
    - CPU: $0.10 per CPU-hour
    - Memory: $0.01 per GB-hour
    - Storage: $0.001 per GB-hour
    - Network: $0.05 per GB
    - Operation: $0.0001 per operation
    """
    
    def __init__(self, cpu_rate=0.10, memory_rate=0.01, storage_rate=0.001,
                 network_rate=0.05, operation_rate=0.0001):
        """Initialize with custom rates"""
        self.cpu_rate = cpu_rate
        self.memory_rate = memory_rate
        self.storage_rate = storage_rate
        self.network_rate = network_rate
        self.operation_rate = operation_rate
    
    def calculate_execution_cost(self, execution_data: Dict) -> Dict:
        """
        Calculate cost for a single execution
        
        Args:
            execution_data: Dict with resource consumption data
        
        Returns:
            Dict with detailed cost breakdown
        """
        # Extract consumption data
        duration_minutes = execution_data.get('duration_minutes', 0)
        duration_hours = duration_minutes / 60.0
        
        # Assume average resource usage based on target thresholds
        cpu_percent = execution_data.get('final_cpu', execution_data.get('cpu_achieved', 50))
        memory_gb = execution_data.get('final_memory', execution_data.get('memory_achieved', 50)) / 100 * 16  # Assume 16GB capacity
        
        cpu_hours = (cpu_percent / 100.0) * duration_hours
        memory_gb_hours = memory_gb * duration_hours
        storage_gb_hours = 10 * duration_hours  # Assume 10GB storage
        network_gb = execution_data.get('network_gb', 0.5)  # Assume 0.5GB network
        operation_count = execution_data.get('total_operations', 0)
        
        # Calculate costs
        cpu_cost = cpu_hours * self.cpu_rate
        memory_cost = memory_gb_hours * self.memory_rate
        storage_cost = storage_gb_hours * self.storage_rate
        network_cost = network_gb * self.network_rate
        operation_cost = operation_count * self.operation_rate
        total_cost = cpu_cost + memory_cost + storage_cost + network_cost + operation_cost
        
        # Calculate efficiency score (lower cost per operation is better)
        cost_per_operation = (total_cost / operation_count) if operation_count > 0 else 0
        efficiency_score = min(100, max(0, (1 - cost_per_operation) * 100))
        
        return {
            'resource_consumption': {
                'cpu_hours': round(cpu_hours, 2),
                'memory_gb_hours': round(memory_gb_hours, 2),
                'storage_gb_hours': round(storage_gb_hours, 2),
                'network_gb': round(network_gb, 2),
                'operation_count': operation_count,
                'duration_minutes': duration_minutes
            },
            'costs': {
                'cpu_cost': round(cpu_cost, 4),
                'memory_cost': round(memory_cost, 4),
                'storage_cost': round(storage_cost, 4),
                'network_cost': round(network_cost, 4),
                'operation_cost': round(operation_cost, 4),
                'total_cost': round(total_cost, 4)
            },
            'efficiency': {
                'cost_per_operation': round(cost_per_operation, 6),
                'efficiency_score': round(efficiency_score, 2)
            }
        }
    
    def calculate_optimization_potential(self, execution_data: Dict, cost_data: Dict) -> Dict:
        """
        Calculate potential cost savings through optimization
        
        Args:
            execution_data: Execution metrics
            cost_data: Current cost data
        
        Returns:
            Dict with optimization recommendations
        """
        recommendations = []
        potential_savings = 0.0
        
        current_cost = cost_data['costs']['total_cost']
        cpu_threshold = execution_data.get('cpu_threshold', 75)
        memory_threshold = execution_data.get('memory_threshold', 75)
        cpu_achieved = execution_data.get('cpu_achieved', 50)
        memory_achieved = execution_data.get('memory_achieved', 50)
        
        # Check if thresholds are too high
        if cpu_achieved < cpu_threshold * 0.8:
            savings_percent = (cpu_threshold - cpu_achieved) / cpu_threshold * 0.3
            savings = current_cost * savings_percent
            potential_savings += savings
            recommendations.append({
                'type': 'cpu_threshold',
                'message': f'Reduce CPU threshold from {cpu_threshold}% to {int(cpu_achieved * 1.1)}%',
                'savings': round(savings, 4),
                'impact': 'medium'
            })
        
        if memory_achieved < memory_threshold * 0.8:
            savings_percent = (memory_threshold - memory_achieved) / memory_threshold * 0.2
            savings = current_cost * savings_percent
            potential_savings += savings
            recommendations.append({
                'type': 'memory_threshold',
                'message': f'Reduce Memory threshold from {memory_threshold}% to {int(memory_achieved * 1.1)}%',
                'savings': round(savings, 4),
                'impact': 'low'
            })
        
        # Check operation efficiency
        success_rate = execution_data.get('success_rate', 100)
        if success_rate < 90:
            failed_ops = execution_data.get('failed_operations', 0)
            wasted_cost = failed_ops * self.operation_rate
            potential_savings += wasted_cost
            recommendations.append({
                'type': 'operation_efficiency',
                'message': f'Improve success rate from {success_rate:.1f}% to reduce wasted operations',
                'savings': round(wasted_cost, 4),
                'impact': 'high'
            })
        
        return {
            'potential_savings': round(potential_savings, 4),
            'savings_percent': round((potential_savings / current_cost * 100) if current_cost > 0 else 0, 2),
            'recommendations': recommendations,
            'optimized_cost': round(current_cost - potential_savings, 4)
        }


class CostTrackingService:
    """Service for tracking and managing costs"""
    
    def __init__(self):
        """Initialize cost tracking service"""
        self.calculator = CostCalculator()
        logger.info("✅ Cost tracking service initialized")
    
    def track_execution_cost(self, execution_id: str, execution_type: str,
                            testbed_id: str, execution_data: Dict) -> Optional[str]:
        """
        Track cost for an execution
        
        Args:
            execution_id: Execution ID
            execution_type: Type of execution
            testbed_id: Testbed ID
            execution_data: Execution metrics and data
        
        Returns:
            cost_id if successful, None otherwise
        """
        try:
            from database import SessionLocal
            from models.cost_tracker import CostTracker
            
            # Calculate costs
            cost_breakdown = self.calculator.calculate_execution_cost(execution_data)
            optimization = self.calculator.calculate_optimization_potential(
                execution_data, cost_breakdown
            )
            
            # Create cost record
            import uuid
            timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
            random_suffix = str(uuid.uuid4())[:8]
            cost_id = f'COST-{timestamp}-{random_suffix}'
            
            cost_record = CostTracker(
                cost_id=cost_id,
                execution_id=execution_id,
                execution_type=execution_type,
                testbed_id=testbed_id,
                cpu_hours=cost_breakdown['resource_consumption']['cpu_hours'],
                memory_gb_hours=cost_breakdown['resource_consumption']['memory_gb_hours'],
                storage_gb_hours=cost_breakdown['resource_consumption']['storage_gb_hours'],
                network_gb=cost_breakdown['resource_consumption']['network_gb'],
                operation_count=cost_breakdown['resource_consumption']['operation_count'],
                duration_minutes=cost_breakdown['resource_consumption']['duration_minutes'],
                cpu_rate=self.calculator.cpu_rate,
                memory_rate=self.calculator.memory_rate,
                storage_rate=self.calculator.storage_rate,
                network_rate=self.calculator.network_rate,
                operation_rate=self.calculator.operation_rate,
                cpu_cost=cost_breakdown['costs']['cpu_cost'],
                memory_cost=cost_breakdown['costs']['memory_cost'],
                storage_cost=cost_breakdown['costs']['storage_cost'],
                network_cost=cost_breakdown['costs']['network_cost'],
                operation_cost=cost_breakdown['costs']['operation_cost'],
                total_cost=cost_breakdown['costs']['total_cost'],
                cost_breakdown=cost_breakdown,
                optimization_potential=optimization['potential_savings'],
                cost_efficiency_score=cost_breakdown['efficiency']['efficiency_score'],
                execution_date=datetime.now()
            )
            
            session = SessionLocal()
            try:
                session.add(cost_record)
                session.commit()
                
                # Update budget tracking
                self._update_budget_spending(testbed_id, cost_breakdown['costs']['total_cost'])
                
                logger.info(f"💰 Cost tracked: {cost_id} = ${cost_breakdown['costs']['total_cost']:.4f}")
                return cost_id
                
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Failed to track cost: {e}")
            return None
    
    def _update_budget_spending(self, testbed_id: str, amount: float):
        """Update budget spending for a testbed"""
        try:
            from database import SessionLocal
            from models.cost_tracker import BudgetLimit
            
            session = SessionLocal()
            try:
                budget = session.query(BudgetLimit).filter_by(
                    scope_type='testbed',
                    scope_id=testbed_id,
                    is_active=True
                ).first()
                
                if budget:
                    budget.daily_spent += amount
                    budget.weekly_spent += amount
                    budget.monthly_spent += amount
                    
                    # Check if over budget
                    monthly_status = budget.check_budget_status('monthly')
                    if monthly_status['status'] == 'blocked':
                        budget.is_blocking = True
                    
                    session.commit()
                    logger.info(f"  💵 Updated budget for {testbed_id}: +${amount:.4f}")
                
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Failed to update budget: {e}")
    
    def get_cost_summary(self, start_date: datetime, end_date: datetime,
                        testbed_id: Optional[str] = None) -> Dict:
        """
        Get cost summary for a date range
        
        Args:
            start_date: Start date
            end_date: End date
            testbed_id: Optional testbed filter
        
        Returns:
            Dict with cost summary
        """
        try:
            from database import SessionLocal
            from models.cost_tracker import CostTracker
            
            session = SessionLocal()
            try:
                query = session.query(CostTracker).filter(
                    CostTracker.execution_date >= start_date,
                    CostTracker.execution_date <= end_date
                )
                
                if testbed_id:
                    query = query.filter(CostTracker.testbed_id == testbed_id)
                
                records = query.all()
                
                if not records:
                    return {
                        'total_cost': 0.0,
                        'total_executions': 0,
                        'avg_cost_per_execution': 0.0
                    }
                
                total_cost = sum(r.total_cost for r in records)
                total_executions = len(records)
                
                return {
                    'total_cost': round(total_cost, 2),
                    'total_executions': total_executions,
                    'avg_cost_per_execution': round(total_cost / total_executions, 4),
                    'total_operations': sum(r.operation_count for r in records),
                    'cost_breakdown': {
                        'cpu': round(sum(r.cpu_cost for r in records), 2),
                        'memory': round(sum(r.memory_cost for r in records), 2),
                        'storage': round(sum(r.storage_cost for r in records), 2),
                        'network': round(sum(r.network_cost for r in records), 2),
                        'operations': round(sum(r.operation_cost for r in records), 2)
                    }
                }
                
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Failed to get cost summary: {e}")
            return {}


# Global service instance
_cost_service = None


def get_cost_service() -> CostTrackingService:
    """Get global cost service instance"""
    global _cost_service
    
    if _cost_service is None:
        _cost_service = CostTrackingService()
    
    return _cost_service


if __name__ == '__main__':
    print("\n" + "="*70)
    print("💰 COST CALCULATION SERVICE")
    print("="*70 + "\n")
    print("✅ Cost service module created successfully!")
    print("\nFeatures:")
    print("  ✅ Cost calculation based on resource consumption")
    print("  ✅ Optimization recommendations")
    print("  ✅ Budget tracking integration")
    print("  ✅ Cost summaries and analytics")
    print("\n" + "="*70 + "\n")
