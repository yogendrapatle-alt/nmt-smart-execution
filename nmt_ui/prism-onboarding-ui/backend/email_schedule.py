import os
import json
from datetime import datetime

def get_config_file_path():
    return os.path.join(os.path.dirname(__file__), 'email_schedule_config.json')

def load_email_schedule():
    config_file = get_config_file_path()
    if os.path.exists(config_file):
        with open(config_file, 'r') as f:
            return json.load(f)
    else:
        # Return default configuration
        return {
            'enabled': False,
            'emailAddress': '',
            'scheduleTime': '09:00',
            'timezone': 'UTC',
            'severityFilter': 'All',
            'testbedFilter': 'All'
        }

def save_email_schedule(schedule_config):
    config_file = get_config_file_path()
    with open(config_file, 'w') as f:
        json.dump(schedule_config, f, indent=2)

def validate_email_schedule(data):
    if not data:
        return False, 'Request body is required'
    enabled = data.get('enabled', False)
    email_address = data.get('emailAddress', '').strip()
    if enabled:
        if not email_address:
            return False, 'Email address is required when enabling schedule'
        if '@' not in email_address:
            return False, 'Invalid email address format'
    return True, ''

def build_schedule_config(data):
    return {
        'enabled': data.get('enabled', False),
        'emailAddress': data.get('emailAddress', '').strip(),
        'scheduleTime': data.get('scheduleTime', '09:00'),
        'timezone': data.get('timezone', 'UTC'),
        'severityFilter': data.get('severityFilter', 'All'),
        'testbedFilter': data.get('testbedFilter', 'All'),
        'lastUpdated': datetime.now().isoformat()
    }
