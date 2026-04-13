import psycopg2
import logging
from flask import Blueprint, jsonify, request, Response
from datetime import datetime

logger = logging.getLogger(__name__)

alerts_bp = Blueprint('alerts', __name__)

DB_CONFIG = dict(dbname="alerts", user="alertuser", password="alertpass", host="localhost", port="5432")

def _severity_label(raw: str) -> str:
    """Map DB severity to UI severity."""
    mapping = {'critical': 'Critical', 'warning': 'Moderate', 'info': 'Low'}
    return mapping.get((raw or '').lower(), raw or 'Low')

def _status_label(raw: str) -> str:
    """Map DB status to UI status."""
    mapping = {'active': 'Active', 'firing': 'Active', 'acknowledged': 'Active', 'resolved': 'Resolved'}
    return mapping.get((raw or '').lower(), raw or 'Active')


@alerts_bp.route('/api/alerts', methods=['GET'])
def get_alerts_from_db():
    """
    Query alerts from alert_summaries table joined with testbeds.
    Falls back to the legacy alerts table if alert_summaries is empty.
    """
    try:
        severity_filter = request.args.get('severity_filter', request.args.get('severity', '')).strip()
        status_filter = request.args.get('status_filter', request.args.get('status', '')).strip()
        testbed_filter = request.args.get('testbed_filter', request.args.get('testbed', '')).strip()
        date_filter = request.args.get('date', '').strip()

        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()

        base_query = """
            SELECT a.id, a.alert_type, a.severity, a.status, a.message,
                   a.metric_value, a.threshold_value, a.created_at,
                   a.acknowledged_at, a.resolved_at,
                   t.testbed_label, t.pc_ip, a.testbed_id,
                   a.duration_minutes, a.diagnostic_context, a.resolved_reason
            FROM alert_summaries a
            LEFT JOIN testbeds t ON a.testbed_id = t.unique_testbed_id
        """
        where_conditions = []
        params = []

        if date_filter:
            try:
                if '/' in date_filter:
                    fmt = '%m/%d/%y' if len(date_filter.split('/')[-1]) == 2 else '%m/%d/%Y'
                    parsed_date = datetime.strptime(date_filter, fmt)
                else:
                    parsed_date = datetime.strptime(date_filter, '%Y-%m-%d')
                where_conditions.append("a.created_at::date = %s")
                params.append(parsed_date.date())
            except ValueError:
                pass

        if severity_filter and severity_filter.lower() != 'all':
            sev_map = {'critical': 'critical', 'moderate': 'warning', 'low': 'info'}
            db_sev = sev_map.get(severity_filter.lower(), severity_filter.lower())
            where_conditions.append("LOWER(a.severity) = %s")
            params.append(db_sev)

        if status_filter and status_filter.lower() != 'all':
            if status_filter.lower() == 'active':
                where_conditions.append("LOWER(a.status) IN ('active', 'firing', 'acknowledged')")
            elif status_filter.lower() == 'resolved':
                where_conditions.append("LOWER(a.status) = 'resolved'")

        if testbed_filter and testbed_filter.lower() != 'all':
            where_conditions.append("(t.testbed_label ILIKE %s OR t.pc_ip = %s)")
            params.extend([f'%{testbed_filter}%', testbed_filter])

        query = base_query
        if where_conditions:
            query += " WHERE " + " AND ".join(where_conditions)
        query += " ORDER BY a.created_at DESC"

        cur.execute(query, params)
        rows = cur.fetchall()

        from services.alert_diagnostic_service import generate_short_diagnosis, is_actionable

        alert_dicts = []
        for row in rows:
            testbed_label = row[10] or row[11] or 'Unknown'
            alert_type = row[1] or 'Unknown'
            severity = _severity_label(row[2])
            status = _status_label(row[3])
            metric_val = row[5]
            threshold_val = row[6]
            dur_min = row[13]

            description = row[4] or ''
            if metric_val is not None and threshold_val is not None:
                description += f" (value: {metric_val:.1f}, threshold: {threshold_val:.1f})"

            short_diag = generate_short_diagnosis(
                alert_type, metric_val, threshold_val, dur_min, row[3] or '')
            actionable = is_actionable(
                alert_type, severity, status, metric_val, threshold_val)

            diag_ctx = row[14] or {}
            if isinstance(diag_ctx, str):
                import json as _json
                try:
                    diag_ctx = _json.loads(diag_ctx)
                except Exception:
                    diag_ctx = {}

            alert_dicts.append({
                'id': row[0],
                'ruleName': alert_type,
                'severity': severity,
                'status': status,
                'summary': row[4] or '',
                'description': description,
                'timestamp': row[7].isoformat() + 'Z' if row[7] else None,
                'testbed': testbed_label,
                'testbed_id': row[12] or '',
                'metric_value': metric_val,
                'threshold_value': threshold_val,
                'acknowledged_at': row[8].isoformat() + 'Z' if row[8] else None,
                'resolved_at': row[9].isoformat() + 'Z' if row[9] else None,
                'duration_minutes': dur_min,
                'short_diagnosis': short_diag,
                'is_actionable': actionable,
                'resolved_reason': row[15],
                'diagnostic_context': diag_ctx,
            })

        cur.close()
        conn.close()

        if not alert_dicts:
            logger.info("alert_summaries returned 0 rows, trying legacy alerts table")
            return _get_alerts_legacy(severity_filter, status_filter, testbed_filter, date_filter)

        return jsonify({'alerts': alert_dicts, 'count': len(alert_dicts)})
    except Exception as e:
        logger.exception("Error querying alert_summaries")
        return _get_alerts_legacy(
            request.args.get('severity', ''),
            request.args.get('status', ''),
            request.args.get('testbed', ''),
            request.args.get('date', '')
        )


