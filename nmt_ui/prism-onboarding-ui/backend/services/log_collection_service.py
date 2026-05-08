"""
Log Collection Service
======================

Triggered when a monitoring rule with ``collectLogs=True`` fires. Best-effort
collects PC + (optionally) NCM logs via SSH and stores the result in the
``alert_log_bundles`` table.

Decisions, by design:

- Credentials come from the ``Testbed`` row (``username`` / ``password``).
  If those are missing, the bundle is recorded as ``MISSING_CREDS`` so the user
  sees in the report exactly *why* nothing was collected.
- If ``paramiko`` is not installed, bundles are recorded as ``UNAVAILABLE``.
- Each collection runs in its own daemon thread so the rule-evaluation loop
  never blocks.
- SSH connection timeout is bounded (10s) so a hung NCM doesn't pile up
  threads.

This module is intentionally idempotent and forgiving: any failure path
results in a persisted row (never a swallowed exception) so the report can
explain it.
"""

from __future__ import annotations

import logging
import os
import threading
from datetime import datetime
from typing import Any, Dict, Optional

from database import SessionLocal
from models.alert_log_bundle import AlertLogBundle
from models.testbed import Testbed

logger = logging.getLogger(__name__)

# Resolve paramiko at import time so we can degrade gracefully
try:
    import paramiko  # type: ignore
    _PARAMIKO_OK = True
except ImportError:
    paramiko = None  # type: ignore
    _PARAMIKO_OK = False
    logger.warning("paramiko not available — log collection will be marked UNAVAILABLE")

# Where bundle paths are recorded (the bundle itself stays on the PC; we only
# persist its remote path + the stdout tail for in-app preview).
DEFAULT_BUNDLE_HOURS = 1.0
SSH_CONNECT_TIMEOUT = 10
EXEC_TIMEOUT = 600  # 10 min cap for any single ``logbay collect``
STDOUT_TAIL_KB = 32


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def schedule_collection(*, testbed_id: str, alert_id: Optional[int],
                        monitor_id: Optional[str], execution_id: Optional[str],
                        rule: Dict[str, Any], severity: Optional[str] = None) -> Optional[int]:
    """Persist a PENDING bundle row + spawn a thread that performs the SSH
    collection. Returns the new bundle_id (or None if persistence failed).

    The function never raises — any error is recorded in the bundle row.
    """
    rule_id = rule.get('id') or rule.get('name') or 'unknown'
    rule_name = rule.get('name')
    duration_hours = float(rule.get('logDurationHours') or rule.get('log_duration_hours') or DEFAULT_BUNDLE_HOURS)

    bundle_id = _create_bundle_row(
        testbed_id=testbed_id, alert_id=alert_id, monitor_id=monitor_id,
        execution_id=execution_id, rule_id=rule_id, rule_name=rule_name,
        severity=severity, duration_hours=duration_hours,
    )
    if bundle_id is None:
        return None

    thread = threading.Thread(
        target=_collect_in_background,
        args=(bundle_id, testbed_id, duration_hours),
        name=f"log-collect-{bundle_id}",
        daemon=True,
    )
    thread.start()
    return bundle_id


def list_bundles(*, monitor_id: Optional[str] = None, execution_id: Optional[str] = None,
                 testbed_id: Optional[str] = None, status: Optional[str] = None,
                 limit: int = 200) -> list:
    """Return persisted bundles ordered newest-first."""
    session = SessionLocal()
    try:
        q = session.query(AlertLogBundle)
        if monitor_id:
            q = q.filter(AlertLogBundle.monitor_id == monitor_id)
        if execution_id:
            q = q.filter(AlertLogBundle.execution_id == execution_id)
        if testbed_id:
            q = q.filter(AlertLogBundle.testbed_id == testbed_id)
        if status:
            q = q.filter(AlertLogBundle.status == status)
        q = q.order_by(AlertLogBundle.requested_at.desc()).limit(limit)
        return [r.to_dict() for r in q.all()]
    finally:
        session.close()


def get_bundle(bundle_id: int) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        row = session.query(AlertLogBundle).filter_by(id=bundle_id).first()
        return row.to_dict() if row else None
    finally:
        session.close()


