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
from typing import Dict, Tuple

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
          "settings": { "notify_email": true, ... },     # optional, free-form
          "slack_channel_override": "#qa-temp",          # optional Phase 3
          "schedule": {"start_at": "...", "repeat": "..."}  # optional Phase 4
        }
    """
    data = request.get_json(silent=True) or {}
    testbed_id = data.get('testbed_id')
    monitoring_rules = data.get('monitoring_rules') or []
    if not testbed_id:
        return jsonify({'success': False, 'error': 'testbed_id required'}), 400
    # monitoring_rules is optional — empty list means "just collect metrics
    # (restarts/OOMs/throttling/health) with no user-defined alert thresholds".
    if not isinstance(monitoring_rules, list):
        return jsonify({'success': False, 'error': 'monitoring_rules must be a list'}), 400

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
        slack_channel_override=(data.get('slack_channel_override') or '').strip() or None,
        schedule=data.get('schedule'),
    )
    return jsonify(res), (200 if res.get('success') else 400)


@monitor_only_bp.route('/api/monitor-only/snapshot', methods=['POST'])
def snapshot():
    """One-shot cluster_health snapshot for a testbed (no session created).

    Body: ``{"testbed_id": "..."}`` — returns the same ``cluster_health``
    payload an enhanced report would carry, useful for ad-hoc inspection.
    """
    data = request.get_json(silent=True) or {}
    testbed_id = data.get('testbed_id')
    if not testbed_id:
        return jsonify({'success': False, 'error': 'testbed_id required'}), 400
    res = svc.snapshot_testbed(testbed_id)
    return jsonify(res), (200 if res.get('success') else 400)


@monitor_only_bp.route('/api/monitor-only/test-rule', methods=['POST'])
def test_rule():
    """Evaluate a single rule against a testbed's Prometheus right now.

    Body: ``{"testbed_id": "...", "rule": {...}}`` — returns
    ``{fired, violation_count, violations}`` so the rule editor can show a
    "would fire (3 pods)" / "did not fire" preview.
    """
    data = request.get_json(silent=True) or {}
    testbed_id = data.get('testbed_id')
    rule = data.get('rule') or {}
    if not testbed_id:
        return jsonify({'success': False, 'error': 'testbed_id required'}), 400
    if not isinstance(rule, dict) or not rule:
        return jsonify({'success': False, 'error': 'rule must be a non-empty object'}), 400
    res = svc.test_rule(testbed_id, rule)
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
    try:
        offset = int(request.args.get('offset') or 0)
    except (ValueError, TypeError):
        offset = 0
    # Clamp to a sane range so a tester pasting a giant limit can't OOM the API
    limit = max(1, min(500, limit))
    offset = max(0, offset)
    # Phase-1: switched to the slim+enriched summary so the Sessions page
    # gets human-readable testbed names, alert counts and elapsed/remaining
    # times in a single round trip (and so we stop shipping ~MB of
    # baseline_health / cluster_health_snapshot JSON per row).
    # ``?full=1`` opts back into the legacy fat shape for debug callers.
    want_full = (request.args.get('full') or '').strip().lower() in ('1', 'true', 'yes')
    if want_full:
        result = svc.list_monitors(testbed_id=testbed_id, status=status, limit=limit, offset=offset)
    else:
        result = svc.list_monitors_summary(testbed_id=testbed_id, status=status, limit=limit, offset=offset)
    return jsonify({
        'success': True,
        'monitors': result['rows'],
        'count': len(result['rows']),
        'total': result['total'],
        'limit': result['limit'],
        'offset': result['offset'],
    })


@monitor_only_bp.route('/api/monitor-only/<monitor_id>', methods=['DELETE'])
def delete(monitor_id: str):
    """Delete a non-running monitor session row."""
    res = svc.delete_monitor(monitor_id)
    return jsonify(res), (200 if res.get('success') else 400)


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


# ── In-process TTL caches for the report endpoints ──────────────────────
# Both /report (JSON) and /report.html are bottlenecked by the same
# ``report_svc.build_report`` call which re-pulls pod/cluster snapshots
# from Prometheus (30-60s for a 24h monitor). For STOPPED / FAILED
# monitors the underlying data is immutable so we cache the result for
# 1h. For live monitors the cache is short (10s) — long enough to
# absorb tab-switch / iframe-reload bursts but short enough that the
# user always sees fresh poll data on Refresh. Bypassed via ``?nocache=1``.
_REPORT_HTML_CACHE: Dict[str, Tuple[float, str, str]] = {}  # mid → (expiry_ts, status, html)
_REPORT_JSON_CACHE: Dict[str, Tuple[float, str, dict]] = {}  # mid → (expiry_ts, status, rep)


def _cache_ttl_for(status: str) -> float:
    s = (status or '').upper()
    if s in ('RUNNING', 'STARTING', 'DEGRADED'):
        return 10.0
    return 3600.0  # 1h for terminal states


def _build_report_cached(monitor_id: str, nocache: bool = False):
    """Shared cache wrapper around ``report_svc.build_report`` used by both
    the JSON and HTML routes. Returns ``None`` if the monitor doesn't
    exist."""
    import time as _time
    now = _time.time()
    if not nocache:
        cached = _REPORT_JSON_CACHE.get(monitor_id)
        if cached and now < cached[0]:
            return cached[2]
    rep = report_svc.build_report(monitor_id)
    if not rep:
        return None
    status = ((rep.get('overview') or {}).get('status')) or ''
    _REPORT_JSON_CACHE[monitor_id] = (now + _cache_ttl_for(status), status, rep)
    # Phase-B shadow compare: when serving a freshly-built live report, kick a
    # background parity check against the stored snapshot so we accumulate
    # evidence the snapshot matches BEFORE Phase C flips reads to it. Never
    # blocks the response, never raises into the request path.
    if _shadow_enabled():
        _spawn_shadow_compare(monitor_id, rep, status)
    return rep


# ── Phase-B dual-read + shadow-compare plumbing ─────────────────────────
# Read source resolution lets us A/B the new snapshot read path WITHOUT
# changing the default (which stays "live" until Phase C). Per-request
# override via ?source=, global default via env NMT_REPORT_DEFAULT_SOURCE.
_TERMINAL_STATES = {'STOPPED', 'COMPLETED', 'FAILED', 'CANCELLED'}


def _default_source() -> str:
    # Phase-C cutover: default to "auto" — serve the fast materialised snapshot
    # for terminal/fresh monitors, fall back to live otherwise. Override with
    # NMT_REPORT_DEFAULT_SOURCE=live to revert to the old always-live behaviour.
    import os
    s = (os.environ.get('NMT_REPORT_DEFAULT_SOURCE') or 'auto').lower()
    return s if s in ('live', 'snapshot', 'auto') else 'auto'


def _shadow_enabled() -> bool:
    import os
    return (os.environ.get('NMT_REPORT_SHADOW', 'on').lower()
            in ('on', '1', 'true', 'yes'))


def _resolve_source(req) -> str:
    s = (req.args.get('source') or '').lower()
    if s in ('live', 'snapshot', 'auto'):
        return s
    return _default_source()


def _snapshot_servable(snap_row: dict, *, source: str) -> bool:
    """Decide whether a stored snapshot may be served for this request.

    ``snapshot`` → always serve if present.
    ``auto``     → serve if the monitor is terminal, or the snapshot is fresh
                   (younger than the staleness budget). Running + stale falls
                   back to live so the user never sees badly-outdated data.
    """
    if not snap_row:
        return False
    if source == 'snapshot':
        return True
    # auto
    payload = snap_row.get('payload') or {}
    status = ((payload.get('overview') or {}).get('status') or '').upper()
    if status in _TERMINAL_STATES:
        return True
    # running: freshness gate
    from datetime import datetime, timezone
    from services.report_snapshot_builder import STALE_AFTER_SECONDS
    gen = snap_row.get('generated_at')
    if not gen:
        return False
    try:
        gs = str(gen).rstrip('Z')
        gdt = datetime.fromisoformat(gs)
        if gdt.tzinfo is None:
            gdt = gdt.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - gdt).total_seconds()
        return age <= STALE_AFTER_SECONDS
    except Exception:
        return False


def _ensure_operational_quality(rep: dict) -> dict:
    """Stamp ``operational.data_quality`` + ``banner_text`` on a live-built
    report so a live (fallback) read shows the exact same banner a
    snapshot-served read would. Single source of truth = the builder's
    classifier; JSON, HTML and React all read these fields.
    """
    try:
        from services.report_snapshot_builder import classify_data_quality
        op = rep.get('operational')
        if not isinstance(op, dict):
            op = {}
            rep['operational'] = op
        if not op.get('data_quality'):
            q, banner = classify_data_quality(rep)
            op['data_quality'] = q
            op['banner_text'] = banner
    except Exception:  # noqa: BLE001 — banner is cosmetic, never break the read
        pass
    return rep


def _spawn_read_through_snapshot(monitor_id: str, live_rep: dict) -> None:
    """Persist a snapshot from a just-built live report so the NEXT read is
    O(1). Used when a snapshot/auto read had to fall back to live because the
    stored snapshot was missing or stale. Reuses ``live_rep`` (no rebuild);
    background daemon thread; never raises into the request.
    """
    import threading

    def _run():
        try:
            from services import report_snapshot_builder as snap_builder
            from services import report_snapshot_repo as snap_repo
            poll_count = int(((live_rep.get('overview') or {}).get('total_polls')) or 0)
            result = snap_builder.build_snapshot(live_rep, poll_count=poll_count)
            snap_repo.upsert_monitor_snapshot(monitor_id, result)
            logger.info("[read-through] %s snapshot persisted (quality=%s size=%dB)",
                        monitor_id, result.data_quality, result.size_bytes)
        except Exception as e:  # noqa: BLE001
            logger.debug("[read-through] %s failed: %s", monitor_id, e)

    threading.Thread(target=_run, name=f"read-through-{monitor_id}",
                     daemon=True).start()


def _get_report_for_read(monitor_id: str, source: str, nocache: bool):
    """Return ``(rep, served_source)`` honouring the resolved read source.

    Falls back to live whenever the snapshot is missing or not servable, so a
    snapshot/auto request can never 404 a monitor that actually exists. On
    fallback it also kicks a background read-through so the next read is fast.
    """
    if source in ('snapshot', 'auto') and not nocache:
        try:
            from services import report_snapshot_repo as snap_repo
            row = snap_repo.get_monitor_snapshot(monitor_id)
            if _snapshot_servable(row, source=source):
                return row['payload'], 'snapshot'
        except Exception as e:  # noqa: BLE001 — snapshot read must never break reads
            logger.warning("[%s] snapshot read failed, falling back to live: %s",
                           monitor_id, e)
    rep = _build_report_cached(monitor_id, nocache=nocache)
    if rep is None:
        return None, 'live'
    _ensure_operational_quality(rep)
    # Read-through refresh: the caller wanted a snapshot but we served live
    # (missing / stale / nocache). Persist a fresh one for next time.
    if source in ('snapshot', 'auto'):
        _spawn_read_through_snapshot(monitor_id, rep)
    return rep, 'live'


def _spawn_shadow_compare(monitor_id: str, live_rep: dict, status: str) -> None:
    """Background parity check: stored snapshot vs the just-built live report.

    Reuses the already-built ``live_rep`` (no rebuild), bounds it the same way
    the snapshot is, and logs a one-line parity verdict. Daemon thread so it
    never delays the HTTP response.
    """
    import threading

    def _run():
        try:
            from services import report_snapshot_repo as snap_repo
            from services import report_snapshot_builder as snap_builder
            from services import report_snapshot_parity as parity
            row = snap_repo.get_monitor_snapshot(monitor_id)
            if not row:
                return
            fresh = snap_builder.build_snapshot(live_rep)
            rpt = parity.compare_payloads(
                row.get('payload') or {}, fresh.payload,
                monitor_id=monitor_id, monitor_status=status,
                stored_generated_at=row.get('generated_at'),
                stored_size_bytes=row.get('size_bytes') or 0,
            )
            log = logger.warning if rpt.verdict == parity.P_MISMATCH else logger.info
            log("[shadow-parity] %s verdict=%s crit=%d drift=%d (%s)",
                monitor_id, rpt.verdict, rpt.critical_count, rpt.drift_count, rpt.note)
            if rpt.critical_count:
                for d in rpt.diffs:
                    if d.severity == parity.SEV_CRITICAL:
                        logger.warning("[shadow-parity]   %s: stored=%r live=%r (%s)",
                                       d.path, d.stored, d.live, d.note)
        except Exception as e:  # noqa: BLE001 — shadow must never surface
            logger.debug("[shadow-parity] %s failed: %s", monitor_id, e)

    threading.Thread(target=_run, name=f"shadow-parity-{monitor_id}",
                     daemon=True).start()


@monitor_only_bp.route('/api/monitor-only/<monitor_id>/report', methods=['GET'])
def report_json(monitor_id: str):
    """Full debug-friendly report payload (JSON). Powers the in-app tabbed
    report view; identical data is rendered into the HTML download below.

    Cached with the same TTL strategy as ``/report.html`` — see comment on
    ``_REPORT_JSON_CACHE`` above.
    """
    nocache = request.args.get('nocache') in ('1', 'true', 'yes')
    source = _resolve_source(request)
    rep, served = _get_report_for_read(monitor_id, source, nocache)
    if not rep:
        return jsonify({'success': False, 'error': 'Monitor not found'}), 404
    resp = jsonify({'success': True, 'report': rep})
    resp.headers['X-NMT-Cache'] = 'MISS' if nocache else 'HIT'
    resp.headers['X-NMT-Report-Source'] = served
    return resp


@monitor_only_bp.route('/api/monitor-only/<monitor_id>/report.html', methods=['GET'])
def report_html(monitor_id: str):
    """Standalone HTML — open in browser then print → PDF for archive.

    Backed by a tiny TTL cache so the embedded iframe + a follow-up
    "Open in new tab" / "HTML" download don't each pay the 60s rebuild
    cost. ``?nocache=1`` bypasses for debugging, and a 304-style
    ``?download=1`` query just toggles the content-disposition header.
    """
    import time as _time
    nocache = request.args.get('nocache') in ('1', 'true', 'yes')
    download = request.args.get('download') in ('1', 'true', 'yes')
    source = _resolve_source(request)

    now = _time.time()
    # HTML cache only applies to the live path; snapshot/auto serves are keyed
    # off the (already-cheap) stored row so we don't risk serving a live-built
    # HTML when the caller explicitly asked for the snapshot source.
    cached = _REPORT_HTML_CACHE.get(monitor_id)
    if cached and not nocache and source == 'live':
        expiry, _status, html = cached
        if now < expiry:
            resp = Response(html, mimetype='text/html')
            disp = 'attachment' if download else 'inline'
            resp.headers['Content-Disposition'] = f'{disp}; filename="monitor-{monitor_id}.html"'
            resp.headers['X-NMT-Cache'] = 'HIT'
            resp.headers['X-NMT-Report-Source'] = 'live'
            return resp

    rep, served = _get_report_for_read(monitor_id, source, nocache)
    if not rep:
        return Response('<h1>Monitor not found</h1>', status=404, mimetype='text/html')
    html = report_svc.render_html(rep)
    status = ((rep.get('overview') or {}).get('status')) or ''
    if served == 'live':
        _REPORT_HTML_CACHE[monitor_id] = (now + _cache_ttl_for(status), status, html)
    resp = Response(html, mimetype='text/html')
    disp = 'attachment' if download else 'inline'
    resp.headers['Content-Disposition'] = f'{disp}; filename="monitor-{monitor_id}.html"'
    resp.headers['X-NMT-Cache'] = 'MISS'
    resp.headers['X-NMT-Report-Source'] = served
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


@monitor_only_bp.route('/api/monitor-only/<monitor_id>/rebuild-snapshot', methods=['POST'])
def rebuild_snapshot(monitor_id: str):
    """Force-rebuild the Layer-2 materialised report snapshot for a monitor.

    Used by:
      * the admin "Rebuild report" action,
      * operators recovering a monitor whose poller died before it could
        write a final snapshot (e.g. backend restart orphaned it).

    Synchronous — computes build_report → build_snapshot → UPSERT and returns
    the status. Heavy (can take a few seconds if Prometheus is reachable and a
    live merge runs) so it's a POST, never on the hot read path.
    """
    from services.report_snapshot_repo import refresh_monitor_snapshot
    result = refresh_monitor_snapshot(monitor_id)
    if result is None:
        return jsonify({'success': False, 'error': 'Monitor not found'}), 404
    code = 200 if result.get('success') else 500
    return jsonify(result), code


@monitor_only_bp.route('/api/monitor-only/<monitor_id>/report/parity', methods=['GET'])
def report_parity(monitor_id: str):
    """Phase-B confidence gate: compare the stored snapshot to a fresh live
    build and return a structured, severity-tagged diff.

    Verdict is one of: match | drift_expected | mismatch | no_snapshot | error.
    ``match`` / ``drift_expected`` (with no criticals) means the snapshot is
    safe to serve — the green light for the Phase-C read cutover.
    """
    from services.report_snapshot_parity import validate_monitor, P_ERROR, P_NO_SNAPSHOT
    rpt = validate_monitor(monitor_id)
    code = 200
    if rpt.verdict == P_ERROR:
        code = 500
    elif rpt.verdict == P_NO_SNAPSHOT:
        code = 404
    return jsonify(rpt.to_dict()), code


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