def _get_alerts_legacy(severity_filter, status_filter, testbed_filter, date_filter):
    """Fallback: query the old alerts table."""
    import re
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute("SELECT id, alertname, severity, status, summary, description, timestamp FROM alerts ORDER BY timestamp DESC")
        rows = cur.fetchall()
        alert_dicts = []
        for row in rows:
            summary = row[4] or ''
            testbed = ""
            for line in summary.splitlines():
                if line.strip().startswith("Testbed:"):
                    testbed = line.split("Testbed:", 1)[1].strip()
                    break
            if not testbed:
                match = re.search(r'with label ([\w\-]+)', summary)
                if match:
                    testbed = match.group(1)
            if not testbed:
                testbed = 'Unknown'

            alert_dicts.append({
                'id': row[0], 'ruleName': row[1], 'severity': row[2],
                'status': row[3], 'summary': summary, 'description': row[5],
                'timestamp': row[6].isoformat() + 'Z' if row[6] else None,
                'testbed': testbed,
            })
        cur.close()
        conn.close()
        return jsonify({'alerts': alert_dicts, 'count': len(alert_dicts)})
    except Exception as e:
        logger.exception("Legacy alerts fallback failed")
        return jsonify({'alerts': [], 'count': 0, 'error': str(e)}), 500


