"""
Analytics Routes

API endpoints for advanced analytics, trends, comparisons, and reporting.

Endpoints:
- GET    /api/analytics/overview - Get analytics overview
- GET    /api/analytics/trends - Get trend data
- POST   /api/analytics/compare-testbeds - Compare multiple testbeds
- POST   /api/analytics/compare-periods - Compare time periods
- GET    /api/analytics/executive-summary - Get executive summary
- POST   /api/analytics/export - Export analytics data
"""

import logging
import json
import csv
import io
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, send_file
from services.analytics_service import get_analytics_service

logger = logging.getLogger(__name__)

# Create blueprint
analytics_bp = Blueprint('analytics', __name__)


@analytics_bp.route('/api/analytics/overview', methods=['GET'])
def get_analytics_overview():
    """
    Get analytics overview
    
    Query params:
    - start_date: Start date (YYYY-MM-DD)
    - end_date: End date (YYYY-MM-DD)
    - testbed_id: Optional testbed filter
    
    Returns:
    {
        "success": true,
        "overview": {...}
    }
    """
    try:
        # Parse dates
        start_date_str = request.args.get('start_date')
        end_date_str = request.args.get('end_date')
        testbed_id = request.args.get('testbed_id')
        
        if not start_date_str or not end_date_str:
            # Default to last 30 days
            end_date = datetime.now()
            start_date = end_date - timedelta(days=30)
        else:
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
            end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
        
        analytics_service = get_analytics_service()
        overview = analytics_service.get_overview(start_date, end_date, testbed_id)
        
        return jsonify({
            'success': True,
            'overview': overview
        }), 200
        
    except Exception as e:
        logger.exception("Error getting analytics overview")
        return jsonify({'success': False, 'error': str(e)}), 500


@analytics_bp.route('/api/analytics/trends', methods=['GET'])
def get_analytics_trends():
    """
    Get trend data
    
    Query params:
    - start_date: Start date (YYYY-MM-DD)
    - end_date: End date (YYYY-MM-DD)
    - metric: Metric to track (executions, operations, cpu, memory, success_rate)
    - granularity: hourly, daily, weekly (default: daily)
    - testbed_id: Optional testbed filter
    
    Returns:
    {
        "success": true,
        "trends": {...}
    }
    """
    try:
        start_date_str = request.args.get('start_date')
        end_date_str = request.args.get('end_date')
        metric = request.args.get('metric', 'executions')
        granularity = request.args.get('granularity', 'daily')
        testbed_id = request.args.get('testbed_id')
        
        if not start_date_str or not end_date_str:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=30)
        else:
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
            end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
        
        analytics_service = get_analytics_service()
        trends = analytics_service.get_trends(
            start_date, end_date, metric, granularity, testbed_id
        )
        
        return jsonify({
            'success': True,
            'trends': trends
        }), 200
        
    except Exception as e:
        logger.exception("Error getting analytics trends")
        return jsonify({'success': False, 'error': str(e)}), 500


@analytics_bp.route('/api/analytics/compare-testbeds', methods=['POST'])
def compare_testbeds():
    """
    Compare multiple testbeds
    
    Request Body:
    {
        "testbed_ids": ["id1", "id2", "id3"],
        "start_date": "2026-01-01",
        "end_date": "2026-02-01"
    }
    
    Returns:
    {
        "success": true,
        "comparison": {...}
    }
    """
    try:
        data = request.get_json()
        
        testbed_ids = data.get('testbed_ids', [])
        start_date_str = data.get('start_date')
        end_date_str = data.get('end_date')
        
        if not testbed_ids:
            return jsonify({'success': False, 'error': 'testbed_ids required'}), 400
        
        if not start_date_str or not end_date_str:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=30)
        else:
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
            end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
        
        analytics_service = get_analytics_service()
        comparison = analytics_service.compare_testbeds(testbed_ids, start_date, end_date)
        
        return jsonify({
            'success': True,
            'comparison': comparison
        }), 200
        
    except Exception as e:
        logger.exception("Error comparing testbeds")
        return jsonify({'success': False, 'error': str(e)}), 500


