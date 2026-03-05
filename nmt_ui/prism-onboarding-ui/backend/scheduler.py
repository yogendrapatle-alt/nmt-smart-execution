from apscheduler.schedulers.background import BackgroundScheduler
import os
import requests
from datetime import datetime
from database import SessionLocal, save_alerts_to_db
from app import process_prometheus_rules

# Example Prometheus endpoint (update as needed)
PROMETHEUS_ENDPOINT = os.environ.get('PROMETHEUS_ENDPOINT', 'http://localhost:9090')

scheduler = BackgroundScheduler()

def fetch_and_save_alerts():
    """Fetch alerts from Prometheus and save to DB (runs periodically)."""
    print("[APScheduler] Fetching alerts from Prometheus...")
    try:
        rules_url = f"{PROMETHEUS_ENDPOINT}/api/v1/rules"
        response = requests.get(rules_url, timeout=10)
        if response.ok:
            rules_data = response.json()
            if rules_data.get('status') == 'success':
                rule_groups = rules_data.get('data', {}).get('groups', [])
                all_alerts_results = process_prometheus_rules(rule_groups)
                alert_dicts = []
                for alert_result in all_alerts_results:
                    metric = alert_result.get('metric', {})
                    value_data = alert_result.get('value', [])
                    alertname = metric.get('alertname', 'UnknownAlert')
                    alertstate = metric.get('alertstate', 'unknown')
                    pod = metric.get('pod', 'unknown-pod')
                    namespace = metric.get('namespace', 'default')
                    if len(value_data) >= 1:
                        try:
                            timestamp = float(value_data[0])
                            alert_time = datetime.fromtimestamp(timestamp)
                        except Exception:
                            alert_time = datetime.now()
                    else:
                        alert_time = datetime.now()
                    annotations = metric.get('annotations', {}) if 'annotations' in metric else {}
                    summary_text = annotations.get('summary', f'{alertname} alert')
                    description_text = annotations.get('description', f'Alert {alertname}')
                    severity = metric.get('severity', 'Moderate')
                    alert_dict = {
                        'ruleName': alertname,
                        'severity': severity,
                        'summary': summary_text,
                        'description': description_text,
                        'podName': pod,
                        'namespace': namespace,
                        'metric': alertname.lower(),
                        'value': value_data[1] if len(value_data) > 1 else '1.0',
                        'threshold': '0.0',
                        'operator': '>' if alertstate == 'firing' else '<=',
                        'status': 'Active' if alertstate == 'firing' else 'Resolved',
                        'timestamp': alert_time.isoformat(),
                    }
                    alert_dicts.append(alert_dict)
                db = SessionLocal()
                try:
                    save_alerts_to_db(db, alert_dicts)
                    print(f"[APScheduler] Saved {len(alert_dicts)} alerts to DB.")
                finally:
                    db.close()
    except Exception as e:
        print(f"[APScheduler] Error fetching/saving alerts: {e}")

scheduler.add_job(fetch_and_save_alerts, 'interval', minutes=5, id='fetch_and_save_alerts')
scheduler.start()
