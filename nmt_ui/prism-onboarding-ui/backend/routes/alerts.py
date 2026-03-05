import psycopg2
import logging
from flask import Blueprint, jsonify, request

logger = logging.getLogger(__name__)

alerts_bp = Blueprint('alerts', __name__)

@alerts_bp.route('/api/alerts', methods=['GET'])
def get_alerts_from_db():
    """
    Query alerts from the PostgreSQL alerts table and return as JSON.
    Supports filtering by severity, status, and testbed query parameters.
    """
    try:
        # Get filter parameters from query string - support both formats
        severity_filter = request.args.get('severity_filter', request.args.get('severity', '')).lower()
        status_filter = request.args.get('status_filter', request.args.get('status', '')).lower() 
        testbed_filter = request.args.get('testbed_filter', request.args.get('testbed', ''))
        date_filter = request.args.get('date', '')
        
        print(f"Alert filtering: severity={severity_filter}, status={status_filter}, testbed={testbed_filter}, date={date_filter}")
        
        conn = psycopg2.connect(
            dbname="alerts",
            user="alertuser",
            password="alertpass",
            host="localhost",
            port="5432"
        )
        cur = conn.cursor()
        
        # Build SQL query with optional date filter
        base_query = "SELECT id, alertname, severity, status, summary, description, timestamp, timestamp as received_at FROM alerts"
        where_conditions = []
        params = []
        
        # Add date filter if provided
        if date_filter:
            # Handle different date formats: YYYY-MM-DD, MM/DD/YYYY, M/D/YY
            from datetime import datetime
            try:
                # Try parsing different formats
                if '/' in date_filter:
                    if len(date_filter.split('/')[-1]) == 2:  # M/D/YY format
                        parsed_date = datetime.strptime(date_filter, '%m/%d/%y')
                    else:  # MM/DD/YYYY format
                        parsed_date = datetime.strptime(date_filter, '%m/%d/%Y')
                else:  # YYYY-MM-DD format
                    parsed_date = datetime.strptime(date_filter, '%Y-%m-%d')
                
                # Filter by date only (using PostgreSQL date comparison)
                where_conditions.append("received_at::date = %s")
                params.append(parsed_date.date())
                print(f"Date filter applied: {parsed_date.date()}")
                
            except ValueError as e:
                print(f"Invalid date format '{date_filter}': {e}")
        
        # Build final query
        if where_conditions:
            query = base_query + " WHERE " + " AND ".join(where_conditions) + " ORDER BY received_at DESC"
            cur.execute(query, params)
        else:
            query = base_query + " ORDER BY received_at DESC"
            cur.execute(query)
            
        rows = cur.fetchall()
        alert_dicts = []
        import re
        for row in rows:
            summary = row[4] or ''
            # Try to extract testbed name from summary using regex
            # Example: "For the PC 10.36.199.44 with label joseph_setup1"

            testbed = ""
            
            # Extract testbed from line starting with 'Testbed:' (newest format)
            for line in summary.splitlines():
                if line.strip().startswith("Testbed:"):
                    testbed = line.split("Testbed:", 1)[1].strip()
                    break
            
            # If not found, try older format: PC IP: 10.36.199.44 (testing_rhel)
            if not testbed:
                for line in summary.splitlines():
                    if line.strip().startswith("PC IP:") and "(" in line and ")" in line:
                        # Extract testbed from parentheses
                        start = line.find("(")
                        end = line.find(")", start)
                        if start != -1 and end != -1:
                            testbed = line[start+1:end].strip()
                            break
            
            # If still not found, try even older format with regex: "with label testbed_name"
            if not testbed:
                match = re.search(r'with label ([\w\-]+)', summary)
                if match:
                    testbed = match.group(1)
            
            # Skip alerts with no testbed name (but log for debugging)
            if not testbed:
                print(f"Warning: No testbed found for alert {row[0]}: {summary[:100]}...")
                continue  # Skip alerts with no testbed name

            # Apply filters before adding to results
            alert_severity = row[2] if row[2] else ''  # Keep original case
            alert_status = row[3] if row[3] else ''    # Keep original case
            
            # Severity filter - exact matching based on user selection
            if severity_filter and severity_filter.lower() != 'all':
                severity_val = severity_filter.lower()
                if severity_val == 'critical' and alert_severity != 'Critical':
                    continue
                elif severity_val == 'moderate' and alert_severity != 'Moderate':
                    continue 
                elif severity_val == 'low' and alert_severity != 'Low':
                    continue
            
            # Status filter - exact matching
            if status_filter and status_filter.lower() != 'all':
                status_val = status_filter.lower()
                if status_val == 'active' and alert_status != 'firing':
                    continue
                elif status_val == 'resolved' and alert_status != 'resolved':
                    continue
            
            # Testbed filter
            if testbed_filter and testbed_filter.lower() != 'all' and testbed_filter.lower() != testbed.lower():
                continue

            # ---- Old format Regex method of extracting testbed name ----
            # match = re.search(r'with label ([\w\-]+)', summary)
            # if not match:
            #     continue  # Skip alerts with no testbed name
            # testbed = match.group(1)
            alert_dicts.append({
                'id': row[0],
                'ruleName': row[1],
                'severity': row[2],
                'status': row[3],
                'summary': summary,
                'description': row[5],
                'timestamp': row[7].isoformat() + 'Z' if row[7] else None,
                'testbed': testbed
            })
        cur.close()
        conn.close()
        return jsonify({'alerts': alert_dicts, 'count': len(alert_dicts)})
    except Exception as e:
        print("Database query error:", e)
        return jsonify({'error': str(e)}), 500


