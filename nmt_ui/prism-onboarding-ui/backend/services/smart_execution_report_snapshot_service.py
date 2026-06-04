"""
Smart-Execution Report Snapshot Service (Layer-2, Phase D)
==========================================================

Glue between the (large, fragile) enhanced-report route in ``app.py`` and the
materialised ``smart_execution_report_snapshots`` table. The route stays the
single source of truth for HOW a report is assembled; this module only:

  * captures the EXACT ``render_kwargs`` the route rendered ("capture at render")
    plus ``enhanced_data``, bounds them, and upserts a snapshot, and
  * resolves the read source (live | snapshot | auto), tells the route whether a
    stored snapshot may be served, and reconstructs the kwargs / enhanced_data
    needed to re-render or return JSON from a snapshot.

Re-rendering from a snapshot is byte-for-byte identical to the original render
(same template, same kwargs) and never touches Prometheus or an in-memory
engine — which is exactly what makes the report fast and unbreakable.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# Smart-execution statuses that are terminal (report is immutable → snapshot is
# authoritative and safe to serve under ``auto``).
TERMINAL_STATUSES = {'COMPLETED', 'STOPPED', 'FAILED', 'TIMEOUT', 'CANCELLED', 'ERROR'}


def default_source() -> str:
    """Default read source. ``auto`` = serve a fresh terminal snapshot when one
    exists, else fall back to live (and capture on the way out)."""
    val = (os.environ.get('SMART_REPORT_SOURCE') or 'auto').strip().lower()
    return val if val in ('live', 'snapshot', 'auto') else 'auto'


def resolve_source(requested: Optional[str]) -> str:
    req = (requested or '').strip().lower()
    if req in ('live', 'snapshot', 'auto'):
        return req
    return default_source()


def _is_terminal(status: Optional[str]) -> bool:
    return bool(status) and str(status).upper() in TERMINAL_STATUSES


def load_servable(execution_id: str, source: str) -> Optional[Dict[str, Any]]:
    """Return the stored snapshot row dict if it may be served for this request,
    else None (caller falls back to the live path).

    * ``source == 'live'``     → never serve a snapshot.
    * ``source == 'snapshot'`` → serve whatever is stored (explicit opt-in).
    * ``source == 'auto'``     → serve only if the snapshot captured a terminal
      execution (running execs keep showing live data).
    """
    if source == 'live':
        return None
    try:
        from services.report_snapshot_repo import get_smart_snapshot
        row = get_smart_snapshot(execution_id)
    except Exception as e:  # noqa: BLE001
        logger.debug("[%s] smart snapshot lookup failed: %s", execution_id, e)
        return None
    if not row:
        return None
    payload = row.get('payload') or {}
    if not isinstance(payload, dict) or 'render_kwargs' not in payload:
        return None
    if source == 'snapshot':
        return row
    # auto: only serve terminal snapshots
    meta = payload.get('meta') or {}
    if _is_terminal(meta.get('status')):
        return row
    return None


def reconstruct_enhanced_data(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Rebuild the full ``enhanced_data`` for the ``?format=json`` export by
    merging the slimmed copy with the cluster_health / pod_health blocks that
    were stored once inside render_kwargs."""
    rk = payload.get('render_kwargs') or {}
    ed = dict(payload.get('enhanced_data_slim') or {})
    if 'cluster_health' not in ed and isinstance(rk.get('cluster_health'), dict):
        ed['cluster_health'] = rk.get('cluster_health')
    if 'pod_health' not in ed and isinstance(rk.get('pod_health'), dict):
        ed['pod_health'] = rk.get('pod_health')
    return ed


def capture(
    execution_id: str,
    render_kwargs: Dict[str, Any],
    enhanced_data: Dict[str, Any],
    *,
    meta: Optional[Dict[str, Any]] = None,
) -> bool:
    """Build + upsert a snapshot from the kwargs the route just rendered.
    Synchronous; ``capture_async`` offloads this to a daemon thread."""
    try:
        from services.report_snapshot_builder import build_smart_snapshot
        from services.report_snapshot_repo import upsert_smart_snapshot

        result = build_smart_snapshot(render_kwargs, enhanced_data, meta=meta or {})
        ok = upsert_smart_snapshot(execution_id, result)
        if ok:
            logger.info("[%s] smart snapshot captured (quality=%s size=%.0fKB)",
                        execution_id, result.data_quality, result.size_bytes / 1024.0)
        return ok
    except Exception as e:  # noqa: BLE001
        logger.warning("[%s] smart snapshot capture failed: %s", execution_id, e, exc_info=True)
        return False


_PROACTIVE_INFLIGHT: set = set()
_PROACTIVE_LOCK = threading.Lock()


def schedule_proactive_capture(execution_id: str, status: Optional[str], *, delay_seconds: float = 3.0) -> None:
    """Proactively warm a snapshot when an execution reaches a terminal state,
    so even the FIRST report open is instant (read-through alone would make the
    first viewer pay the slow build once).

    Fire-and-forget: drives the real enhanced-report route through an in-process
    test client (``source=live``), whose read-through path persists the
    snapshot. Reuses the exact assembly logic — no duplication, no divergence.
    Even if live Prometheus is unreachable, the DB-load path uses the persisted
    end-of-run cluster snapshot, so a usable snapshot is still captured.
    De-duplicated so repeated saves of the same terminal execution warm once.
    """
    if not _is_terminal(status):
        return
    with _PROACTIVE_LOCK:
        if execution_id in _PROACTIVE_INFLIGHT:
            return
        _PROACTIVE_INFLIGHT.add(execution_id)

    def _run():
        import time
        try:
            # Let any trailing DB writes for this execution settle first.
            time.sleep(max(0.0, delay_seconds))
            import app as appmod  # lazy: avoid import cycle at module load
            client = appmod.app.test_client()
            resp = client.get(
                f'/api/smart-execution/report/{execution_id}/enhanced?source=live&nocache=1'
            )
            logger.info("[%s] proactive snapshot warm finished (HTTP %s)",
                        execution_id, getattr(resp, 'status_code', '?'))
        except Exception:  # noqa: BLE001
            logger.debug("[%s] proactive snapshot warm failed", execution_id, exc_info=True)
        finally:
            with _PROACTIVE_LOCK:
                _PROACTIVE_INFLIGHT.discard(execution_id)

    try:
        threading.Thread(target=_run, name=f"smart-proactive-{execution_id[:12]}", daemon=True).start()
    except Exception:  # noqa: BLE001
        with _PROACTIVE_LOCK:
            _PROACTIVE_INFLIGHT.discard(execution_id)
        logger.debug("[%s] could not spawn proactive warm thread", execution_id, exc_info=True)


def capture_async(
    execution_id: str,
    render_kwargs: Dict[str, Any],
    enhanced_data: Dict[str, Any],
    *,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    """Fire-and-forget capture so the request returns immediately. Only
    captures terminal executions (running ones change → re-capture on next
    terminal view)."""
    if not _is_terminal((meta or {}).get('status')):
        return

    def _run():
        try:
            capture(execution_id, render_kwargs, enhanced_data, meta=meta)
        except Exception:  # noqa: BLE001
            logger.debug("[%s] async smart snapshot capture swallowed error", execution_id, exc_info=True)

    try:
        threading.Thread(target=_run, name=f"smart-snap-{execution_id[:12]}", daemon=True).start()
    except Exception:  # noqa: BLE001
        logger.debug("[%s] could not spawn smart snapshot thread", execution_id, exc_info=True)