@alerts_bp.route('/api/alerts/detail/<int:alert_id>', methods=['GET'])
def get_alert_detail(alert_id):
    """
    Return rich diagnostic context for a single alert, including:
    - timeline, root cause, impact assessment, recommendation
    - related alerts, running executions, live Prometheus data
    """
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute("""
            SELECT a.id, a.alert_type, a.severity, a.status, a.message,
                   a.metric_value, a.threshold_value, a.created_at,
                   a.acknowledged_at, a.resolved_at, a.testbed_id,
                   a.duration_minutes, a.diagnostic_context, a.resolved_reason,
                   t.testbed_label, t.pc_ip, t.ncm_ip, t.testbed_json
            FROM alert_summaries a
            LEFT JOIN testbeds t ON a.testbed_id = t.unique_testbed_id
            WHERE a.id = %s
        """, (alert_id,))
        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            return jsonify({'error': 'Alert not found'}), 404

        import json as _json
        testbed_json = row[17]
        if isinstance(testbed_json, str):
            try:
                testbed_json = _json.loads(testbed_json)
            except Exception:
                testbed_json = {}
        elif not testbed_json:
            testbed_json = {}

        prom_url = testbed_json.get('prometheus_endpoint')
        if not prom_url and row[16]:
            port = testbed_json.get('prometheus_port', 31943)
            prom_url = f"https://{row[16]}:{port}"

        if prom_url:
            try:
                from services.prometheus_url import resolve_working_prometheus_url
                prom_url = resolve_working_prometheus_url(prom_url)
            except Exception:
                pass

        alert_dict = {
            'id': row[0], 'alert_type': row[1], 'severity': row[2],
            'status': row[3], 'message': row[4], 'metric_value': row[5],
            'threshold_value': row[6],
            'created_at': row[7].isoformat() + 'Z' if row[7] else None,
            'acknowledged_at': row[8].isoformat() + 'Z' if row[8] else None,
            'resolved_at': row[9].isoformat() + 'Z' if row[9] else None,
            'testbed_id': row[10], 'duration_minutes': row[11],
            'diagnostic_context': row[12] or {},
            'resolved_reason': row[13],
            'testbed_label': row[14] or row[15] or 'Unknown',
        }

        from services.alert_diagnostic_service import AlertDiagnosticService
        svc = AlertDiagnosticService(prom_url=prom_url)
        diagnostics = svc.diagnose(alert_dict)

        return jsonify({
            'alert': {
                **alert_dict,
                'severity_label': _severity_label(alert_dict['severity']),
                'status_label': _status_label(alert_dict['status']),
            },
            'diagnostics': diagnostics,
        })
    except Exception as e:
        logger.exception(f"Error fetching alert detail for id={alert_id}")
        return jsonify({'error': str(e)}), 500


