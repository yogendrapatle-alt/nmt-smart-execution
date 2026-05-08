"""
Monitor-Only Testbed Routes
===========================

Lightweight REST surface for the standalone Prometheus rule-watcher flow.

Endpoints (all under ``/api/monitor-only/``):

- ``POST   /start``               start a new monitor session
- ``POST   /stop/<monitor_id>``   stop a running monitor
- ``GET    /list``                list monitors (filter by ?testbed_id=&status=)
- ``GET    /<monitor_id>``        full monitor record + live counters
- ``GET    /<monitor_id>/violations``  recent violations (live + persisted)
"""

import logging

from flask import Blueprint, request, jsonify, Response

from services import monitor_only_service as svc
from services import monitor_only_report as report_svc

logger = logging.getLogger(__name__)

monitor_only_bp = Blueprint('monitor_only', __name__)


@monitor_only_bp.route('/api/monitor-only/start', methods=['POST'])
def start():
    """Start a new monitor-only session.

    Body::
        {
          "testbed_id": "...",
          "name": "Demo monitor",            # optional
          "description": "...",              # optional
          "monitoring_rules": [ {...}, ... ],
          "poll_interval_s": 30,             # optional (default 30s, clamped 10-600)
          "duration_hours": 2,               # optional, omit/0 = run until stopped
          "settings": { ... }                # optional, free-form
        }
    """
    data = request.get_json(silent=True) or {}
    testbed_id = data.get('testbed_id')
    monitoring_rules = data.get('monitoring_rules') or []
    if not testbed_id:
        return jsonify({'success': False, 'error': 'testbed_id required'}), 400
    if not isinstance(monitoring_rules, list) or not monitoring_rules:
        return jsonify({'success': False, 'error': 'monitoring_rules must be a non-empty list'}), 400

    duration_hours = data.get('duration_hours')
    try:
        duration_hours = float(duration_hours) if duration_hours not in (None, '', 0, '0') else None
    except (ValueError, TypeError):
        duration_hours = None

    res = svc.start_monitor(
        testbed_id=testbed_id,
        monitoring_rules=monitoring_rules,
        name=data.get('name'),
        description=data.get('description'),
        poll_interval_s=int(data.get('poll_interval_s') or svc.DEFAULT_POLL_INTERVAL_S),
        duration_hours=duration_hours,
        settings=data.get('settings') or {},
    )
    return jsonify(res), (200 if res.get('success') else 400)


@monitor_only_bp.route('/api/monitor-only/stop/<monitor_id>', methods=['POST'])
def stop(monitor_id: str):
    res = svc.stop_monitor(monitor_id)
    return jsonify(res), (200 if res.get('success') else 404)


@monitor_only_bp.route('/api/monitor-only/<monitor_id>/reload-rules', methods=['POST'])
def reload_rules(monitor_id: str):
    """Hot-swap a running monitor's rule list (no restart required)."""
    data = request.get_json(silent=True) or {}
    monitoring_rules = data.get('monitoring_rules') or []
    res = svc.reload_monitor_rules(monitor_id, monitoring_rules)
    return jsonify(res), (200 if res.get('success') else 400)


@monitor_only_bp.route('/api/monitor-only/list', methods=['GET'])
def list_all():
    testbed_id = request.args.get('testbed_id') or None
    status = request.args.get('status') or None
    try:
        limit = int(request.args.get('limit') or 100)
    except (ValueError, TypeError):
        limit = 100
    monitors = svc.list_monitors(testbed_id=testbed_id, status=status, limit=limit)
    return jsonify({'success': True, 'monitors': monitors, 'count': len(monitors)})


@monitor_only_bp.route('/api/monitor-only/<monitor_id>', methods=['GET'])
def get(monitor_id: str):
    rec = svc.get_monitor(monitor_id)
    if not rec:
        return jsonify({'success': False, 'error': 'Monitor not found'}), 404
    return jsonify({'success': True, 'monitor': rec})


