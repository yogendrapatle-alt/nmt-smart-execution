"""
Analytics Service

Provides advanced analytics, trends, comparisons, and executive summaries.
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from collections import defaultdict

logger = logging.getLogger(__name__)


def _resolve_testbed_name(testbed_id: str) -> str:
    """Resolve a testbed UUID to its display label / IP."""
    try:
        from database import SessionLocal
        from sqlalchemy import text
        s = SessionLocal()
        try:
            row = s.execute(
                text("SELECT testbed_label, pc_ip, ncm_ip FROM testbeds WHERE unique_testbed_id = :tid LIMIT 1"),
                {'tid': testbed_id},
            ).fetchone()
            if row:
                label = row[0] or ''
                pc_ip = row[1] or ''
                ncm_ip = row[2] or ''
                if label and pc_ip and label != pc_ip:
                    return f"{label} ({pc_ip})"
                return label or pc_ip or ncm_ip or testbed_id[:16]
        finally:
            s.close()
    except Exception:
        pass
    return testbed_id[:16] + '...'


def _extract_cpu(metrics: dict) -> Optional[float]:
    """Extract CPU % from a metrics dict regardless of key convention."""
    if not metrics:
        return None
    for key in ('cpu_percent', 'final_cpu', 'cpu'):
        v = metrics.get(key)
        if v is not None and isinstance(v, (int, float)) and v > 0:
            return float(v)
    return None


def _extract_memory(metrics: dict) -> Optional[float]:
    """Extract memory % from a metrics dict regardless of key convention."""
    if not metrics:
        return None
    for key in ('memory_percent', 'final_memory', 'memory'):
        v = metrics.get(key)
        if v is not None and isinstance(v, (int, float)) and v > 0:
            return float(v)
    return None


class AnalyticsService:
    """
    Advanced analytics service for Smart Executions
    """
    
    def __init__(self):
        logger.info("✅ Analytics service initialized")
    
    def get_overview(self, start_date: datetime, end_date: datetime, 
                    testbed_id: Optional[str] = None) -> Dict:
        """Get analytics overview for a date range."""
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
                    return self._empty_overview(start_date, end_date)
                
                total_executions = len(executions)
                completed = sum(1 for e in executions if (e.status or '').upper() == 'COMPLETED')
                failed = sum(1 for e in executions if (e.status or '').upper() in ('FAILED', 'TIMEOUT', 'ERROR'))
                running = sum(1 for e in executions if (e.status or '').upper() == 'RUNNING')
                stopped = sum(1 for e in executions if (e.status or '').upper() == 'STOPPED')
                
                total_operations = sum(e.total_operations or 0 for e in executions)
                successful_operations = sum(e.successful_operations or 0 for e in executions)
                op_success_rate = (successful_operations / total_operations * 100) if total_operations > 0 else 0
                exec_completion_rate = (completed / total_executions * 100) if total_executions > 0 else 0
                
                durations = [e.duration_minutes for e in executions if e.duration_minutes and e.duration_minutes > 0]
                avg_duration = sum(durations) / len(durations) if durations else 0
                
                ops_per_min = [e.operations_per_minute for e in executions if e.operations_per_minute and e.operations_per_minute > 0]
                avg_ops_per_min = sum(ops_per_min) / len(ops_per_min) if ops_per_min else 0
                
                threshold_reached = sum(1 for e in executions if e.threshold_reached)
                threshold_rate = (threshold_reached / total_executions * 100) if total_executions > 0 else 0
                
                cpu_values = []
                memory_values = []
                for e in executions:
                    cpu_val = _extract_cpu(e.final_metrics)
                    mem_val = _extract_memory(e.final_metrics)
                    if cpu_val is not None:
                        cpu_values.append(cpu_val)
                    if mem_val is not None:
                        memory_values.append(mem_val)
                
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
                        'stopped': stopped,
                        'success_rate': round(op_success_rate, 2),
                        'completion_rate': round(exec_completion_rate, 2),
                    },
                    'operations': {
                        'total': total_operations,
                        'successful': successful_operations,
                        'failed': total_operations - successful_operations,
                        'success_rate': round(op_success_rate, 2),
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
            return self._empty_overview(start_date, end_date)
    
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
        """Generate a rich executive summary with key insights."""
        try:
            from database import SessionLocal
            from models.smart_execution import SmartExecution
            from sqlalchemy import text

            session = SessionLocal()
            try:
                executions = session.query(SmartExecution).filter(
                    SmartExecution.start_time >= start_date,
                    SmartExecution.start_time <= end_date
                ).all()

                total_executions = len(executions)
                completed = sum(1 for e in executions if (e.status or '').upper() == 'COMPLETED')
                failed = sum(1 for e in executions if (e.status or '').upper() in ('FAILED', 'TIMEOUT', 'ERROR'))
                stopped = sum(1 for e in executions if (e.status or '').upper() == 'STOPPED')

                total_operations = sum(e.total_operations or 0 for e in executions)
                successful_operations = sum(e.successful_operations or 0 for e in executions)
                failed_operations = total_operations - successful_operations
                op_success_rate = (successful_operations / total_operations * 100) if total_operations > 0 else 0
                exec_completion_rate = (completed / total_executions * 100) if total_executions > 0 else 0

                durations = [e.duration_minutes for e in executions if e.duration_minutes and e.duration_minutes > 0]
                avg_duration = sum(durations) / len(durations) if durations else 0
                total_duration = sum(durations) if durations else 0
                longest = max(durations) if durations else 0
                shortest = min(durations) if durations else 0

                ops_per_min = [e.operations_per_minute for e in executions if e.operations_per_minute and e.operations_per_minute > 0]
                avg_ops_per_min = sum(ops_per_min) / len(ops_per_min) if ops_per_min else 0

                threshold_reached = sum(1 for e in executions if e.threshold_reached)

                cpu_values = []
                memory_values = []
                for e in executions:
                    cv = _extract_cpu(e.final_metrics)
                    mv = _extract_memory(e.final_metrics)
                    if cv is not None:
                        cpu_values.append(cv)
                    if mv is not None:
                        memory_values.append(mv)
                avg_cpu = sum(cpu_values) / len(cpu_values) if cpu_values else 0
                avg_memory = sum(memory_values) / len(memory_values) if memory_values else 0
                peak_cpu = max(cpu_values) if cpu_values else 0
                peak_memory = max(memory_values) if memory_values else 0

                # Testbed breakdown
                testbed_counts: Dict[str, int] = defaultdict(int)
                for e in executions:
                    testbed_counts[e.testbed_id] += 1
                most_active = max(testbed_counts.items(), key=lambda x: x[1]) if testbed_counts else (None, 0)

                # Entity / operation breakdown from operation_metrics
                entity_breakdown = []
                try:
                    rows = session.execute(text("""
                        SELECT entity_type, operation_type, COUNT(*) as cnt,
                               SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as ok
                        FROM operation_metrics
                        WHERE started_at >= :s AND started_at <= :e
                        GROUP BY entity_type, operation_type
                        ORDER BY cnt DESC
                        LIMIT 10
                    """), {'s': start_date, 'e': end_date}).fetchall()
                    for r in rows:
                        entity_breakdown.append({
                            'entity': r[0] or 'Unknown',
                            'operation': r[1] or 'Unknown',
                            'count': r[2],
                            'success_rate': round(r[3] / r[2] * 100, 1) if r[2] > 0 else 0,
                        })
                except Exception:
                    pass

                # Status breakdown for donut
                status_breakdown = []
                status_map = defaultdict(int)
                for e in executions:
                    status_map[(e.status or 'UNKNOWN').upper()] += 1
                for st, cnt in sorted(status_map.items(), key=lambda x: -x[1]):
                    status_breakdown.append({'status': st, 'count': cnt})

                # Generate insights
                insights = []
                if op_success_rate >= 90:
                    insights.append({'type': 'positive', 'message': f'Excellent operation success rate of {op_success_rate:.1f}% across {total_operations:,} operations'})
                elif op_success_rate >= 70:
                    insights.append({'type': 'info', 'message': f'Operation success rate is {op_success_rate:.1f}% — {failed_operations:,} failures out of {total_operations:,} operations'})
                elif op_success_rate > 0:
                    insights.append({'type': 'warning', 'message': f'Operation success rate of {op_success_rate:.1f}% is below 70% — {failed_operations:,} failures need attention'})

                if completed > 0:
                    insights.append({'type': 'positive', 'message': f'{completed} of {total_executions} executions ran to completion ({exec_completion_rate:.0f}%)'})
                if stopped > 0:
                    insights.append({'type': 'info', 'message': f'{stopped} executions were manually stopped — consider extending timeouts or adjusting thresholds'})
                if failed > 0:
                    insights.append({'type': 'warning', 'message': f'{failed} executions failed or timed out — check connectivity and cluster health'})

                if avg_duration > 0:
                    insights.append({'type': 'info', 'message': f'Average execution duration: {avg_duration:.1f} minutes (shortest: {shortest:.1f}m, longest: {longest:.1f}m)'})
                if threshold_reached > 0:
                    insights.append({'type': 'positive', 'message': f'{threshold_reached} of {total_executions} executions reached the resource threshold target ({threshold_reached/total_executions*100:.0f}%)'})
                if peak_cpu > 0:
                    insights.append({'type': 'info' if peak_cpu < 90 else 'warning', 'message': f'Peak CPU utilization: {peak_cpu:.1f}% — Average: {avg_cpu:.1f}%'})
                if peak_memory > 0:
                    insights.append({'type': 'info' if peak_memory < 90 else 'warning', 'message': f'Peak memory utilization: {peak_memory:.1f}% — Average: {avg_memory:.1f}%'})

                if most_active[0]:
                    tb_name = _resolve_testbed_name(most_active[0])
                    pct = most_active[1] / total_executions * 100 if total_executions else 0
                    insights.append({'type': 'info', 'message': f'Most active testbed: {tb_name} with {most_active[1]} executions ({pct:.0f}%)'})

                return {
                    'period': {
                        'start': start_date.isoformat(),
                        'end': end_date.isoformat(),
                        'days': (end_date - start_date).days
                    },
                    'key_metrics': {
                        'total_executions': total_executions,
                        'completed_executions': completed,
                        'failed_executions': failed,
                        'stopped_executions': stopped,
                        'success_rate': round(op_success_rate, 2),
                        'completion_rate': round(exec_completion_rate, 2),
                        'total_operations': total_operations,
                        'successful_operations': successful_operations,
                        'failed_operations': failed_operations,
                    },
                    'performance': {
                        'avg_duration_minutes': round(avg_duration, 2),
                        'total_test_hours': round(total_duration / 60, 1),
                        'avg_ops_per_minute': round(avg_ops_per_min, 2),
                        'threshold_reached': threshold_reached,
                        'longest_run_minutes': round(longest, 1),
                        'shortest_run_minutes': round(shortest, 1),
                    },
                    'resource_utilization': {
                        'avg_cpu_percent': round(avg_cpu, 2),
                        'avg_memory_percent': round(avg_memory, 2),
                        'peak_cpu_percent': round(peak_cpu, 2),
                        'peak_memory_percent': round(peak_memory, 2),
                    },
                    'status_breakdown': status_breakdown,
                    'entity_breakdown': entity_breakdown,
                    'insights': insights,
                    'most_active_testbed': {
                        'testbed_id': most_active[0],
                        'testbed_name': _resolve_testbed_name(most_active[0]) if most_active[0] else None,
                        'execution_count': most_active[1],
                    } if most_active[0] else None,
                    'testbed_summary': [
                        {
                            'testbed_id': tid,
                            'testbed_name': _resolve_testbed_name(tid),
                            'executions': cnt,
                        }
                        for tid, cnt in sorted(testbed_counts.items(), key=lambda x: -x[1])[:5]
                    ],
                }

            finally:
                session.close()

        except Exception as e:
            logger.error(f"Error generating executive summary: {e}")
            return {}
    
    def _empty_overview(self, start_date=None, end_date=None) -> Dict:
        """Return empty overview structure"""
        period = {}
        if start_date and end_date:
            period = {'start': start_date.isoformat(), 'end': end_date.isoformat(), 'days': (end_date - start_date).days}
        return {
            'period': period,
            'executions': {'total': 0, 'completed': 0, 'failed': 0, 'running': 0, 'stopped': 0, 'success_rate': 0, 'completion_rate': 0},
            'operations': {'total': 0, 'successful': 0, 'failed': 0, 'success_rate': 0, 'avg_per_execution': 0},
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
            values = [v for v in (_extract_cpu(e.final_metrics) for e in executions) if v is not None]
            return sum(values) / len(values) if values else 0
        elif metric == 'memory':
            values = [v for v in (_extract_memory(e.final_metrics) for e in executions) if v is not None]
            return sum(values) / len(values) if values else 0
        elif metric == 'success_rate':
            total_ops = sum(e.total_operations or 0 for e in executions)
            successful_ops = sum(e.successful_operations or 0 for e in executions)
            return (successful_ops / total_ops * 100) if total_ops > 0 else 0
        return 0
    
    def _calculate_testbed_metrics(self, executions, testbed_id):
        """Calculate metrics for a testbed"""
        total = len(executions)
        total_ops = sum(e.total_operations or 0 for e in executions)
        successful_ops = sum(e.successful_operations or 0 for e in executions)
        success_rate = (successful_ops / total_ops * 100) if total_ops > 0 else 0
        
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
        completed = sum(1 for e in executions if (e.status or '').upper() == 'COMPLETED')
        total_ops = sum(e.total_operations or 0 for e in executions)
        successful_ops = sum(e.successful_operations or 0 for e in executions)
        
        return {
            'name': period_name,
            'total_executions': total,
            'completed_executions': completed,
            'success_rate': round((successful_ops / total_ops * 100) if total_ops > 0 else 0, 2),
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