# ─────────────────────────────────────────────────────────────────────────────
# Internals
# ─────────────────────────────────────────────────────────────────────────────

def _create_bundle_row(*, testbed_id, alert_id, monitor_id, execution_id,
                       rule_id, rule_name, severity, duration_hours) -> Optional[int]:
    session = SessionLocal()
    try:
        # Resolve testbed creds + IPs up-front so they're recorded even when
        # the collection later fails.
        tb = session.query(Testbed).filter(Testbed.unique_testbed_id == testbed_id).first()
        if not tb:
            logger.warning(f"log-collect: testbed {testbed_id} not found")
            return None
        row = AlertLogBundle(
            monitor_id=monitor_id, execution_id=execution_id,
            testbed_id=testbed_id, alert_id=alert_id,
            rule_id=rule_id, rule_name=rule_name, severity=severity,
            pc_ip=tb.pc_ip, ncm_ip=tb.ncm_ip,
            duration_hours=duration_hours,
            status='PENDING',
            metadata_json={
                'has_pc_creds': bool(tb.username and tb.password),
                'paramiko_available': _PARAMIKO_OK,
            },
        )
        session.add(row)
        session.commit()
        return row.id
    except Exception as e:
        session.rollback()
        logger.exception(f"log-collect: failed to persist bundle row: {e}")
        return None
    finally:
        session.close()


def _collect_in_background(bundle_id: int, testbed_id: str, duration_hours: float):
    """Run the actual SSH/logbay collect for a single bundle row."""
    session = SessionLocal()
    try:
        row = session.query(AlertLogBundle).filter_by(id=bundle_id).first()
        if not row:
            return
        row.started_at = datetime.utcnow()

        if not _PARAMIKO_OK:
            row.status = 'UNAVAILABLE'
            row.error = 'paramiko library is not installed on the NMT backend'
            row.completed_at = datetime.utcnow()
            session.commit()
            return

        tb = session.query(Testbed).filter(Testbed.unique_testbed_id == testbed_id).first()
        if not tb:
            row.status = 'FAILED'
            row.error = 'Testbed disappeared from DB before collection'
            row.completed_at = datetime.utcnow()
            session.commit()
            return

        if not (tb.username and tb.password):
            row.status = 'MISSING_CREDS'
            row.error = (
                'Testbed has no username/password stored. Add credentials on the '
                'testbed configuration page (or set them via the testbed JSON) '
                'so log bundles can be collected.'
            )
            row.completed_at = datetime.utcnow()
            session.commit()
            return

        if not tb.pc_ip:
            row.status = 'FAILED'
            row.error = 'Testbed has no pc_ip configured'
            row.completed_at = datetime.utcnow()
            session.commit()
            return

        # Snapshot the credentials we need BEFORE we close the session
        # (otherwise we hit DetachedInstanceError when SQLAlchemy tries to
        # lazy-load attributes from a detached object).
        creds_host = tb.pc_ip
        creds_user = tb.username
        creds_pwd = tb.password

        # Persist intermediate state so the UI shows progress
        row.status = 'COLLECTING'
        session.commit()
        session.close()
        session = None  # marker for the outer ``finally`` below

        # Run the actual SSH command (outside DB session so the connection
        # isn't held open while the remote command runs).
        result = _ssh_collect(
            host=creds_host, username=creds_user, password=creds_pwd,
            duration_hours=duration_hours,
        )

        # Re-open a fresh session to write results
        session = SessionLocal()
        row = session.query(AlertLogBundle).filter_by(id=bundle_id).first()
        if not row:
            return
        row.completed_at = datetime.utcnow()
        if result.get('ok'):
            row.status = 'READY'
            row.bundle_path = result.get('bundle_path')
            row.bundle_size_bytes = result.get('bundle_size_bytes')
            row.stdout_tail = result.get('stdout_tail')
        else:
            row.status = 'FAILED'
            row.error = result.get('error') or 'unknown error'
            row.stdout_tail = result.get('stdout_tail')
        session.commit()
    except Exception as e:
        logger.exception(f"log-collect: bundle {bundle_id} crashed: {e}")
        try:
            if session is None:
                session = SessionLocal()
            row = session.query(AlertLogBundle).filter_by(id=bundle_id).first()
            if row:
                row.status = 'FAILED'
                row.error = f'{type(e).__name__}: {e}'
                row.completed_at = datetime.utcnow()
                session.commit()
        except Exception:
            pass
    finally:
        try:
            if session is not None:
                session.close()
        except Exception:
            pass