@analytics_bp.route('/api/analytics/compare-periods', methods=['POST'])
def compare_periods():
    """
    Compare two time periods for a testbed
    
    Request Body:
    {
        "testbed_id": "testbed-id",
        "period1": {"start": "2026-01-01", "end": "2026-01-15"},
        "period2": {"start": "2026-01-16", "end": "2026-01-31"}
    }
    
    Returns:
    {
        "success": true,
        "comparison": {...}
    }
    """
    try:
        data = request.get_json()
        
        testbed_id = data.get('testbed_id')
        period1 = data.get('period1', {})
        period2 = data.get('period2', {})
        
        if not testbed_id:
            return jsonify({'success': False, 'error': 'testbed_id required'}), 400
        
        if not period1 or not period2:
            return jsonify({'success': False, 'error': 'Both periods required'}), 400
        
        period1_start = datetime.strptime(period1['start'], '%Y-%m-%d')
        period1_end = datetime.strptime(period1['end'], '%Y-%m-%d')
        period2_start = datetime.strptime(period2['start'], '%Y-%m-%d')
        period2_end = datetime.strptime(period2['end'], '%Y-%m-%d')
        
        analytics_service = get_analytics_service()
        comparison = analytics_service.compare_time_periods(
            testbed_id, period1_start, period1_end, period2_start, period2_end
        )
        
        return jsonify({
            'success': True,
            'comparison': comparison
        }), 200
        
    except Exception as e:
        logger.exception("Error comparing periods")
        return jsonify({'success': False, 'error': str(e)}), 500


@analytics_bp.route('/api/analytics/executive-summary', methods=['GET'])
def get_executive_summary():
    """
    Get executive summary
    
    Query params:
    - start_date: Start date (YYYY-MM-DD)
    - end_date: End date (YYYY-MM-DD)
    
    Returns:
    {
        "success": true,
        "summary": {...}
    }
    """
    try:
        start_date_str = request.args.get('start_date')
        end_date_str = request.args.get('end_date')
        
        if not start_date_str or not end_date_str:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=30)
        else:
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
            end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
        
        analytics_service = get_analytics_service()
        summary = analytics_service.get_executive_summary(start_date, end_date)
        
        return jsonify({
            'success': True,
            'summary': summary
        }), 200
        
    except Exception as e:
        logger.exception("Error getting executive summary")
        return jsonify({'success': False, 'error': str(e)}), 500


@analytics_bp.route('/api/analytics/export', methods=['POST'])
def export_analytics():
    """
    Export analytics data
    
    Request Body:
    {
        "format": "csv" | "json",
        "data_type": "overview" | "trends" | "comparison",
        "params": {...}
    }
    
    Returns:
    File download (CSV or JSON)
    """
    try:
        data = request.get_json()
        
        export_format = data.get('format', 'csv')
        data_type = data.get('data_type', 'overview')
        params = data.get('params', {})
        
        # Parse dates
        start_date_str = params.get('start_date')
        end_date_str = params.get('end_date')
        
        if not start_date_str or not end_date_str:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=30)
        else:
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
            end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
        
        analytics_service = get_analytics_service()
        
        # Get data based on type
        if data_type == 'overview':
            export_data = analytics_service.get_overview(start_date, end_date)
        elif data_type == 'trends':
            metric = params.get('metric', 'executions')
            granularity = params.get('granularity', 'daily')
            export_data = analytics_service.get_trends(start_date, end_date, metric, granularity)
        elif data_type == 'executive-summary':
            export_data = analytics_service.get_executive_summary(start_date, end_date)
        else:
            return jsonify({'success': False, 'error': 'Invalid data_type'}), 400
        
        # Generate file
        if export_format == 'json':
            # JSON export
            output = io.BytesIO()
            output.write(json.dumps(export_data, indent=2).encode('utf-8'))
            output.seek(0)
            
            filename = f'analytics_{data_type}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
            
            return send_file(
                output,
                mimetype='application/json',
                as_attachment=True,
                download_name=filename
            )
            
        else:  # CSV export
            output = io.StringIO()
            
            # Convert data to CSV
            if data_type == 'overview':
                writer = csv.writer(output)
                writer.writerow(['Metric', 'Value'])
                
                # Flatten overview data
                writer.writerow(['Total Executions', export_data['executions']['total']])
                writer.writerow(['Success Rate', f"{export_data['executions']['success_rate']}%"])
                writer.writerow(['Total Operations', export_data['operations']['total']])
                writer.writerow(['Avg Duration (min)', export_data['performance']['avg_duration_minutes']])
                writer.writerow(['Avg CPU %', export_data['resource_utilization']['avg_cpu_percent']])
                writer.writerow(['Avg Memory %', export_data['resource_utilization']['avg_memory_percent']])
                
            elif data_type == 'trends':
                writer = csv.writer(output)
                writer.writerow(['Period', 'Value', 'Count'])
                
                for item in export_data.get('trend_data', []):
                    writer.writerow([item['period'], item['value'], item['count']])
            
            # Prepare for download
            output.seek(0)
            filename = f'analytics_{data_type}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
            
            mem_file = io.BytesIO()
            mem_file.write(output.getvalue().encode('utf-8'))
            mem_file.seek(0)
            
            return send_file(
                mem_file,
                mimetype='text/csv',
                as_attachment=True,
                download_name=filename
            )
        
    except Exception as e:
        logger.exception("Error exporting analytics")
        return jsonify({'success': False, 'error': str(e)}), 500


logger.info("✅ Analytics routes loaded")
