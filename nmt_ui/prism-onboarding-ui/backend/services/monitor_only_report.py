"""
Monitor-Only Report Builder
===========================

Aggregates everything needed to debug a Monitor-Only session into a single,
self-contained report payload that's safe to render in the UI *and* to drop
into a static HTML file the user can email.

Sections produced (each a top-level key in the JSON payload):

- ``overview``        — verdict, durations, totals, configuration snapshot
- ``rules``           — every rule + per-rule fire/poll counts + last value
- ``violations``      — full list (live + persisted), normalised
- ``timeseries``      — captured cluster CPU/Mem aggregates
- ``correlation``     — overlay of violations onto the timeseries
- ``operational``     — last_poll_at, errors, prometheus reachability, etc.
- ``recommendations`` — heuristic suggestions ("rule X never fired", "cooldown clipped 80% of fires", …)

The HTML renderer in ``templates/monitor_only_report.html`` consumes the same
payload so the on-screen and downloadable views can never drift.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from services import monitor_only_service as svc

logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────

def _safe_iso(s: Any) -> Optional[str]:
    if s is None:
        return None
    if isinstance(s, str):
        return s
    try:
        return s.isoformat()
    except Exception:
        return str(s)


def _seconds_between(a: Optional[str], b: Optional[str]) -> Optional[float]:
    """Return ``b - a`` in seconds, parsing ISO strings if needed."""
    from datetime import datetime
    def _parse(x):
        if x is None:
            return None
        if isinstance(x, str):
            try:
                return datetime.fromisoformat(x.replace('Z', '+00:00')).replace(tzinfo=None)
            except ValueError:
                return None
        return x
    pa, pb = _parse(a), _parse(b)
    if pa is None or pb is None:
        return None
    return (pb - pa).total_seconds()


def _summarize_rule(rule: Dict[str, Any]) -> str:
    """Build a one-line human-readable rule summary."""
    if rule.get('conditions'):
        op = (rule.get('logical_operator') or rule.get('logicalOperator') or 'AND').upper()
        parts = []
        for c in rule['conditions']:
            scope = (c.get('scope') or 'pod').upper()
            target = (c.get('pod_names') or c.get('podNames')
                      or c.get('node_instance') or c.get('nodeInstance')
                      or c.get('namespace') or '*')
            if isinstance(target, (list, tuple)):
                target = ','.join(map(str, target))
            parts.append(f"{scope}:{target} {c.get('query')} {c.get('operator', '>')} {c.get('threshold')}")
        return f' {op} '.join(parts)
    target = (rule.get('podNames') or rule.get('pod_names') or rule.get('podName')
              or rule.get('nodeInstance') or rule.get('namespace') or '*')
    if isinstance(target, (list, tuple)):
        target = ','.join(map(str, target))
    scope = (rule.get('scope') or 'pod').upper()
    return f"{scope}:{target} {rule.get('query')} {rule.get('operator', '>')} {rule.get('threshold')}"


def _verdict(monitor: Dict[str, Any], violations: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute a colour-coded verdict for the report banner."""
    n = len(violations)
    crit = sum(1 for v in violations if (v.get('severity') or '').lower() == 'critical')
    mod = sum(1 for v in violations if (v.get('severity') or '').lower() == 'moderate')
    status = (monitor.get('status') or '').upper()

    if status == 'FAILED':
        return {'level': 'fail', 'label': 'FAILED', 'icon': '✗',
                'summary': f'Monitor crashed: {monitor.get("last_error") or "unknown error"}'}
    if crit > 0:
        return {'level': 'fail', 'label': 'CRITICAL', 'icon': '✗',
                'summary': f'{crit} Critical violation(s) — investigate immediately'}
    if mod > 0:
        return {'level': 'warn', 'label': 'WARN', 'icon': '⚠',
                'summary': f'{mod} Moderate violation(s) detected'}
    if n > 0:
        return {'level': 'warn', 'label': 'INFO', 'icon': 'ℹ',
                'summary': f'{n} Low-severity violation(s) only'}
    return {'level': 'pass', 'label': 'CLEAN', 'icon': '✓',
            'summary': 'No rule violations during this monitoring window'}