def get_filtered_alerts(session, filters: dict = None, start_date=None, end_date=None, 
                       severity_filter=None, status_filter=None, testbed_filter=None) -> dict:
    """
    Get filtered alerts for email reports (non-route function for internal use)
    Supports both new dict-based filters and old individual parameter style
    """
    try:
        # Handle both calling styles
        if filters is None:
            filters = {
                'severity_filter': severity_filter,
                'status_filter': status_filter, 
                'testbed_filter': testbed_filter
            }
        
        conn = psycopg2.connect(
            dbname="alerts",
            user="alertuser", 
            password="alertpass",
            host="localhost",
            port="5432"
        )
        cur = conn.cursor()
        
        # Build the WHERE clause based on filters
        where_conditions = []
        params = []
        
        # Date range filter
        if start_date and end_date:
            where_conditions.append("received_at BETWEEN %s AND %s")
            params.extend([start_date, end_date])
        
        # Severity filter
        if filters.get('severity_filter') and filters['severity_filter'] != 'All':
            severity_map = {
                'critical': 'Critical',
                'moderate': 'Moderate', 
                'low': 'Low'
            }
            db_severity = severity_map.get(filters['severity_filter'].lower())
            if db_severity:
                where_conditions.append("severity = %s")
                params.append(db_severity)
        
        # Status filter  
        if filters.get('status_filter') and filters['status_filter'] != 'All':
            status_map = {
                'resolved': 'resolved',
                'active': 'firing',
                'firing': 'firing'
            }
            db_status = status_map.get(filters['status_filter'].lower(), filters['status_filter'].lower())
            where_conditions.append("status = %s")
            params.append(db_status)
        
        # Build the query
        base_query = """
            SELECT id, alertname, severity, status, summary, description, timestamp, timestamp as received_at 
            FROM alerts
        """
        
        if where_conditions:
            query = base_query + " WHERE " + " AND ".join(where_conditions) + " ORDER BY received_at DESC"
        else:
            query = base_query + " ORDER BY received_at DESC"
        
        cur.execute(query, params)
        rows = cur.fetchall()
        
        alert_dicts = []
        import re
        
        print(f"DEBUG: Retrieved {len(rows)} rows from database")
        print(f"DEBUG: Filters: severity={filters.get('severity_filter')}, status={filters.get('status_filter')}, testbed={filters.get('testbed_filter')}")
        
        for row in rows:
            summary = row[4] or ''
            # Try to extract testbed name from summary - look for "Testbed:testbed_name"
            match = re.search(r'Testbed:(\w+)', summary)
            if not match:
                # Fallback: try the old pattern
                match = re.search(r'with label ([\w\-]+)', summary)
                if not match:
                    continue  # Skip alerts with no testbed name
            
            testbed = match.group(1)
            
            # Apply testbed filter if specified
            if (filters.get('testbed_filter') and 
                filters['testbed_filter'] != 'All' and 
                testbed != filters['testbed_filter']):
                continue
            
            alert_dicts.append({
                'id': row[0],
                'ruleName': row[1],
                'severity': row[2],
                'status': row[3],
                'summary': summary,
                'description': row[5],
                'timestamp': row[7].isoformat() + 'Z' if row[7] else None,
                'testbed': testbed
            })
        
        cur.close()
        conn.close()
        
        print(f"DEBUG: Final filtered alerts: {len(alert_dicts)}")
        
        # Calculate summary statistics
        total_alerts = len(alert_dicts)
        critical_count = sum(1 for alert in alert_dicts if alert['severity'] == 'Critical')
        moderate_count = sum(1 for alert in alert_dicts if alert['severity'] == 'Moderate')
        low_count = sum(1 for alert in alert_dicts if alert['severity'] == 'Low')
        
        return {
            'alerts': alert_dicts,
            'total_alerts': total_alerts,
            'critical': critical_count,
            'moderate': moderate_count,
            'low': low_count
        }
        
    except Exception as e:
        print(f"Error getting filtered alerts: {e}")
        return {
            'alerts': [],
            'total_alerts': 0,
            'critical': 0,
            'moderate': 0,
            'low': 0
        }


