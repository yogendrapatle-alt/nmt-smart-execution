"""
HTML Report Generation Service for NMT Executions
Generates comprehensive execution reports with Prometheus metrics
"""

import logging
from datetime import datetime
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)


class HTMLReportService:
    """Generate comprehensive HTML execution reports"""
    
    @staticmethod
    def generate_execution_report(
        execution_data: Dict,
        testbed_data: Dict,
        operation_metrics: List[Dict],
        prometheus_metrics: Dict,
        alerts: List[Dict]
    ) -> str:
        """
        Generate full HTML execution report
        
        Args:
            execution_data: Execution details (from executions table)
            testbed_data: Testbed details (from testbeds table)
            operation_metrics: Individual operations (from operation_metrics table)
            prometheus_metrics: System metrics (from metrics_history/executions.metrics)
            alerts: Alerts triggered (from slack_alerts table)
            
        Returns:
            Complete HTML report as string
        """
        
        # Calculate summaries
        summary = HTMLReportService._calculate_summary(
            execution_data, operation_metrics, prometheus_metrics, alerts
        )
        
        # Group operations by entity type
        entity_groups = HTMLReportService._group_by_entity(operation_metrics)
        
        # Calculate resource trends
        trends = HTMLReportService._calculate_trends(prometheus_metrics)
        
        # Identify worst performers
        worst_performers = HTMLReportService._find_worst_performers(operation_metrics)
        
        # Generate HTML
        html_content = HTMLReportService._render_html(
            execution=execution_data,
            testbed=testbed_data,
            summary=summary,
            entity_groups=entity_groups,
            operation_metrics=operation_metrics,
            prometheus_metrics=prometheus_metrics,
            alerts=alerts,
            trends=trends,
            worst_performers=worst_performers
        )
        
        return html_content
    
    @staticmethod
    def _calculate_summary(execution_data, operation_metrics, prometheus_metrics, alerts):
        """Calculate executive summary statistics"""
        total_ops = len(operation_metrics)
        successful_ops = sum(1 for op in operation_metrics if op.get('status') == 'SUCCESS')
        failed_ops = sum(1 for op in operation_metrics if op.get('status') == 'FAILED')
        
        total_duration = sum(op.get('duration_seconds', 0) for op in operation_metrics)
        avg_duration = total_duration / total_ops if total_ops > 0 else 0
        
        # CPU/Memory stats
        cpu_avg = prometheus_metrics.get('cpu', {}).get('avg', 0) if isinstance(prometheus_metrics.get('cpu'), dict) else 0
        cpu_max = prometheus_metrics.get('cpu', {}).get('max', 0) if isinstance(prometheus_metrics.get('cpu'), dict) else 0
        memory_avg = prometheus_metrics.get('memory', {}).get('avg', 0) if isinstance(prometheus_metrics.get('memory'), dict) else 0
        memory_max = prometheus_metrics.get('memory', {}).get('max', 0) if isinstance(prometheus_metrics.get('memory'), dict) else 0
        
        return {
            'total_operations': total_ops,
            'successful_operations': successful_ops,
            'failed_operations': failed_ops,
            'success_rate': (successful_ops / total_ops * 100) if total_ops > 0 else 0,
            'avg_operation_duration': avg_duration,
            'total_duration_minutes': execution_data.get('duration_minutes', 0) or 0,
            'avg_cpu_percent': cpu_avg,
            'max_cpu_percent': cpu_max,
            'avg_memory_percent': memory_avg,
            'max_memory_percent': memory_max,
            'alerts_triggered': len(alerts),
            'critical_alerts': sum(1 for a in alerts if a.get('severity') == 'critical'),
            'entity_types_count': len(set(op.get('entity_type') for op in operation_metrics))
        }
    
    @staticmethod
    def _group_by_entity(operation_metrics):
        """Group operations by entity type"""
        groups = {}
        for op in operation_metrics:
            entity_type = op.get('entity_type', 'Unknown')
            if entity_type not in groups:
                groups[entity_type] = []
            groups[entity_type].append(op)
        return groups
    
    @staticmethod
    def _calculate_trends(prometheus_metrics):
        """Calculate resource utilization trends"""
        cpu_data = prometheus_metrics.get('cpu', {}).get('timeline', []) if isinstance(prometheus_metrics.get('cpu'), dict) else []
        memory_data = prometheus_metrics.get('memory', {}).get('timeline', []) if isinstance(prometheus_metrics.get('memory'), dict) else []
        
        return {
            'cpu_trend': 'increasing' if len(cpu_data) > 1 and cpu_data[-1] > cpu_data[0] else 'stable',
            'memory_trend': 'increasing' if len(memory_data) > 1 and memory_data[-1] > memory_data[0] else 'stable',
            'cpu_spike_count': sum(1 for v in cpu_data if v > 80),
            'memory_spike_count': sum(1 for v in memory_data if v > 80)
        }
    
    @staticmethod
    def _find_worst_performers(operation_metrics):
        """Find slowest operations"""
        sorted_ops = sorted(
            operation_metrics,
            key=lambda x: x.get('duration_seconds', 0) or 0,
            reverse=True
        )
        return sorted_ops[:10]  # Top 10 slowest
    
    @staticmethod
    def _render_html(execution, testbed, summary, entity_groups, operation_metrics, 
                     prometheus_metrics, alerts, trends, worst_performers):
        """Render HTML report"""
        
        generated_at = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')
        
        # Status badge color
        status_color = 'success' if execution.get('status') == 'COMPLETED' else 'danger' if execution.get('status') == 'FAILED' else 'warning'
        
        # Entity groups HTML
        entity_rows = ""
        for entity_type, ops in entity_groups.items():
            success_count = sum(1 for op in ops if op.get('status') == 'SUCCESS')
            total_count = len(ops)
            success_rate = (success_count / total_count * 100) if total_count > 0 else 0
            success_class = 'success' if success_rate > 90 else 'failed' if success_rate < 70 else 'warn'
            
            create_count = sum(1 for op in ops if op.get('operation_type') == 'create')
            update_count = sum(1 for op in ops if op.get('operation_type') == 'update')
            delete_count = sum(1 for op in ops if op.get('operation_type') == 'delete')
            other_count = total_count - create_count - update_count - delete_count
            
            entity_rows += f"""
            <tr>
                <td><strong>{entity_type}</strong></td>
                <td>{total_count}</td>
                <td>{create_count}</td>
                <td>{update_count}</td>
                <td>{delete_count}</td>
                <td>{other_count}</td>
                <td><span class="{success_class}">{success_rate:.1f}%</span></td>
            </tr>
            """
        
        # Pod performance HTML
        pod_rows = ""
        sorted_by_cpu = sorted(operation_metrics, key=lambda x: x.get('pod_cpu_percent', 0) or 0, reverse=True)[:10]
        for idx, op in enumerate(sorted_by_cpu, 1):
            cpu_pct = op.get('pod_cpu_percent', 0) or 0
            cpu_class = 'crit' if cpu_pct > 90 else 'warn' if cpu_pct > 70 else ''
            status_badge = 'success' if op.get('status') == 'SUCCESS' else 'danger'
            
            pod_rows += f"""
            <tr class="{cpu_class}">
                <td>{idx}</td>
                <td>{op.get('entity_type', 'N/A')}</td>
                <td>{op.get('operation_type', 'N/A')}</td>
                <td>{op.get('duration_seconds', 0):.2f}</td>
                <td>{cpu_pct:.2f}</td>
                <td>{op.get('pod_memory_mb', 0):.2f}</td>
                <td><span class="badge badge-{status_badge}">{op.get('status', 'N/A')}</span></td>
                <td style="font-size: 0.85em;">{op.get('started_at', 'N/A')}</td>
            </tr>
            """
        
        # Alerts HTML
        alerts_html = ""
        if alerts:
            for alert in alerts:
                sev_color = 'danger' if alert.get('severity') == 'critical' else 'warning' if alert.get('severity') == 'warning' else 'info'
                alert_class = 'crit' if alert.get('severity') == 'critical' else 'warn'
                
                alerts_html += f"""
                <tr class="{alert_class}">
                    <td><strong>{alert.get('alert_name', 'N/A')}</strong></td>
                    <td><span class="badge badge-{sev_color}">{alert.get('severity', 'N/A')}</span></td>
                    <td>{alert.get('status', 'N/A')}</td>
                    <td style="font-size: 0.85em;">{alert.get('triggered_at', 'N/A')}</td>
                    <td style="font-size: 0.85em;">{alert.get('resolved_at', 'N/A') or 'N/A'}</td>
                    <td>{alert.get('description', '') or alert.get('message', 'N/A')}</td>
                </tr>
                """
        
        # Worst performers HTML
        worst_rows = ""
        for idx, op in enumerate(worst_performers, 1):
            duration = op.get('duration_seconds', 0) or 0
            duration_class = 'crit' if duration > 300 else 'warn' if duration > 120 else ''
            status_badge = 'success' if op.get('status') == 'SUCCESS' else 'danger'
            
            worst_rows += f"""
            <tr>
                <td>{idx}</td>
                <td>{op.get('entity_type', 'N/A')}</td>
                <td>{op.get('operation_type', 'N/A')}</td>
                <td>{op.get('entity_name', 'N/A')}</td>
                <td class="{duration_class}">{duration:.2f}</td>
                <td><span class="badge badge-{status_badge}">{op.get('status', 'N/A')}</span></td>
                <td style="font-size: 0.85em;">{op.get('error_message', '-') or '-'}</td>
            </tr>
            """
        
        # Timeline HTML
        timeline_rows = ""
        for idx, op in enumerate(operation_metrics, 1):
            status_class = 'success' if op.get('status') == 'SUCCESS' else 'failed'
            status_indicator = 'success' if op.get('status') == 'SUCCESS' else 'failed'
            
            timeline_rows += f"""
            <tr class="{status_class}">
                <td>{idx}</td>
                <td style="font-size: 0.8em;">{op.get('started_at', 'N/A')}</td>
                <td>{op.get('entity_type', 'N/A')}</td>
                <td>{op.get('operation_type', 'N/A')}</td>
                <td>{op.get('entity_name', 'N/A')}</td>
                <td>{op.get('duration_seconds', 0):.2f}s</td>
                <td>{op.get('pod_cpu_percent', 0):.1f}%</td>
                <td>{op.get('pod_memory_mb', 0):.1f}</td>
                <td><span class="status-indicator status-{status_indicator}"></span> {op.get('status', 'N/A')}</td>
            </tr>
            """
        
        html_template = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>NMT Execution Report - {execution.get('execution_id', 'N/A')}</title>
    <style>
        body {{ font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif; margin: 20px; background-color: #f8f9fa; color: #212529; }}
        h1, h2, h3 {{ color: #0078D4; border-bottom: 2px solid #dee2e6; padding-bottom: 10px; }}
        h1 {{ color: #005A9C; font-size: 2em; }}
        h2 {{ font-size: 1.5em; margin-top: 30px; }}
        .header {{ background-color: white; padding: 25px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); margin-bottom: 25px; }}
        .summary-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin-bottom: 30px; }}
        .summary-item {{ background-color: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }}
        .summary-item h3 {{ margin: 0 0 10px; color: #666; font-size: 0.9em; text-transform: uppercase; border: none; }}
        .summary-item p {{ font-size: 2em; font-weight: bold; margin: 0; color: #0078D4; }}
        .summary-item small {{ font-size: 0.6em; color: #666; }}
        table {{ border-collapse: collapse; width: 100%; margin-bottom: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); background-color: white; }}
        th, td {{ border: 1px solid #dee2e6; padding: 10px; text-align: left; }}
        th {{ background-color: #0078D4; color: white; position: sticky; top: 0; z-index: 10; }}
        tr:nth-child(even) {{ background-color: #f8f9fa; }}
        tr:hover {{ background-color: #e9ecef; }}
        .success {{ background-color: #d4edda !important; color: #155724; font-weight: bold; }}
        .failed {{ background-color: #f8d7da !important; color: #721c24; font-weight: bold; }}
        .warn {{ background-color: #fff3cd !important; color: #856404; }}
        .crit {{ background-color: #f8d7da !important; color: #721c24; font-weight: bold; }}
        .section {{ background-color: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 25px; }}
        .badge {{ padding: 4px 8px; border-radius: 4px; font-size: 0.85em; font-weight: bold; }}
        .badge-success {{ background-color: #28a745; color: white; }}
        .badge-danger {{ background-color: #dc3545; color: white; }}
        .badge-warning {{ background-color: #ffc107; color: #212529; }}
        .badge-info {{ background-color: #17a2b8; color: white; }}
        .status-indicator {{ display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; }}
        .status-success {{ background-color: #28a745; }}
        .status-failed {{ background-color: #dc3545; }}
        .collapsible {{ cursor: pointer; padding: 15px; background-color: #f0f0f0; border: 1px solid #ddd; margin-bottom: 5px; border-radius: 4px; }}
        .collapsible:hover {{ background-color: #e0e0e0; }}
        .collapsible::before {{ content: "▼ "; }}
        .collapsible.collapsed::before {{ content: "▶ "; }}
        .content {{ display: none; padding: 15px; border: 1px solid #ddd; border-top: none; background-color: white; }}
    </style>
    <script>
        function toggleContent(id) {{
            var content = document.getElementById(id);
            var button = event.target;
            if (content.style.display === "block") {{
                content.style.display = "none";
                button.classList.add('collapsed');
            }} else {{
                content.style.display = "block";
                button.classList.remove('collapsed');
            }}
        }}
    </script>
</head>
<body>

<div class="header">
    <h1>🚀 NMT Execution Report</h1>
    <p><strong>Execution ID:</strong> {execution.get('execution_id', 'N/A')}</p>
    <p><strong>Testbed:</strong> {testbed.get('testbed_label', 'N/A')} ({testbed.get('pc_ip', 'N/A')})</p>
    <p><strong>NCM Cluster:</strong> {testbed.get('ncm_ip', 'N/A')}</p>
    <p><strong>Status:</strong> <span class="badge badge-{status_color}">{execution.get('status', 'N/A')}</span></p>
    <p><strong>Execution Period:</strong> {execution.get('start_time', 'N/A')} → {execution.get('end_time') or 'In Progress'}</p>
    <p><strong>Duration:</strong> {summary['total_duration_minutes']:.2f} minutes</p>
    <p><strong>Report Generated:</strong> {generated_at}</p>
</div>

<h2>📊 Executive Summary</h2>
<div class="summary-grid">
    <div class="summary-item"><h3>Total Operations</h3><p>{summary['total_operations']}</p></div>
    <div class="summary-item">
        <h3>Success Rate</h3>
        <p style="color: {'#28a745' if summary['success_rate'] > 90 else '#dc3545' if summary['success_rate'] < 70 else '#ffc107'}">{summary['success_rate']:.1f}%</p>
    </div>
    <div class="summary-item"><h3>Successful</h3><p style="color: #28a745;">{summary['successful_operations']}</p></div>
    <div class="summary-item"><h3>Failed</h3><p style="color: #dc3545;">{summary['failed_operations']}</p></div>
    <div class="summary-item"><h3>Entity Types</h3><p>{summary['entity_types_count']}</p></div>
    <div class="summary-item">
        <h3>Avg CPU</h3>
        <p style="color: {'#dc3545' if summary['avg_cpu_percent'] > 80 else '#ffc107' if summary['avg_cpu_percent'] > 60 else '#28a745'}">{summary['avg_cpu_percent']:.1f}%</p>
    </div>
    <div class="summary-item">
        <h3>Max CPU</h3>
        <p style="color: {'#dc3545' if summary['max_cpu_percent'] > 90 else '#ffc107' if summary['max_cpu_percent'] > 70 else '#28a745'}">{summary['max_cpu_percent']:.1f}%</p>
    </div>
    <div class="summary-item">
        <h3>Avg Memory</h3>
        <p style="color: {'#dc3545' if summary['avg_memory_percent'] > 80 else '#ffc107' if summary['avg_memory_percent'] > 60 else '#28a745'}">{summary['avg_memory_percent']:.1f}%</p>
    </div>
    <div class="summary-item">
        <h3>Alerts Triggered</h3>
        <p style="color: {'#dc3545' if summary['critical_alerts'] > 0 else '#28a745' if summary['alerts_triggered'] == 0 else '#ffc107'}">{summary['alerts_triggered']}</p>
    </div>
    <div class="summary-item"><h3>Avg Operation Time</h3><p>{summary['avg_operation_duration']:.2f}s</p></div>
</div>

<div class="section">
    <h2>📋 Entity Operations Breakdown</h2>
    <table>
        <thead>
            <tr><th>Entity Type</th><th>Total Ops</th><th>Create</th><th>Update</th><th>Delete</th><th>Other</th><th>Success Rate</th></tr>
        </thead>
        <tbody>{entity_rows}</tbody>
    </table>
</div>

<div class="section">
    <h2>📈 System Metrics (Prometheus)</h2>
    <div class="summary-grid">
        <div class="summary-item"><h3>CPU Usage</h3><p>Avg: {summary['avg_cpu_percent']:.1f}%</p><small>Max: {summary['max_cpu_percent']:.1f}%</small></div>
        <div class="summary-item"><h3>Memory Usage</h3><p>Avg: {summary['avg_memory_percent']:.1f}%</p><small>Max: {summary['max_memory_percent']:.1f}%</small></div>
        <div class="summary-item"><h3>Network RX</h3><p>{prometheus_metrics.get('network', {}).get('rx_mbps', 0):.2f} MB/s</p></div>
        <div class="summary-item"><h3>Network TX</h3><p>{prometheus_metrics.get('network', {}).get('tx_mbps', 0):.2f} MB/s</p></div>
    </div>
</div>

<div class="section">
    <h2>🎯 Pod-Level Performance (Top 10 by CPU)</h2>
    <table>
        <thead>
            <tr><th>#</th><th>Entity</th><th>Operation</th><th>Duration (s)</th><th>Pod CPU %</th><th>Pod Memory (MB)</th><th>Status</th><th>Timestamp</th></tr>
        </thead>
        <tbody>{pod_rows}</tbody>
    </table>
</div>

{'<div class="section"><h2>🚨 Alerts Triggered During Execution</h2><table><thead><tr><th>Alert Name</th><th>Severity</th><th>Status</th><th>Triggered At</th><th>Resolved At</th><th>Description</th></tr></thead><tbody>' + alerts_html + '</tbody></table></div>' if alerts else ''}

<div class="section">
    <h2>⏱️ Slowest Operations (Top 10)</h2>
    <table>
        <thead>
            <tr><th>#</th><th>Entity Type</th><th>Operation</th><th>Entity Name</th><th>Duration (s)</th><th>Status</th><th>Error (if any)</th></tr>
        </thead>
        <tbody>{worst_rows}</tbody>
    </table>
</div>

<div class="section">
    <h2>📅 Complete Operation Timeline</h2>
    <div class="collapsible collapsed" onclick="toggleContent('timeline-details')">Click to expand/collapse all {len(operation_metrics)} operations</div>
    <div id="timeline-details" class="content">
        <table>
            <thead>
                <tr><th>#</th><th>Time</th><th>Entity</th><th>Operation</th><th>Name</th><th>Duration</th><th>CPU %</th><th>Mem (MB)</th><th>Status</th></tr>
            </thead>
            <tbody>{timeline_rows}</tbody>
        </table>
    </div>
</div>

<div style="margin-top: 40px; text-align: center; color: #666; font-size: 0.9em;">
    <p>Generated by NMT (Nutanix Monitoring Tool) {generated_at}</p>
    <p>For support, contact your system administrator</p>
</div>

</body>
</html>
"""
        
        return html_template