@alerts_bp.route('/api/alerts/download-html', methods=['GET'])
def download_alert_html():
    """Generate and return a downloadable HTML alert summary report with diagnostics."""
    try:
        testbed_filter = request.args.get('testbed', '').strip()
        severity_filter = request.args.get('severity', '').strip()
        status_filter = request.args.get('status', '').strip()
        date_filter = request.args.get('date', '').strip()

        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()

        query = """
            SELECT a.id, a.alert_type, a.severity, a.status, a.message,
                   a.metric_value, a.threshold_value, a.created_at,
                   a.acknowledged_at, a.resolved_at,
                   t.testbed_label, t.pc_ip,
                   a.duration_minutes, a.diagnostic_context, a.resolved_reason
            FROM alert_summaries a
            LEFT JOIN testbeds t ON a.testbed_id = t.unique_testbed_id
        """
        where_conds, params = [], []
        if testbed_filter and testbed_filter.lower() != 'all':
            where_conds.append("(t.testbed_label ILIKE %s OR t.pc_ip = %s)")
            params.extend([f'%{testbed_filter}%', testbed_filter])
        if severity_filter and severity_filter.lower() != 'all':
            sev_map = {'critical': 'critical', 'moderate': 'warning', 'low': 'info'}
            where_conds.append("LOWER(a.severity) = %s")
            params.append(sev_map.get(severity_filter.lower(), severity_filter.lower()))
        if status_filter and status_filter.lower() != 'all':
            if status_filter.lower() == 'active':
                where_conds.append("LOWER(a.status) IN ('active', 'firing', 'acknowledged')")
            elif status_filter.lower() == 'resolved':
                where_conds.append("LOWER(a.status) = 'resolved'")
        if date_filter:
            try:
                if '/' in date_filter:
                    fmt = '%m/%d/%y' if len(date_filter.split('/')[-1]) == 2 else '%m/%d/%Y'
                    pd = datetime.strptime(date_filter, fmt)
                else:
                    pd = datetime.strptime(date_filter, '%Y-%m-%d')
                where_conds.append("a.created_at::date = %s")
                params.append(pd.date())
            except ValueError:
                pass

        if where_conds:
            query += " WHERE " + " AND ".join(where_conds)
        query += " ORDER BY a.created_at DESC"

        cur.execute(query, params)
        rows = cur.fetchall()
        cur.close()
        conn.close()

        from services.alert_diagnostic_service import generate_short_diagnosis, is_actionable as _is_actionable

        alerts = []
        for row in rows:
            sev = _severity_label(row[2])
            sts = _status_label(row[3])
            dur = row[12]
            diag = generate_short_diagnosis(row[1] or '', row[5], row[6], dur, row[3] or '')
            actionable = _is_actionable(row[1] or '', sev, sts, row[5], row[6])
            alerts.append({
                'id': row[0], 'alert_type': row[1], 'severity': sev,
                'status': sts, 'message': row[4],
                'metric_value': row[5], 'threshold_value': row[6],
                'created_at': row[7], 'acknowledged_at': row[8], 'resolved_at': row[9],
                'testbed_label': row[10] or row[11] or 'Unknown', 'pc_ip': row[11] or '',
                'duration_minutes': dur, 'resolved_reason': row[14],
                'short_diagnosis': diag, 'is_actionable': actionable,
            })

        total = len(alerts)
        critical = sum(1 for a in alerts if a['severity'] == 'Critical')
        moderate = sum(1 for a in alerts if a['severity'] == 'Moderate')
        low = sum(1 for a in alerts if a['severity'] == 'Low')
        active = sum(1 for a in alerts if a['status'] == 'Active')
        resolved = sum(1 for a in alerts if a['status'] == 'Resolved')
        needs_investigation = [a for a in alerts if a['is_actionable']]

        testbed_groups = {}
        for a in alerts:
            tb = a['testbed_label']
            testbed_groups.setdefault(tb, []).append(a)

        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        filter_desc = []
        if testbed_filter and testbed_filter.lower() != 'all':
            filter_desc.append(f"Testbed: {testbed_filter}")
        if severity_filter and severity_filter.lower() != 'all':
            filter_desc.append(f"Severity: {severity_filter}")
        if status_filter and status_filter.lower() != 'all':
            filter_desc.append(f"Status: {status_filter}")
        if date_filter:
            filter_desc.append(f"Date: {date_filter}")
        filter_text = ' | '.join(filter_desc) if filter_desc else 'All Alerts'

        sev_colors = {'Critical': '#dc3545', 'Moderate': '#fd7e14', 'Low': '#28a745'}
        status_colors = {'Active': '#dc3545', 'Resolved': '#28a745'}

        def _badge(text, color):
            return f'<span style="display:inline-block;padding:3px 10px;border-radius:4px;color:#fff;font-size:12px;font-weight:600;background:{color}">{text}</span>'

        def _format_dur(minutes):
            if minutes is None:
                return '<span style="color:#dc3545;font-weight:600">Active</span>'
            m = abs(minutes)
            if m < 1:
                return f"{int(m * 60)}s"
            if m < 60:
                return f"{int(m)}m"
            h = int(m // 60)
            rm = int(m % 60)
            if h < 24:
                return f"{h}h {rm}m" if rm else f"{h}h"
            d = h // 24
            rh = h % 24
            return f"{d}d {rh}h"

        # Needs Investigation section
        investigation_html = ""
        if needs_investigation:
            inv_rows = ""
            for a in needs_investigation:
                ts = a['created_at'].strftime('%Y-%m-%d %H:%M') if a['created_at'] else 'N/A'
                inv_rows += f"""<tr style="background:#fff5f5">
                    <td style="padding:10px;border-bottom:1px solid #f5c6cb">{a['testbed_label']}</td>
                    <td style="padding:10px;border-bottom:1px solid #f5c6cb">{ts}</td>
                    <td style="padding:10px;border-bottom:1px solid #f5c6cb">{a['alert_type']}</td>
                    <td style="padding:10px;border-bottom:1px solid #f5c6cb">{_badge(a['severity'], sev_colors.get(a['severity'], '#6c757d'))}</td>
                    <td style="padding:10px;border-bottom:1px solid #f5c6cb">{_format_dur(a['duration_minutes'])}</td>
                    <td style="padding:10px;border-bottom:1px solid #f5c6cb;max-width:400px">{a['short_diagnosis']}</td>
                </tr>"""
            investigation_html = f"""
            <div style="margin-bottom:30px;border:2px solid #dc3545;border-radius:8px;overflow:hidden">
                <div style="background:#dc3545;color:#fff;padding:12px 20px;font-size:16px;font-weight:700">
                    &#9888; Needs Investigation ({len(needs_investigation)} alerts)
                </div>
                <div style="padding:0">
                    <table style="width:100%;border-collapse:collapse;font-size:13px">
                        <thead>
                            <tr style="background:#f8d7da">
                                <th style="padding:10px;text-align:left;font-weight:600">Testbed</th>
                                <th style="padding:10px;text-align:left;font-weight:600">Time</th>
                                <th style="padding:10px;text-align:left;font-weight:600">Alert Type</th>
                                <th style="padding:10px;text-align:left;font-weight:600">Severity</th>
                                <th style="padding:10px;text-align:left;font-weight:600">Duration</th>
                                <th style="padding:10px;text-align:left;font-weight:600">Diagnosis</th>
                            </tr>
                        </thead>
                        <tbody>{inv_rows}</tbody>
                    </table>
                </div>
            </div>"""

        testbed_sections = ""
        for tb_name, tb_alerts in testbed_groups.items():
            tb_critical = sum(1 for a in tb_alerts if a['severity'] == 'Critical')
            tb_active = sum(1 for a in tb_alerts if a['status'] == 'Active')
            tb_resolved = sum(1 for a in tb_alerts if a['status'] == 'Resolved')

            rows_html = ""
            for a in tb_alerts:
                ts = a['created_at'].strftime('%Y-%m-%d %H:%M') if a['created_at'] else 'N/A'
                row_bg = 'background:#fff5f5;' if a['is_actionable'] else ''
                border_left = 'border-left:3px solid #dc3545;' if a['is_actionable'] else ''
                rows_html += f"""<tr style="{row_bg}">
                    <td style="padding:10px;border-bottom:1px solid #eee;{border_left}">{ts}</td>
                    <td style="padding:10px;border-bottom:1px solid #eee">{a['alert_type']}</td>
                    <td style="padding:10px;border-bottom:1px solid #eee">{_badge(a['severity'], sev_colors.get(a['severity'], '#6c757d'))}</td>
                    <td style="padding:10px;border-bottom:1px solid #eee">{_badge(a['status'], status_colors.get(a['status'], '#6c757d'))}</td>
                    <td style="padding:10px;border-bottom:1px solid #eee;white-space:nowrap">{_format_dur(a['duration_minutes'])}</td>
                    <td style="padding:10px;border-bottom:1px solid #eee">{f"{a['metric_value']:.1f}" if a['metric_value'] is not None else 'N/A'}</td>
                    <td style="padding:10px;border-bottom:1px solid #eee">{f"{a['threshold_value']:.1f}" if a['threshold_value'] is not None else 'N/A'}</td>
                    <td style="padding:10px;border-bottom:1px solid #eee;max-width:350px;font-size:12px;color:#495057">{a['short_diagnosis']}</td>
                </tr>"""

            testbed_sections += f"""
            <div style="margin-bottom:30px">
                <h3 style="color:#333;border-bottom:2px solid #0078d4;padding-bottom:8px;margin-bottom:4px">
                    {tb_name}
                    <span style="font-size:14px;color:#666;font-weight:400;margin-left:12px">
                        {len(tb_alerts)} alerts | {tb_critical} critical | {tb_active} active | {tb_resolved} resolved
                    </span>
                </h3>
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                    <thead>
                        <tr style="background:#f1f3f5">
                            <th style="padding:10px;text-align:left;font-weight:600;border-bottom:2px solid #dee2e6">Time</th>
                            <th style="padding:10px;text-align:left;font-weight:600;border-bottom:2px solid #dee2e6">Alert Type</th>
                            <th style="padding:10px;text-align:left;font-weight:600;border-bottom:2px solid #dee2e6">Severity</th>
                            <th style="padding:10px;text-align:left;font-weight:600;border-bottom:2px solid #dee2e6">Status</th>
                            <th style="padding:10px;text-align:left;font-weight:600;border-bottom:2px solid #dee2e6">Duration</th>
                            <th style="padding:10px;text-align:left;font-weight:600;border-bottom:2px solid #dee2e6">Value</th>
                            <th style="padding:10px;text-align:left;font-weight:600;border-bottom:2px solid #dee2e6">Threshold</th>
                            <th style="padding:10px;text-align:left;font-weight:600;border-bottom:2px solid #dee2e6">Diagnosis</th>
                        </tr>
                    </thead>
                    <tbody>{rows_html}</tbody>
                </table>
            </div>"""

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Alert Summary Report - {now}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin:0; padding:20px; background:#f8f9fa; color:#333; }}
  .container {{ max-width:1400px; margin:0 auto; background:#fff; border-radius:12px; box-shadow:0 2px 12px rgba(0,0,0,0.08); overflow:hidden; }}
  .header {{ background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); color:#fff; padding:32px 40px; }}
  .header h1 {{ margin:0 0 8px 0; font-size:28px; }}
  .header p {{ margin:0; opacity:0.9; font-size:14px; }}
  .summary {{ display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:16px; padding:24px 40px; background:#f8f9fa; border-bottom:1px solid #dee2e6; }}
  .stat {{ text-align:center; padding:16px; background:#fff; border-radius:8px; box-shadow:0 1px 4px rgba(0,0,0,0.06); }}
  .stat .number {{ font-size:32px; font-weight:700; }}
  .stat .label {{ font-size:12px; color:#666; margin-top:4px; text-transform:uppercase; letter-spacing:0.5px; }}
  .content {{ padding:24px 40px 40px; }}
  .filter-info {{ padding:8px 16px; background:#e8f4fd; border-radius:6px; font-size:13px; color:#0c5460; margin-bottom:24px; }}
  @media print {{ body {{ background:#fff; padding:0; }} .container {{ box-shadow:none; }} }}
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>Alert Summary Report</h1>
        <p>Generated: {now} | {filter_text}</p>
    </div>
    <div class="summary">
        <div class="stat"><div class="number" style="color:#0078d4">{total}</div><div class="label">Total Alerts</div></div>
        <div class="stat"><div class="number" style="color:#dc3545">{critical}</div><div class="label">Critical</div></div>
        <div class="stat"><div class="number" style="color:#fd7e14">{moderate}</div><div class="label">Moderate</div></div>
        <div class="stat"><div class="number" style="color:#28a745">{low}</div><div class="label">Low</div></div>
        <div class="stat"><div class="number" style="color:#dc3545">{active}</div><div class="label">Active</div></div>
        <div class="stat"><div class="number" style="color:#28a745">{resolved}</div><div class="label">Resolved</div></div>
        <div class="stat"><div class="number" style="color:#dc3545">{len(needs_investigation)}</div><div class="label">Needs Investigation</div></div>
    </div>
    <div class="content">
        <div class="filter-info">Filters: {filter_text} | Testbeds: {len(testbed_groups)} | Total Alerts: {total}</div>
        {investigation_html}
        {testbed_sections}
    </div>
</div>
</body>
</html>"""

        filename = f"alert-summary-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        if testbed_filter and testbed_filter.lower() != 'all':
            filename += f"-{testbed_filter}"
        filename += ".html"

        return Response(
            html,
            mimetype='text/html',
            headers={'Content-Disposition': f'attachment; filename="{filename}"'}
        )
    except Exception as e:
        logger.exception("Error generating HTML alert report")
        return jsonify({'error': str(e)}), 500


def get_filtered_alerts(session, filters: dict = None, start_date=None, end_date=None,
                       severity_filter=None, status_filter=None, testbed_filter=None) -> dict:
    """
    Get filtered alerts for email reports (non-route function for internal use).
    Queries alert_summaries joined with testbeds.
    """
    try:
        if filters is None:
            filters = {
                'severity_filter': severity_filter,
                'status_filter': status_filter,
                'testbed_filter': testbed_filter
            }

        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()

        where_conditions = []
        params = []

        if start_date and end_date:
            where_conditions.append("a.created_at BETWEEN %s AND %s")
            params.extend([start_date, end_date])

        if filters.get('severity_filter') and filters['severity_filter'] != 'All':
            sev_map = {'critical': 'critical', 'moderate': 'warning', 'low': 'info'}
            db_sev = sev_map.get(filters['severity_filter'].lower())
            if db_sev:
                where_conditions.append("LOWER(a.severity) = %s")
                params.append(db_sev)

        if filters.get('status_filter') and filters['status_filter'] != 'All':
            if filters['status_filter'].lower() in ('active', 'firing'):
                where_conditions.append("LOWER(a.status) IN ('active', 'firing', 'acknowledged')")
            elif filters['status_filter'].lower() == 'resolved':
                where_conditions.append("LOWER(a.status) = 'resolved'")

        if filters.get('testbed_filter') and filters['testbed_filter'] != 'All':
            where_conditions.append("(t.testbed_label ILIKE %s OR t.pc_ip = %s)")
            params.extend([f"%{filters['testbed_filter']}%", filters['testbed_filter']])

        base_query = """
            SELECT a.id, a.alert_type, a.severity, a.status, a.message,
                   a.metric_value, a.threshold_value, a.created_at,
                   a.acknowledged_at, a.resolved_at,
                   t.testbed_label, t.pc_ip
            FROM alert_summaries a
            LEFT JOIN testbeds t ON a.testbed_id = t.unique_testbed_id
        """
        if where_conditions:
            base_query += " WHERE " + " AND ".join(where_conditions)
        base_query += " ORDER BY a.created_at DESC"

        cur.execute(base_query, params)
        rows = cur.fetchall()

        alert_dicts = []
        for row in rows:
            alert_dicts.append({
                'id': row[0],
                'ruleName': row[1] or 'Unknown',
                'severity': _severity_label(row[2]),
                'status': _status_label(row[3]),
                'summary': row[4] or '',
                'description': row[4] or '',
                'timestamp': row[7].isoformat() + 'Z' if row[7] else None,
                'testbed': row[10] or row[11] or 'Unknown',
            })

        cur.close()
        conn.close()

        total_alerts = len(alert_dicts)
        critical_count = sum(1 for a in alert_dicts if a['severity'] == 'Critical')
        moderate_count = sum(1 for a in alert_dicts if a['severity'] == 'Moderate')
        low_count = sum(1 for a in alert_dicts if a['severity'] == 'Low')

        return {
            'alerts': alert_dicts,
            'total_alerts': total_alerts,
            'critical': critical_count,
            'moderate': moderate_count,
            'low': low_count
        }

    except Exception as e:
        logger.exception("Error getting filtered alerts")
        return {'alerts': [], 'total_alerts': 0, 'critical': 0, 'moderate': 0, 'low': 0}


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