# ===================================================================
# ALERT CONFIGURATION ENDPOINTS (Slack, Email, Webhook)
# ===================================================================

@alerts_bp.route('/api/alerts/config/<testbed_id>', methods=['GET'])
def get_alert_config(testbed_id):
    """Get alert notification configuration for a testbed"""
    try:
        from database import SessionLocal
        from models.testbed import Testbed
        
        session = SessionLocal()
        try:
            testbed = session.query(Testbed).filter_by(
                unique_testbed_id=testbed_id
            ).first()
            
            if not testbed:
                return jsonify({'success': False, 'error': 'Testbed not found'}), 404
            
            alert_config = testbed.alert_config if hasattr(testbed, 'alert_config') else {}
            
            if not alert_config:
                alert_config = {
                    'slack': {'enabled': False, 'webhook_url': ''},
                    'email': {
                        'enabled': False, 'smtp_host': '', 'smtp_port': 587,
                        'username': '', 'password': '', 'from_email': '',
                        'recipients': [], 'use_tls': True
                    },
                    'webhook': {'enabled': False, 'url': '', 'headers': {}}
                }
            
            return jsonify({'success': True, 'config': alert_config}), 200
        finally:
            session.close()
    except Exception as e:
        logger.exception(f"Error getting alert config for testbed {testbed_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@alerts_bp.route('/api/alerts/config/<testbed_id>', methods=['PUT'])
def update_alert_config(testbed_id):
    """Update alert notification configuration for a testbed"""
    try:
        data = request.get_json()
        from database import SessionLocal
        from models.testbed import Testbed
        
        session = SessionLocal()
        try:
            testbed = session.query(Testbed).filter_by(
                unique_testbed_id=testbed_id
            ).first()
            
            if not testbed:
                return jsonify({'success': False, 'error': 'Testbed not found'}), 404
            
            testbed.alert_config = data
            session.commit()
            
            logger.info(f"✅ Alert config updated for testbed {testbed_id}")
            return jsonify({'success': True, 'message': 'Alert configuration updated'}), 200
        finally:
            session.close()
    except Exception as e:
        logger.exception(f"Error updating alert config for testbed {testbed_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@alerts_bp.route('/api/alerts/test', methods=['POST'])
def test_alerts():
    """Test alert configuration by sending test alerts"""
    try:
        data = request.get_json()
        testbed_id = data.get('testbed_id')
        channels_to_test = data.get('channels', ['slack', 'email', 'webhook'])
        
        if not testbed_id:
            return jsonify({'success': False, 'error': 'testbed_id required'}), 400
        
        from database import SessionLocal
        from models.testbed import Testbed
        from services.alert_service import get_alert_service
        
        session = SessionLocal()
        try:
            testbed = session.query(Testbed).filter_by(
                unique_testbed_id=testbed_id
            ).first()
            
            if not testbed:
                return jsonify({'success': False, 'error': 'Testbed not found'}), 404
            
            alert_config = testbed.alert_config if hasattr(testbed, 'alert_config') else {}
            
            if not alert_config:
                return jsonify({
                    'success': False,
                    'error': 'No alert configuration found'
                }), 400
            
            filtered_config = {ch: alert_config[ch] for ch in channels_to_test if ch in alert_config}
            
            alert_service = get_alert_service()
            results = alert_service.send_test_alert(filtered_config)
            
            successful = sum(1 for v in results.values() if v)
            
            return jsonify({
                'success': True,
                'results': results,
                'message': f'{successful}/{len(results)} channel(s) successful'
            }), 200
        finally:
            session.close()
    except Exception as e:
        logger.exception("Error testing alerts")
        return jsonify({'success': False, 'error': str(e)}), 500