def _recommendations(monitor: Dict[str, Any], rule_health: Dict[str, Any],
                     violations: List[Dict[str, Any]],
                     timeseries: Dict[str, Any]) -> List[str]:
    """Heuristic notes to help debugging."""
    recs: List[str] = []

    if monitor.get('total_polls', 0) == 0:
        recs.append('Monitor never completed a poll — Prometheus may be unreachable or the testbed has no Prometheus URL configured.')

    silent_rules = [
        h.get('rule_name') for h in (rule_health or {}).values()
        if (h.get('polls') or 0) > 5 and (h.get('fired') or 0) == 0
    ]
    if silent_rules:
        recs.append(
            f'{len(silent_rules)} rule(s) never fired despite >5 polls: '
            + ', '.join(filter(None, silent_rules[:5]))
            + ('…' if len(silent_rules) > 5 else '')
            + '. Consider lowering thresholds, widening pod selection, or removing.'
        )

    over_eager = [
        h.get('rule_name') for h in (rule_health or {}).values()
        if (h.get('polls') or 0) > 0 and ((h.get('fired') or 0) / max(1, h['polls']) > 0.5)
    ]
    if over_eager:
        recs.append(
            f'{len(over_eager)} rule(s) fired on >50% of polls — likely too sensitive: '
            + ', '.join(filter(None, over_eager[:5]))
            + ('…' if len(over_eager) > 5 else '')
        )

    cpu = (timeseries or {}).get('cluster_cpu') or []
    if cpu and len(cpu) > 5:
        peak = max(p[1] for p in cpu)
        if peak > 90:
            recs.append(f'Cluster CPU peaked at {peak:.1f}% — consider adding a Node CPU rule below this.')

    mem = (timeseries or {}).get('cluster_mem') or []
    if mem and len(mem) > 5:
        peak = max(p[1] for p in mem)
        if peak > 90:
            recs.append(f'Cluster memory peaked at {peak:.1f}% — add a memory pressure alert.')

    cooldown_clipped = sum(
        1 for h in (rule_health or {}).values()
        if (h.get('fired') or 0) > 0 and (h.get('polls') or 0) // max(1, h.get('fired') or 1) < 2
    )
    if cooldown_clipped:
        recs.append(f'{cooldown_clipped} rule(s) hit the 60s cooldown — actual violation rate may be higher than reported.')

    if not recs:
        recs.append('No anomalies in monitor behaviour. All rules evaluated cleanly.')
    return recs


# ── Public ───────────────────────────────────────────────────────────