def _ssh_collect(*, host: str, username: str, password: str,
                 duration_hours: float) -> Dict[str, Any]:
    """Run ``logbay collect`` on the PC over SSH. Returns a result dict.

    Falls back to a generic ``tail /home/nutanix/data/logs/*.log`` if logbay is
    not present on the host so we always grab *something* useful.
    """
    if not _PARAMIKO_OK:
        return {'ok': False, 'error': 'paramiko unavailable'}

    ssh = paramiko.SSHClient()  # type: ignore[attr-defined]
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())  # type: ignore[attr-defined]
    try:
        ssh.connect(host, username=username, password=password, timeout=SSH_CONNECT_TIMEOUT,
                    banner_timeout=SSH_CONNECT_TIMEOUT, auth_timeout=SSH_CONNECT_TIMEOUT)
    except Exception as e:
        return {'ok': False, 'error': f'SSH connect to {host} failed: {e}'}

    try:
        # Try logbay first (matches legacy behaviour from nmt_old_backup)
        logbay_cmd = (
            f"~/ncc/bin/logbay collect -t cluster --duration=-{int(duration_hours)}h 2>&1 "
            f"|| /home/nutanix/ncc/bin/logbay collect -t cluster --duration=-{int(duration_hours)}h 2>&1"
        )
        try:
            stdin, stdout, stderr = ssh.exec_command(logbay_cmd, timeout=EXEC_TIMEOUT)
            output = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
        except Exception as e:
            return {'ok': False, 'error': f'logbay exec failed: {e}'}

        combined = (output + ('\n--STDERR--\n' + err if err else ''))
        # Crude extraction: logbay prints the final bundle path on a line like
        # "Successfully collected logs to /home/nutanix/data/log_collector/...tar"
        bundle_path = None
        for line in reversed(combined.splitlines()):
            line_lower = line.lower()
            if '.tar' in line_lower or 'log_collector' in line_lower:
                # Best effort: take the last token that looks path-ish
                tokens = [t for t in line.split() if t.startswith('/')]
                if tokens:
                    bundle_path = tokens[-1]
                    break

        # Tail the output for the UI (last STDOUT_TAIL_KB)
        tail_bytes = STDOUT_TAIL_KB * 1024
        tail = combined[-tail_bytes:] if len(combined) > tail_bytes else combined

        if bundle_path:
            return {
                'ok': True,
                'bundle_path': bundle_path,
                'bundle_size_bytes': None,  # not fetched (would need extra SSH stat)
                'stdout_tail': tail,
            }

        # Fallback: grab the last 200 lines of recent /home/nutanix/data/logs/*.log
        try:
            stdin, stdout, stderr = ssh.exec_command(
                'tail -n 200 /home/nutanix/data/logs/*.log 2>&1 | head -c 32768',
                timeout=60,
            )
            tail2 = stdout.read().decode('utf-8', errors='replace')
            return {
                'ok': True,
                'bundle_path': None,
                'bundle_size_bytes': len(tail2),
                'stdout_tail': tail2 or tail,
            }
        except Exception as e:
            return {'ok': False, 'error': f'logbay produced no bundle and tail-fallback failed: {e}',
                    'stdout_tail': tail}
    finally:
        try:
            ssh.close()
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# Local-stub helper (used by tests + when running without a real PC)
# ─────────────────────────────────────────────────────────────────────────────

def _is_local_dummy() -> bool:
    """Return True when running under tests / local dev with no real testbed.
    Driven by the env var ``NMT_LOG_COLLECT_DRYRUN=1``.
    """
    return os.environ.get('NMT_LOG_COLLECT_DRYRUN') == '1'