@monitor_only_bp.route('/api/monitor-only/<monitor_id>/violations', methods=['GET'])
def violations(monitor_id: str):
    try:
        limit = int(request.args.get('limit') or 200)
    except (ValueError, TypeError):
        limit = 200
    rows = svc.get_violations(monitor_id, limit=limit)
    return jsonify({'success': True, 'violations': rows, 'count': len(rows)})


@monitor_only_bp.route('/api/monitor-only/<monitor_id>/report', methods=['GET'])
def report_json(monitor_id: str):
    """Full debug-friendly report payload (JSON). Powers the in-app tabbed
    report view; identical data is rendered into the HTML download below."""
    rep = report_svc.build_report(monitor_id)
    if not rep:
        return jsonify({'success': False, 'error': 'Monitor not found'}), 404
    return jsonify({'success': True, 'report': rep})


@monitor_only_bp.route('/api/monitor-only/<monitor_id>/report.html', methods=['GET'])
def report_html(monitor_id: str):
    """Standalone HTML — open in browser then print → PDF for archive."""
    rep = report_svc.build_report(monitor_id)
    if not rep:
        return Response('<h1>Monitor not found</h1>', status=404, mimetype='text/html')
    html = report_svc.render_html(rep)
    resp = Response(html, mimetype='text/html')
    resp.headers['Content-Disposition'] = f'inline; filename="monitor-{monitor_id}.html"'
    return resp


@monitor_only_bp.route('/api/monitor-only/<monitor_id>/report.json', methods=['GET'])
def report_download_json(monitor_id: str):
    """Same payload as ``/report`` but with a download disposition."""
    import json as _json
    rep = report_svc.build_report(monitor_id)
    if not rep:
        return jsonify({'success': False, 'error': 'Monitor not found'}), 404
    body = _json.dumps(rep, indent=2, default=str)
    resp = Response(body, mimetype='application/json')
    resp.headers['Content-Disposition'] = f'attachment; filename="monitor-{monitor_id}.json"'
    return resp


@monitor_only_bp.route('/api/monitor-only/<monitor_id>/log-bundles', methods=['GET'])
def log_bundles(monitor_id: str):
    """All log-collection bundles triggered by violations of this monitor."""
    from services import log_collection_service as lc
    bundles = lc.list_bundles(monitor_id=monitor_id, limit=200)
    return jsonify({'success': True, 'bundles': bundles, 'count': len(bundles)})


@monitor_only_bp.route('/api/monitor-only/log-bundles/<int:bundle_id>', methods=['GET'])
def log_bundle_detail(bundle_id: int):
    """Single bundle row (with stdout tail)."""
    from services import log_collection_service as lc
    b = lc.get_bundle(bundle_id)
    if not b:
        return jsonify({'success': False, 'error': 'Bundle not found'}), 404
    return jsonify({'success': True, 'bundle': b})


@monitor_only_bp.route('/api/monitor-only/<monitor_id>/violations.csv', methods=['GET'])
def violations_csv(monitor_id: str):
    """CSV export of all violations — handy for spreadsheet drilldowns."""
    import csv
    import io
    rep = report_svc.build_report(monitor_id)
    if not rep:
        return Response('Monitor not found', status=404)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(['timestamp', 'rule_name', 'severity', 'is_composite', 'logical_operator',
                'value', 'operator', 'threshold', 'iteration', 'message'])
    for v in rep['violations']:
        w.writerow([
            v.get('timestamp'), v.get('rule_name'), v.get('severity'),
            v.get('is_composite'), v.get('logical_operator'),
            v.get('value'), v.get('operator'), v.get('threshold'),
            v.get('iteration'), v.get('message'),
        ])
    resp = Response(buf.getvalue(), mimetype='text/csv')
    resp.headers['Content-Disposition'] = f'attachment; filename="monitor-{monitor_id}-violations.csv"'
    return resp