def build_report(monitor_id: str) -> Optional[Dict[str, Any]]:
    """Return the full report payload for a monitor session, or ``None`` if
    the monitor doesn't exist."""
    monitor = svc.get_monitor(monitor_id)
    if not monitor:
        return None

    # Pull a generous window of violations (UI sub-tabs filter further)
    violations = svc.get_violations(monitor_id, limit=2000) or []

    # Normalise each violation into a stable shape for the UI / template
    norm_violations: List[Dict[str, Any]] = []
    for v in violations:
        # Persisted rows nest the original violation in diagnostic_context
        diag = v.get('diagnostic_context') or {}
        rule_name = v.get('rule_name') or diag.get('rule_name')
        severity = (v.get('severity') or diag.get('severity') or 'Moderate')
        ts = v.get('timestamp') or v.get('created_at')
        is_composite = diag.get('is_composite') or v.get('is_composite') or False
        norm_violations.append({
            'source': v.get('source', 'persisted'),
            'rule_id': diag.get('rule_id'),
            'rule_name': rule_name,
            'severity': severity,
            'value': v.get('value') if v.get('value') is not None else diag.get('actual_value'),
            'threshold': v.get('threshold') if v.get('threshold') is not None else diag.get('threshold'),
            'operator': v.get('operator') or diag.get('operator'),
            'is_composite': is_composite,
            'logical_operator': v.get('logical_operator') or diag.get('logical_operator'),
            'conditions_evaluated': v.get('conditions_evaluated') or diag.get('conditions_evaluated'),
            'message': v.get('message'),
            'timestamp': _safe_iso(ts),
            'iteration': v.get('iteration') or diag.get('iteration'),
            'pod_name': diag.get('pod_name'),
            'namespace': diag.get('namespace'),
        })

    # Sort newest-first
    norm_violations.sort(key=lambda x: x.get('timestamp') or '', reverse=True)

    metric_samples = monitor.get('metric_samples') or {}
    rule_health = (metric_samples.get('rule_health') or {}) if isinstance(metric_samples, dict) else {}
    timeseries = {k: metric_samples.get(k, []) for k in ('cluster_cpu', 'cluster_max_cpu', 'cluster_mem', 'cluster_max_mem')} if isinstance(metric_samples, dict) else {}

    rules_cfg = (monitor.get('rule_config') or {}).get('monitoring_rules', []) if isinstance(monitor.get('rule_config'), dict) else []
    rule_table: List[Dict[str, Any]] = []
    for r in rules_cfg:
        rid = r.get('id') or r.get('name') or ''
        h = rule_health.get(rid, {})
        rule_table.append({
            'id': rid,
            'name': r.get('name'),
            'severity': r.get('severity'),
            'enabled': r.get('enabled', True),
            'description': r.get('description'),
            'summary': _summarize_rule(r),
            'collect_logs': bool(r.get('collectLogs') or r.get('collect_logs')),
            'log_duration_hours': r.get('logDurationHours') or r.get('log_duration_hours'),
            'polls': h.get('polls', 0),
            'fired': h.get('fired', 0),
            'last_value': h.get('last_value'),
            'last_violation_ts': h.get('last_violation_ts'),
            'fire_rate': round((h.get('fired') or 0) / max(1, h.get('polls') or 1) * 100, 2),
        })
    rule_table.sort(key=lambda x: (-(x.get('fired') or 0), x.get('name') or ''))

    overview = {
        'monitor_id': monitor_id,
        'name': monitor.get('name'),
        'description': monitor.get('description'),
        'testbed_id': monitor.get('testbed_id'),
        'status': monitor.get('status'),
        'started_at': monitor.get('started_at'),
        'stopped_at': monitor.get('stopped_at'),
        'last_poll_at': monitor.get('last_poll_at'),
        'duration_seconds': _seconds_between(monitor.get('started_at'),
                                             monitor.get('stopped_at') or monitor.get('last_poll_at')),
        'duration_hours_target': monitor.get('duration_hours'),
        'poll_interval_s': monitor.get('poll_interval_s'),
        'total_polls': monitor.get('total_polls'),
        'total_violations': monitor.get('total_violations'),
        'is_running': monitor.get('is_running', False),
        'rule_count': len(rule_table),
    }

    verdict = _verdict(monitor, norm_violations)
    recommendations = _recommendations(monitor, rule_health, norm_violations, timeseries)

    # Correlation: violations sorted onto the timeseries axis
    correlation = []
    for v in norm_violations[:200]:
        if v.get('timestamp'):
            correlation.append({
                'ts': v['timestamp'], 'severity': v.get('severity'),
                'rule_name': v.get('rule_name'), 'value': v.get('value'),
            })

    # Phase-4: log bundles triggered for this monitor
    log_bundles: List[Dict[str, Any]] = []
    try:
        from services import log_collection_service as lc
        log_bundles = lc.list_bundles(monitor_id=monitor_id, limit=100) or []
    except Exception as e:
        logger.warning(f"build_report: failed to fetch log bundles: {e}")

    return {
        'overview': overview,
        'verdict': verdict,
        'rules': rule_table,
        'violations': norm_violations,
        'timeseries': timeseries,
        'rule_health': rule_health,
        'correlation': correlation,
        'recommendations': recommendations,
        'log_bundles': log_bundles,
        'config_dump': {
            'rule_config': monitor.get('rule_config'),
            'settings': monitor.get('settings'),
        },
    }


