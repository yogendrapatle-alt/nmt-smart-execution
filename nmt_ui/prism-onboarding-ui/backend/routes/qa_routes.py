"""
Simple test endpoint to verify multi-user email scheduling works with raw SQL
"""
from flask import Blueprint, request, jsonify
import psycopg2
import json

test_routes = Blueprint('test_routes', __name__)

def get_db_connection():
    return psycopg2.connect(
        dbname="alerts",
        user="alertuser", 
        password="alertpass",
        host="10.53.61.226",
        port="5432"
    )

@test_routes.route('/api/test-schedule-email', methods=['POST'])
def test_schedule_email():
    """Test creating email schedule using raw SQL"""
    try:
        data = request.json
        
        # Validate required fields
        required = ['userEmail', 'scheduleName', 'scheduleTime', 'emailAddresses', 'enabled']
        for field in required:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing field: {field}'}), 400
        
        # Convert email addresses array to comma-separated string
        email_addresses = data['emailAddresses']
        if isinstance(email_addresses, list):
            email_addresses = ','.join(email_addresses)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if schedule already exists
        cursor.execute("""
            SELECT id FROM email_schedules 
            WHERE user_email = %s AND schedule_name = %s
        """, (data['userEmail'], data['scheduleName']))
        
        existing = cursor.fetchone()
        
        if existing:
            # Update existing
            cursor.execute("""
                UPDATE email_schedules 
                SET schedule_time = %s, timezone = %s, email_addresses = %s, 
                    subject = %s, enabled = %s, filters = %s, updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
                RETURNING id, user_email, schedule_name
            """, (
                data['scheduleTime'], data.get('timezone', 'UTC'),
                email_addresses, data.get('subject'),
                data['enabled'], json.dumps(data.get('filters', {})),
                existing[0]
            ))
            result = cursor.fetchone()
            message = f"Updated schedule '{data['scheduleName']}' for {data['userEmail']}"
        else:
            # Create new
            cursor.execute("""
                INSERT INTO email_schedules 
                (user_email, schedule_name, schedule_time, timezone, email_addresses, 
                 subject, enabled, filters, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                RETURNING id, user_email, schedule_name
            """, (
                data['userEmail'], data['scheduleName'], data['scheduleTime'],
                data.get('timezone', 'UTC'), email_addresses, data.get('subject'),
                data['enabled'], json.dumps(data.get('filters', {}))
            ))
            result = cursor.fetchone()
            message = f"Created schedule '{data['scheduleName']}' for {data['userEmail']}"
        
        conn.commit()
        
        return jsonify({
            'success': True,
            'message': message,
            'schedule': {
                'id': result[0],
                'userEmail': result[1],
                'scheduleName': result[2]
            }
        })
        
    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'conn' in locals():
            conn.close()

@test_routes.route('/api/test-get-schedules', methods=['GET'])
def test_get_schedules():
    """Test getting schedules for a user using raw SQL"""
    try:
        user_email = request.args.get('userEmail')
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if user_email:
            cursor.execute("""
                SELECT id, user_email, schedule_name, schedule_time, timezone,
                       email_addresses, subject, enabled, filters,
                       created_at, updated_at
                FROM email_schedules 
                WHERE user_email = %s
                ORDER BY created_at DESC
            """, (user_email,))
        else:
            cursor.execute("""
                SELECT id, user_email, schedule_name, schedule_time, timezone,
                       email_addresses, subject, enabled, filters,
                       created_at, updated_at
                FROM email_schedules 
                ORDER BY created_at DESC
            """)
        
        schedules = []
        for row in cursor.fetchall():
            schedules.append({
                'id': row[0],
                'userEmail': row[1],
                'scheduleName': row[2],
                'scheduleTime': row[3],
                'timezone': row[4],
                'emailAddresses': row[5].split(',') if row[5] else [],
                'subject': row[6],
                'enabled': row[7],
                'filters': row[8] or {},
                'createdAt': row[9].isoformat() if row[9] else None,
                'updatedAt': row[10].isoformat() if row[10] else None
            })
        
        return jsonify({
            'success': True,
            'schedules': schedules,
            'count': len(schedules)
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'conn' in locals():
            conn.close()
