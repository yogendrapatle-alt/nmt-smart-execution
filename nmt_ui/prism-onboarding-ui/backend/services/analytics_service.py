"""
Analytics Service

Provides advanced analytics, trends, comparisons, and executive summaries.
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from collections import defaultdict

logger = logging.getLogger(__name__)


class AnalyticsService:
    """
    Advanced analytics service for Smart Executions
    
    Provides:
    - Historical trend analysis
    - Testbed comparisons
    - Time period comparisons
    - Statistical aggregations
    - Executive summaries
    """
    
    def __init__(self):
        """Initialize analytics service"""
        logger.info("✅ Analytics service initialized")
    
    def get_overview(self, start_date: datetime, end_date: datetime, 
                    testbed_id: Optional[str] = None) -> Dict:
        """
        Get analytics overview for a date range
        
        Args:
            start_date: Start date
            end_date: End date
            testbed_id: Optional testbed filter
        
        Returns:
            Dict with overview metrics
        """
        try:
            from database import SessionLocal
            from models.smart_execution import SmartExecution
            
            session = SessionLocal()
            try:
                query = session.query(SmartExecution).filter(
                    SmartExecution.start_time >= start_date,
                    SmartExecution.start_time <= end_date
                )
                
                if testbed_id:
                    query = query.filter(SmartExecution.testbed_id == testbed_id)
                
                executions = query.all()
                
                if not executions:
                    return self._empty_overview()
                
                # Calculate metrics
                total_executions = len(executions)
                completed = sum(1 for e in executions if e.status == 'completed')
                failed = sum(1 for e in executions if e.status == 'failed')
                running = sum(1 for e in executions if e.status == 'running')
                
                success_rate = (completed / total_executions * 100) if total_executions > 0 else 0
                
                # Total operations
                total_operations = sum(e.total_operations or 0 for e in executions)
                successful_operations = sum(e.successful_operations or 0 for e in executions)
                
                # Average duration
                durations = [e.duration_minutes for e in executions if e.duration_minutes]
                avg_duration = sum(durations) / len(durations) if durations else 0
                
                # Average operations per minute
                ops_per_min = [e.operations_per_minute for e in executions if e.operations_per_minute]
                avg_ops_per_min = sum(ops_per_min) / len(ops_per_min) if ops_per_min else 0
                
                # Threshold achievement
                threshold_reached = sum(1 for e in executions if e.threshold_reached)
                threshold_rate = (threshold_reached / total_executions * 100) if total_executions > 0 else 0
                
                # Resource utilization
                cpu_values = []
                memory_values = []
                for e in executions:
                    if e.final_metrics:
                        cpu_values.append(e.final_metrics.get('final_cpu', 0))
                        memory_values.append(e.final_metrics.get('final_memory', 0))
                
                avg_cpu = sum(cpu_values) / len(cpu_values) if cpu_values else 0
                avg_memory = sum(memory_values) / len(memory_values) if memory_values else 0
                
                return {
                    'period': {
                        'start': start_date.isoformat(),
                        'end': end_date.isoformat(),
                        'days': (end_date - start_date).days
                    },
                    'executions': {
                        'total': total_executions,
                        'completed': completed,
                        'failed': failed,
                        'running': running,
                        'success_rate': round(success_rate, 2)
                    },
                    'operations': {
                        'total': total_operations,
                        'successful': successful_operations,
                        'success_rate': round((successful_operations / total_operations * 100) if total_operations > 0 else 0, 2),
                        'avg_per_execution': round(total_operations / total_executions, 2) if total_executions > 0 else 0
                    },
                    'performance': {
                        'avg_duration_minutes': round(avg_duration, 2),
                        'avg_operations_per_minute': round(avg_ops_per_min, 2),
                        'threshold_achievement_rate': round(threshold_rate, 2)
                    },
                    'resource_utilization': {
                        'avg_cpu_percent': round(avg_cpu, 2),
                        'avg_memory_percent': round(avg_memory, 2)
                    }
                }
                
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Error getting overview: {e}")
            return self._empty_overview()
    
    def get_trends(self, start_date: datetime, end_date: datetime,
                   metric: str = 'executions', granularity: str = 'daily',
                   testbed_id: Optional[str] = None) -> Dict:
        """
        Get trend data for a metric over time
        
        Args:
            start_date: Start date
            end_date: End date
            metric: Metric to track ('executions', 'operations', 'cpu', 'memory', 'success_rate')
            granularity: 'hourly', 'daily', 'weekly'
            testbed_id: Optional testbed filter
        
        Returns:
            Dict with trend data
        """
        try:
            from database import SessionLocal
            from models.smart_execution import SmartExecution
            
            session = SessionLocal()
            try:
                query = session.query(SmartExecution).filter(
                    SmartExecution.start_time >= start_date,
                    SmartExecution.start_time <= end_date
                )
                
                if testbed_id:
                    query = query.filter(SmartExecution.testbed_id == testbed_id)
                
                executions = query.order_by(SmartExecution.start_time).all()
                
                if not executions:
                    return {'trend_data': [], 'metric': metric, 'granularity': granularity}
                
                # Group by time period
                trend_data = self._calculate_trend(executions, metric, granularity, start_date, end_date)
                
                return {
                    'trend_data': trend_data,
                    'metric': metric,
                    'granularity': granularity,
                    'period': {
                        'start': start_date.isoformat(),
                        'end': end_date.isoformat()
                    }
                }
                
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Error getting trends: {e}")
            return {'trend_data': [], 'metric': metric, 'granularity': granularity}
    
    def compare_testbeds(self, testbed_ids: List[str], start_date: datetime,
                        end_date: datetime) -> Dict:
        """
        Compare metrics across multiple testbeds
        
        Args:
            testbed_ids: List of testbed IDs to compare
            start_date: Start date
            end_date: End date
        
        Returns:
            Dict with comparison data
        """
        try:
            from database import SessionLocal
            from models.smart_execution import SmartExecution
            
            session = SessionLocal()
            try:
                comparisons = []
                
                for testbed_id in testbed_ids:
                    executions = session.query(SmartExecution).filter(
                        SmartExecution.testbed_id == testbed_id,
                        SmartExecution.start_time >= start_date,
                        SmartExecution.start_time <= end_date
                    ).all()
                    
                    if executions:
                        metrics = self._calculate_testbed_metrics(executions, testbed_id)
                        comparisons.append(metrics)
                
                return {
                    'comparisons': comparisons,
                    'period': {
                        'start': start_date.isoformat(),
                        'end': end_date.isoformat()
                    }
                }
                
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Error comparing testbeds: {e}")
            return {'comparisons': []}
    
    def compare_time_periods(self, testbed_id: str, period1_start: datetime,
                            period1_end: datetime, period2_start: datetime,
                            period2_end: datetime) -> Dict:
        """
        Compare metrics between two time periods for a testbed
        
        Args:
            testbed_id: Testbed ID
            period1_start: Period 1 start
            period1_end: Period 1 end
            period2_start: Period 2 start
            period2_end: Period 2 end
        
        Returns:
            Dict with comparison data
        """
        try:
            from database import SessionLocal
            from models.smart_execution import SmartExecution
            
            session = SessionLocal()
            try:
                # Get executions for both periods
                period1_execs = session.query(SmartExecution).filter(
                    SmartExecution.testbed_id == testbed_id,
                    SmartExecution.start_time >= period1_start,
                    SmartExecution.start_time <= period1_end
                ).all()
                
                period2_execs = session.query(SmartExecution).filter(
                    SmartExecution.testbed_id == testbed_id,
                    SmartExecution.start_time >= period2_start,
                    SmartExecution.start_time <= period2_end
                ).all()
                
                period1_metrics = self._calculate_period_metrics(period1_execs, "Period 1")
                period2_metrics = self._calculate_period_metrics(period2_execs, "Period 2")
                
                # Calculate changes
                changes = self._calculate_changes(period1_metrics, period2_metrics)
                
                return {
                    'period1': period1_metrics,
                    'period2': period2_metrics,
                    'changes': changes
                }
                
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Error comparing time periods: {e}")
            return {}
    
    def get_executive_summary(self, start_date: datetime, end_date: datetime) -> Dict:
        """
        Generate executive summary with key insights
        
        Args:
            start_date: Start date
            end_date: End date
        
        Returns:
            Dict with executive summary
        """
        try:
            from database import SessionLocal
            from models.smart_execution import SmartExecution
            from models.cost_tracker import CostTracker
            
            session = SessionLocal()
            try:
                # Get all executions
                executions = session.query(SmartExecution).filter(
                    SmartExecution.start_time >= start_date,
                    SmartExecution.start_time <= end_date
                ).all()
                
                # Get cost data
                costs = session.query(CostTracker).filter(
                    CostTracker.execution_date >= start_date,
                    CostTracker.execution_date <= end_date
                ).all()
                
                # Calculate key metrics
                total_executions = len(executions)
                completed = sum(1 for e in executions if e.status == 'completed')
                success_rate = (completed / total_executions * 100) if total_executions > 0 else 0
                
                total_cost = sum(c.total_cost for c in costs)
                avg_cost = total_cost / len(costs) if costs else 0
                
                total_operations = sum(e.total_operations or 0 for e in executions)
                
                # Get testbed with most executions
                testbed_counts = defaultdict(int)
                for e in executions:
                    testbed_counts[e.testbed_id] += 1
                
                most_active_testbed = max(testbed_counts.items(), key=lambda x: x[1]) if testbed_counts else (None, 0)
                
                # Generate insights
                insights = []
                
                if success_rate >= 90:
                    insights.append({
                        'type': 'positive',
                        'message': f'Excellent success rate of {success_rate:.1f}%',
                        'icon': '✅'
                    })
                elif success_rate < 70:
                    insights.append({
                        'type': 'warning',
                        'message': f'Success rate of {success_rate:.1f}% needs improvement',
                        'icon': '⚠️'
                    })
                
                if total_cost > 0:
                    cost_per_op = total_cost / total_operations if total_operations > 0 else 0
                    insights.append({
                        'type': 'info',
                        'message': f'Average cost per operation: ${cost_per_op:.4f}',
                        'icon': '💰'
                    })
                
                if most_active_testbed[1] > total_executions * 0.5:
                    insights.append({
                        'type': 'info',
                        'message': f'Testbed {most_active_testbed[0][:8]}... accounts for {most_active_testbed[1]/total_executions*100:.0f}% of executions',
                        'icon': '📊'
                    })
                
                return {
                    'period': {
                        'start': start_date.isoformat(),
                        'end': end_date.isoformat(),
                        'days': (end_date - start_date).days
                    },
                    'key_metrics': {
                        'total_executions': total_executions,
                        'success_rate': round(success_rate, 2),
                        'total_operations': total_operations,
                        'total_cost': round(total_cost, 2),
                        'avg_cost_per_execution': round(avg_cost, 2)
                    },
                    'insights': insights,
                    'most_active_testbed': {
                        'testbed_id': most_active_testbed[0],
                        'execution_count': most_active_testbed[1]
                    } if most_active_testbed[0] else None
                }
                
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Error generating executive summary: {e}")
            return {}
    
    def _empty_overview(self) -> Dict:
        """Return empty overview structure"""
        return {
            'period': {},
            'executions': {'total': 0, 'completed': 0, 'failed': 0, 'running': 0, 'success_rate': 0},
            'operations': {'total': 0, 'successful': 0, 'success_rate': 0, 'avg_per_execution': 0},
            'performance': {'avg_duration_minutes': 0, 'avg_operations_per_minute': 0, 'threshold_achievement_rate': 0},
            'resource_utilization': {'avg_cpu_percent': 0, 'avg_memory_percent': 0}
        }
    
    def _calculate_trend(self, executions, metric, granularity, start_date, end_date):
        """Calculate trend data for a metric"""
        # Group executions by time period
        periods = defaultdict(list)
        
        for execution in executions:
            if not execution.start_time:
                continue
            
            # Determine period key based on granularity
            if granularity == 'hourly':
                period_key = execution.start_time.strftime('%Y-%m-%d %H:00')
            elif granularity == 'weekly':
                period_key = execution.start_time.strftime('%Y-W%W')
            else:  # daily
                period_key = execution.start_time.strftime('%Y-%m-%d')
            
            periods[period_key].append(execution)
        
        # Calculate metric for each period
        trend_data = []
        for period_key in sorted(periods.keys()):
            execs = periods[period_key]
            value = self._calculate_metric_value(execs, metric)
            trend_data.append({
                'period': period_key,
                'value': value,
                'count': len(execs)
            })
        
        return trend_data
    
    def _calculate_metric_value(self, executions, metric):
        """Calculate value for a specific metric"""
        if metric == 'executions':
            return len(executions)
        elif metric == 'operations':
            return sum(e.total_operations or 0 for e in executions)
        elif metric == 'cpu':
            values = [e.final_metrics.get('final_cpu', 0) for e in executions if e.final_metrics]
            return sum(values) / len(values) if values else 0
        elif metric == 'memory':
            values = [e.final_metrics.get('final_memory', 0) for e in executions if e.final_metrics]
            return sum(values) / len(values) if values else 0
        elif metric == 'success_rate':
            completed = sum(1 for e in executions if e.status == 'completed')
            return (completed / len(executions) * 100) if executions else 0
        return 0
    
    def _calculate_testbed_metrics(self, executions, testbed_id):
        """Calculate metrics for a testbed"""
        total = len(executions)
        completed = sum(1 for e in executions if e.status == 'completed')
        success_rate = (completed / total * 100) if total > 0 else 0
        
        total_ops = sum(e.total_operations or 0 for e in executions)
        avg_duration = sum(e.duration_minutes or 0 for e in executions) / total if total > 0 else 0
        
        return {
            'testbed_id': testbed_id,
            'total_executions': total,
            'success_rate': round(success_rate, 2),
            'total_operations': total_ops,
            'avg_duration_minutes': round(avg_duration, 2)
        }
    
    def _calculate_period_metrics(self, executions, period_name):
        """Calculate metrics for a time period"""
        total = len(executions)
        completed = sum(1 for e in executions if e.status == 'completed')
        
        return {
            'name': period_name,
            'total_executions': total,
            'completed_executions': completed,
            'success_rate': round((completed / total * 100) if total > 0 else 0, 2),
            'total_operations': sum(e.total_operations or 0 for e in executions),
            'avg_duration': round(sum(e.duration_minutes or 0 for e in executions) / total if total > 0 else 0, 2)
        }
    
    def _calculate_changes(self, period1, period2):
        """Calculate changes between two periods"""
        changes = {}
        
        for key in ['total_executions', 'completed_executions', 'success_rate', 'total_operations', 'avg_duration']:
            val1 = period1.get(key, 0)
            val2 = period2.get(key, 0)
            
            if val1 > 0:
                change_percent = ((val2 - val1) / val1 * 100)
            else:
                change_percent = 100 if val2 > 0 else 0
            
            changes[key] = {
                'absolute': round(val2 - val1, 2),
                'percent': round(change_percent, 2)
            }
        
        return changes


# Global service instance
_analytics_service = None


def get_analytics_service() -> AnalyticsService:
    """Get global analytics service instance"""
    global _analytics_service
    
    if _analytics_service is None:
        _analytics_service = AnalyticsService()
    
    return _analytics_service


if __name__ == '__main__':
    print("\n" + "="*70)
    print("📊 ANALYTICS SERVICE")
    print("="*70 + "\n")
    print("✅ Analytics service module created successfully!")
    print("\nFeatures:")
    print("  ✅ Historical trend analysis")
    print("  ✅ Testbed comparisons")
    print("  ✅ Time period comparisons")
    print("  ✅ Executive summaries")
    print("  ✅ Statistical aggregations")
    print("\n" + "="*70 + "\n")