def render_html(report: Dict[str, Any]) -> str:
    """Render the report as a self-contained HTML document (no external assets
    other than a CDN Chart.js for the trend chart). Designed to look like
    ``enhanced_report.html`` but tailored to a monitor-only run.
    """
    # We deliberately keep the template inlined here rather than as a separate
    # Jinja file so the report module is fully self-contained and easy to
    # iterate on. Style mirrors templates/enhanced_report.html.
    safe_json = json.dumps(report, default=str)
    overview = report['overview']
    verdict = report['verdict']
    rules = report['rules']
    violations = report['violations']
    recommendations = report['recommendations']

    def _html_escape(s):
        if s is None:
            return ''
        return (str(s).replace('&', '&amp;').replace('<', '&lt;')
                .replace('>', '&gt;').replace('"', '&quot;'))

    verdict_class = {'pass': 'verdict-pass', 'warn': 'verdict-warn', 'fail': 'verdict-fail'}.get(verdict['level'], 'verdict-pass')
    rec_html = ''.join(f'<li>{_html_escape(r)}</li>' for r in recommendations)

    rules_rows = ''
    for r in rules:
        fire_class = 'badge-fail' if (r.get('fired') or 0) > 5 else ('badge-warn' if (r.get('fired') or 0) > 0 else 'badge-pass')
        rules_rows += (
            f'<tr><td>{_html_escape(r.get("name"))}</td>'
            f'<td><span class="badge badge-{(r.get("severity") or "moderate").lower()}">{_html_escape(r.get("severity"))}</span></td>'
            f'<td><code>{_html_escape(r.get("summary"))}</code></td>'
            f'<td>{r.get("polls") or 0}</td>'
            f'<td><span class="badge {fire_class}">{r.get("fired") or 0}</span></td>'
            f'<td>{r.get("fire_rate") or 0}%</td>'
            f'<td>{_html_escape(r.get("last_value"))}</td>'
            f'<td>{_html_escape(r.get("last_violation_ts"))}</td>'
            '</tr>'
        )

    viol_rows = ''
    for v in violations[:500]:
        sev = (v.get('severity') or 'moderate').lower()
        comp = '🔗 composite' if v.get('is_composite') else 'simple'
        viol_rows += (
            f'<tr><td>{_html_escape(v.get("timestamp"))}</td>'
            f'<td>{_html_escape(v.get("rule_name"))}</td>'
            f'<td><span class="badge badge-{sev}">{_html_escape(v.get("severity"))}</span></td>'
            f'<td>{comp}</td>'
            f'<td>{_html_escape(v.get("value"))}</td>'
            f'<td>{_html_escape(v.get("operator"))} {_html_escape(v.get("threshold"))}</td>'
            f'<td><code>{_html_escape((v.get("message") or "")[:160])}</code></td>'
            '</tr>'
        )

    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Monitor-Only Report — {_html_escape(overview.get('monitor_id'))}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  :root {{ --pass:#22c55e; --warn:#f59e0b; --fail:#ef4444; --dark:#1e293b; --muted:#64748b; --light:#f8fafc; --border:#e2e8f0; }}
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  body {{ font-family:'Segoe UI',-apple-system,system-ui,sans-serif; background:var(--light); color:var(--dark); line-height:1.6; }}
  .container {{ max-width:1280px; margin:0 auto; padding:24px; }}
  .verdict-banner {{ padding:28px 32px; border-radius:12px; margin-bottom:28px; display:flex; align-items:center; gap:20px; }}
  .verdict-pass {{ background:linear-gradient(135deg,#dcfce7,#bbf7d0); border-left:6px solid var(--pass); }}
  .verdict-warn {{ background:linear-gradient(135deg,#fef3c7,#fde68a); border-left:6px solid var(--warn); }}
  .verdict-fail {{ background:linear-gradient(135deg,#fee2e2,#fecaca); border-left:6px solid var(--fail); }}
  .verdict-icon {{ font-size:48px; }}
  .verdict-label {{ font-size:28px; font-weight:800; letter-spacing:1px; }}
  .verdict-summary {{ color:var(--muted); margin-top:4px; }}
  .card {{ background:white; border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,.08); border:1px solid var(--border); margin-bottom:24px; overflow:hidden; }}
  .card-header {{ padding:20px 24px; border-bottom:1px solid var(--border); }}
  .card-header h2 {{ font-size:18px; font-weight:700; }}
  .card-body {{ padding:24px; }}
  .stat-grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:16px; }}
  .stat-card {{ background:white; border:1px solid var(--border); border-radius:10px; padding:16px; text-align:center; }}
  .stat-value {{ font-size:28px; font-weight:800; }}
  .stat-label {{ color:var(--muted); font-size:12px; font-weight:600; text-transform:uppercase; margin-top:4px; }}
  table {{ width:100%; border-collapse:collapse; }}
  th {{ background:#f1f5f9; color:var(--muted); font-size:12px; font-weight:700; text-transform:uppercase; padding:10px 14px; text-align:left; }}
  td {{ padding:8px 14px; border-bottom:1px solid var(--border); font-size:13px; }}
  tr:hover {{ background:#f8fafc; }}
  .badge {{ display:inline-block; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; }}
  .badge-pass,.badge-low {{ background:#dcfce7; color:#166534; }}
  .badge-warn,.badge-moderate {{ background:#fef3c7; color:#92400e; }}
  .badge-fail,.badge-critical {{ background:#fee2e2; color:#991b1b; }}
  .chart-container {{ position:relative; width:100%; height:340px; margin:16px 0; }}
  pre {{ background:#1e293b; color:#e2e8f0; border-radius:8px; padding:12px 16px; font-family:'SF Mono',monospace; font-size:12px; overflow:auto; }}
  ul.recs {{ list-style:none; padding:0; }}
  ul.recs li {{ padding:8px 12px; background:#fffbeb; border-left:4px solid var(--warn); margin-bottom:6px; border-radius:4px; }}
  @media print {{ body {{ background:white; }} .card {{ break-inside:avoid; }} }}
</style></head>
<body><div class="container">

<div class="verdict-banner {verdict_class}">
  <div class="verdict-icon">{verdict['icon']}</div>
  <div>
    <div class="verdict-label">{verdict['label']}</div>
    <div class="verdict-summary">{_html_escape(verdict['summary'])}</div>
  </div>
</div>

<div class="card"><div class="card-header"><h2>Overview</h2></div><div class="card-body">
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-value">{overview.get('total_polls') or 0}</div><div class="stat-label">Total polls</div></div>
    <div class="stat-card"><div class="stat-value">{overview.get('total_violations') or 0}</div><div class="stat-label">Violations recorded</div></div>
    <div class="stat-card"><div class="stat-value">{overview.get('rule_count')}</div><div class="stat-label">Rules configured</div></div>
    <div class="stat-card"><div class="stat-value">{overview.get('poll_interval_s')}s</div><div class="stat-label">Poll interval</div></div>
    <div class="stat-card"><div class="stat-value">{(overview.get('duration_seconds') or 0) / 60:.1f}m</div><div class="stat-label">Wall-clock</div></div>
    <div class="stat-card"><div class="stat-value">{_html_escape(overview.get('status'))}</div><div class="stat-label">Status</div></div>
  </div>
  <p style="margin-top:16px; color:var(--muted); font-size:13px;">
    <b>Monitor ID:</b> {_html_escape(overview.get('monitor_id'))} &nbsp;|&nbsp;
    <b>Testbed:</b> {_html_escape(overview.get('testbed_id'))} &nbsp;|&nbsp;
    <b>Started:</b> {_html_escape(overview.get('started_at'))} &nbsp;|&nbsp;
    <b>Last poll:</b> {_html_escape(overview.get('last_poll_at'))}
  </p>
</div></div>

<div class="card"><div class="card-header"><h2>Cluster Resource Trend</h2></div><div class="card-body">
  <div class="chart-container"><canvas id="trendChart"></canvas></div>
  <p style="color:var(--muted); font-size:12px;">Cluster CPU + Memory aggregates captured each poll. Shaded markers indicate violation timestamps overlaid on the timeline.</p>
</div></div>

<div class="card"><div class="card-header"><h2>Rule Health ({len(rules)} rules)</h2></div><div class="card-body" style="padding:0; overflow-x:auto;">
  <table><thead><tr>
    <th>Rule</th><th>Severity</th><th>Definition</th><th>Polls</th><th>Fired</th><th>Fire %</th><th>Last value</th><th>Last violation</th>
  </tr></thead><tbody>{rules_rows or '<tr><td colspan=8>No rules configured.</td></tr>'}</tbody></table>
</div></div>

<div class="card"><div class="card-header"><h2>Violations ({len(violations)})</h2></div><div class="card-body" style="padding:0; overflow-x:auto;">
  <table><thead><tr>
    <th>Timestamp</th><th>Rule</th><th>Severity</th><th>Type</th><th>Value</th><th>Threshold</th><th>Message</th>
  </tr></thead><tbody>{viol_rows or '<tr><td colspan=7>No violations recorded.</td></tr>'}</tbody></table>
</div></div>

<div class="card"><div class="card-header"><h2>Recommendations</h2></div><div class="card-body">
  <ul class="recs">{rec_html}</ul>
</div></div>

<div class="card"><div class="card-header"><h2>Raw Configuration</h2></div><div class="card-body">
  <pre>{_html_escape(json.dumps(report['config_dump'], indent=2, default=str))}</pre>
</div></div>

<script>
  const REPORT = {safe_json};
  (function () {{
    const ts = REPORT.timeseries || {{}};
    const cpu = ts.cluster_cpu || [];
    const mem = ts.cluster_mem || [];
    if (!cpu.length && !mem.length) {{
      const c = document.getElementById('trendChart');
      if (c) c.parentElement.innerHTML = '<div style="color:#64748b; padding:24px; text-align:center;">No timeseries data captured (Prometheus may have been unreachable).</div>';
      return;
    }}
    const labels = (cpu.length ? cpu : mem).map(p => p[0]);
    new Chart(document.getElementById('trendChart').getContext('2d'), {{
      type: 'line',
      data: {{
        labels,
        datasets: [
          {{ label: 'Cluster Avg CPU %', data: cpu.map(p => p[1]), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.3 }},
          {{ label: 'Cluster Avg Mem %', data: mem.map(p => p[1]), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', tension: 0.3 }},
        ],
      }},
      options: {{
        responsive: true, maintainAspectRatio: false,
        scales: {{ y: {{ min: 0, max: 100, title: {{ display: true, text: 'Percent' }} }} }},
        plugins: {{ legend: {{ position: 'top' }} }}
      }}
    }});
  }})();
</script>

</div></body></html>"""
