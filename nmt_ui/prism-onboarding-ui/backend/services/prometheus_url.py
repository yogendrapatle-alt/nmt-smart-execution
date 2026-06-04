"""
Resolve a working Prometheus base URL for an NCM testbed.

Layered resolution strategy (most-likely-correct first):

  1. The URL exactly as stored on the testbed.
  2. The same URL with HTTP/HTTPS scheme flipped (NCM nodePort exposes are
     often TLS-terminated but stored as http://, or vice-versa).
  3. Standard in-cluster Prometheus port (9090) on pc_ip / ncm_ip when a
     testbed context is supplied. Covers the case where the operator has
     port-forwarded Prometheus directly instead of via the kubectl-expose
     NodePort flow.
  4. Live kubectl rediscovery: ssh to the PC, ``mspctl cluster kubeconfig``
     to refresh the kubeconfig, then ``kubectl get svc prometheus-automation
     -n ntnx-system -o jsonpath='{.spec.ports[0].nodePort}'`` to read the
     CURRENT NodePort. This is what makes the resolver self-healing when
     someone deletes / re-creates the exposed service, the NCM VM reboots
     and picks up a new IP, or a cluster reinstall reuses the testbed
     label.

When ``persist=True`` the resolver also writes a freshly-discovered URL
back to ``testbeds.testbed_json['prometheus_url']`` so subsequent calls
short-circuit on step 1.

Backwards compatibility: the historical single-arg call
``resolve_working_prometheus_url(url)`` continues to work and only does
steps 1-2 (no kubectl I/O without explicit testbed context).
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin

import requests

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Existing primitives (backwards-compat)
# ─────────────────────────────────────────────────────────────────────────────

def _candidate_urls(base: str) -> List[str]:
    """Generate HTTP/HTTPS scheme-flipped candidates for a stored URL."""
    u = base.strip().rstrip('/')
    out: List[str] = []
    if u.startswith('http://'):
        https_u = 'https://' + u[len('http://') :]
        out.extend([https_u, u])
    elif u.startswith('https://'):
        http_u = 'http://' + u[len('https://') :]
        out.extend([u, http_u])
    else:
        out.extend([f'https://{u}', f'http://{u}'])
    seen = set()
    dedup: List[str] = []
    for x in out:
        if x not in seen:
            seen.add(x)
            dedup.append(x)
    return dedup


# ─────────────────────────────────────────────────────────────────────────────
# In-process resolved-URL cache (2026-06-03)
# ─────────────────────────────────────────────────────────────────────────────
#
# ``EnhancedReportService.__init__`` runs ``resolve_working_prometheus_url``
# on EVERY instantiation. The monitor-only report rebuild flow creates a
# fresh service on every request, and for a testbed whose Prometheus has
# moved the resolver burns 8-30s of HTTP probe time before falling back
# to the original URL. That made the React "Loading report…" spinner
# never settle (see notes in monitor_only_routes.py).
#
# A per-URL TTL cache short-circuits the repeat resolver calls. TTL is
# deliberately short (60s default) so a freshly-fixed Prometheus URL
# (operator just patched the NodePort) is picked up on the next minute
# without restarting the backend. The cache key is the input URL; the
# value is the resolved URL (or ``None``) plus a probe-result flag so
# downstream "is Prom reachable?" checks can also short-circuit.

from threading import RLock
import time as _time

_RESOLVED_URL_TTL_S = 60.0
_resolved_url_cache: Dict[str, Tuple[float, Optional[str], bool]] = {}
_resolved_url_lock = RLock()


def _cache_get_resolved(url_key: str) -> Optional[Tuple[Optional[str], bool]]:
    """Return (resolved_url, reachable) if cached and fresh, else None."""
    with _resolved_url_lock:
        ent = _resolved_url_cache.get(url_key)
        if not ent:
            return None
        expiry, resolved, reachable = ent
        if _time.time() >= expiry:
            _resolved_url_cache.pop(url_key, None)
            return None
        return resolved, reachable


def _cache_put_resolved(url_key: str, resolved: Optional[str], reachable: bool,
                        ttl_s: float = _RESOLVED_URL_TTL_S) -> None:
    with _resolved_url_lock:
        _resolved_url_cache[url_key] = (_time.time() + ttl_s, resolved, reachable)


def invalidate_resolved_url_cache(url_key: Optional[str] = None) -> None:
    """Drop one entry (``url_key``) or the entire cache (when ``None``).

    Used by the "Refresh Prometheus URL" admin action so the operator gets
    immediate feedback after fixing the stored URL.
    """
    with _resolved_url_lock:
        if url_key is None:
            _resolved_url_cache.clear()
        else:
            _resolved_url_cache.pop(url_key, None)


def is_prometheus_reachable_fast(
    url: Optional[str],
    timeout: float = 1.5,
    cache_ttl_s: float = 30.0,
) -> bool:
    """1.5s probe with a tiny TTL cache.

    Designed for hot paths that just need a yes/no answer ("can I do a
    live merge in build_report?") and must NOT block the user for the
    full ``probe_prometheus`` timeout on every call. Caches the answer
    for ``cache_ttl_s`` so a burst of refreshes against the same URL
    only pays the probe cost once.

    When ``url`` is falsy, returns ``False`` immediately.
    """
    if not url:
        return False
    key = '__reach__:' + str(url).strip().rstrip('/')
    hit = _cache_get_resolved(key)
    if hit is not None:
        return hit[1]
    ok = probe_prometheus(url, timeout=timeout)
    _cache_put_resolved(key, url if ok else None, ok, ttl_s=cache_ttl_s)
    return ok


def probe_prometheus(base_url: str, timeout: float = 2.0) -> bool:
    """True if /api/v1/query?query=up returns Prometheus success JSON.

    The default ``timeout`` was reduced from 8.0s to 2.0s on 2026-06-03 — the
    legacy value was a major contributor to the monitor-only "Loading report…"
    hang on testbeds whose Prometheus NodePort has moved. The resolver tries
    multiple candidates sequentially; 8s × N candidates × every report
    rebuild made the user-facing wall time 60-90s. A 2s probe is generous
    for an in-cluster HTTP endpoint (round-trips on the lab network are
    <100ms) and lets the resolver fail fast and fall back to the persisted
    snapshot rather than wedging the UI.

    Callers that need a longer budget (e.g. one-shot CLI repair tools) can
    still pass ``timeout=`` explicitly.
    """
    try:
        q = urljoin(base_url.rstrip('/') + '/', 'api/v1/query')
        r = requests.get(q, params={'query': 'up'}, verify=False, timeout=timeout)
        if r.status_code != 200:
            return False
        data = r.json()
        return data.get('status') == 'success'
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Testbed-aware candidate generation
# ─────────────────────────────────────────────────────────────────────────────

def _testbed_context_candidates(testbed: Dict[str, Any]) -> List[str]:
    """Extra candidate URLs derived from the testbed row.

    Currently we add the in-cluster Prometheus default (port 9090) on both
    pc_ip and ncm_ip. This covers operators who skip the NodePort expose
    step and reach Prometheus directly via a port-forward / firewall rule.
    """
    out: List[str] = []
    if not isinstance(testbed, dict):
        return out
    raw = testbed.get('testbed_json') if isinstance(testbed.get('testbed_json'), dict) else {}
    pc_ip = (raw or {}).get('pc_ip') or testbed.get('pc_ip')
    ncm_ip = (raw or {}).get('ncm_ip') or testbed.get('ncm_ip')
    for ip in (pc_ip, ncm_ip):
        if not ip:
            continue
        for scheme in ('https', 'http'):
            out.append(f'{scheme}://{ip}:9090')
    # De-dup while preserving order
    seen = set()
    return [u for u in out if not (u in seen or seen.add(u))]


# ─────────────────────────────────────────────────────────────────────────────
# Kubectl-based NodePort rediscovery
# ─────────────────────────────────────────────────────────────────────────────

_KUBECTL_DEFAULT_NAMESPACE = 'ntnx-system'
_KUBECTL_DEFAULT_SVC = 'prometheus-automation'
_KUBECTL_FALLBACK_SVC = 'prometheus-k8s'  # cluster-internal name we expose from
_KUBECTL_SOURCE_PORT = 9090  # Prometheus web port on the source service


def _looks_like_ip(value: Any) -> bool:
    """True only for a dotted-quad IPv4 string.

    ``get_ncm_ip_and_node()`` runs kubectl under a PTY and merges stderr into
    stdout, so a failed lookup can return banner/error text (e.g. ``error:``)
    that is truthy but useless. Guard against using that as a host.
    """
    s = str(value or '').strip()
    parts = s.split('.')
    if len(parts) != 4:
        return False
    return all(p.isdigit() and 0 <= int(p) <= 255 for p in parts)


def _validate_nodeport(value: Any) -> Optional[str]:
    """Return a clean NodePort string or ``None``.

    ``run_command`` merges stderr into stdout under a PTY, so a failed kubectl
    call can return error text. Take the first whitespace token and require it
    to be a plausible port integer before trusting it.
    """
    s = str(value or '').strip()
    if not s:
        return None
    token = s.split()[0]
    if token.isdigit() and 1 <= int(token) <= 65535:
        return token
    return None


def _source_svc_nodeport(
    client: Any,
    namespace: str,
    source_svc: str,
    port: int,
) -> Optional[str]:
    """Read the NodePort the cluster already assigned to ``source_svc:port``.

    This is the resilient discovery path: NCM's ``prometheus-k8s`` service is
    a NodePort/LoadBalancer that already carries a node port for the 9090 web
    port. Reading it needs no write access and survives an operator deleting
    the separate ``prometheus-automation`` copy that the legacy flow relied on.
    """
    kubeconfig = getattr(client, 'kubeconfig_tmp', '/tmp/ncm.cfg')
    cmd = (
        'source /etc/profile; '
        f'kubectl --kubeconfig={kubeconfig} get svc {source_svc} -n {namespace} '
        f'-o jsonpath="{{.spec.ports[?(@.port=={port})].nodePort}}"'
    )
    try:
        return _validate_nodeport(client.run_command(cmd))
    except Exception as e:  # noqa: BLE001
        logger.debug('[prom-rediscover] source-svc NodePort read failed: %s', e)
        return None


def _discover_nodeport(
    client: Any,
    namespace: str,
    exposed_svc: str,
    source_svc: str,
) -> Optional[str]:
    """Find the current Prometheus NodePort, most-reliable signal first.

    1. The previously-exposed automation service (cheap, if it survived).
    2. The source service's own NodePort for the 9090 web port — works
       whenever Prometheus is a NodePort/LoadBalancer service (the NCM
       default) and needs no cluster write access.
    3. Last resort: (re)create the NodePort copy and read it back.
    """
    # Refresh the kubeconfig so the direct reads below have a valid context.
    try:
        client.generate_kubeconfig()
    except Exception as e:  # noqa: BLE001
        logger.debug('[prom-rediscover] generate_kubeconfig failed: %s', e)

    try:
        np = _validate_nodeport(client.get_port(exposed_svc, namespace))
        if np:
            return np
    except Exception as e:  # noqa: BLE001
        logger.debug('[prom-rediscover] exposed-svc read failed: %s', e)

    np = _source_svc_nodeport(client, namespace, source_svc, _KUBECTL_SOURCE_PORT)
    if np:
        return np

    try:
        client.expose_service(namespace, source_svc, exposed_svc)
        np = _validate_nodeport(client.get_port(exposed_svc, namespace))
        if np:
            return np
    except Exception as e:  # noqa: BLE001
        logger.debug('[prom-rediscover] re-expose failed: %s', e)

    return None


def _kubectl_rediscover(
    pc_ip: str,
    username: str,
    password: str,
    *,
    namespace: str = _KUBECTL_DEFAULT_NAMESPACE,
    exposed_svc: str = _KUBECTL_DEFAULT_SVC,
    source_svc: str = _KUBECTL_FALLBACK_SVC,
) -> Optional[Dict[str, Any]]:
    """SSH to ``pc_ip`` and ask kubectl for the current Prometheus NodePort.

    Tries to read the NodePort of the exposed automation service first. If
    that service doesn't exist (was deleted), re-runs the ``kubectl expose``
    command and re-reads the port. Always re-resolves the control-plane
    NCM IP via ``get_ncm_ip_and_node`` so a rebooted-and-renumbered NCM VM
    is handled automatically.

    Returns ``{url, ncm_ip, node_port, source}`` on success, ``None`` on
    failure. Never raises — callers should be able to fall back gracefully.
    """
    if not (pc_ip and username and password):
        return None

    try:
        # Import inline so testbeds without credentials never pay the
        # paramiko + ncm_utils import cost.
        from copy_ncm_utils import KubeRemoteClient
    except Exception as e:  # noqa: BLE001
        logger.warning('Prometheus kubectl rediscovery unavailable: %s', e)
        return None

    client: Optional[Any] = None
    try:
        client = KubeRemoteClient(pc_ip, username, password)

        # Discover the live NodePort first — it is the value that actually
        # heals a moved Prometheus. We deliberately gate on the NodePort and
        # NOT on the control-plane IP: the resolver re-pairs this port with
        # the testbed's externally-reachable ncm_ip / pc_ip before probing,
        # so a missing or cluster-internal IP here must not abort the heal.
        node_port = _discover_nodeport(client, namespace, exposed_svc, source_svc)
        if not node_port:
            logger.info('[prom-rediscover] %s: no usable NodePort discovered', pc_ip)
            return None

        # Best-effort control-plane IP; tolerate the noisy/failing lookup.
        ncm_ip: Optional[str] = None
        try:
            raw_ip, _ncm_node = client.get_ncm_ip_and_node()
            ncm_ip = raw_ip if _looks_like_ip(raw_ip) else None
        except Exception as e:  # noqa: BLE001
            logger.debug('[prom-rediscover] %s: get_ncm_ip failed: %s', pc_ip, e)

        base_ip = ncm_ip or pc_ip
        url = f'http://{base_ip}:{node_port}'
        return {'url': url, 'ncm_ip': ncm_ip, 'node_port': node_port, 'source': 'kubectl_rediscover'}
    except Exception as e:  # noqa: BLE001 — never raise out of resolver
        logger.warning('[prom-rediscover] %s: %s', pc_ip, e)
        return None
    finally:
        if client is not None:
            try:
                client.close()
            except Exception:
                pass


# ─────────────────────────────────────────────────────────────────────────────
# Public resolver — backwards-compatible signature
# ─────────────────────────────────────────────────────────────────────────────

def resolve_working_prometheus_url(
    url: Optional[str],
    *,
    testbed: Optional[Dict[str, Any]] = None,
    allow_kubectl: bool = True,
    persist: bool = False,
) -> Optional[str]:
    """Return a Prometheus base URL that responds, preferring the stored URL.

    Parameters
    ----------
    url
        The currently-stored Prometheus URL (may be ``None`` / empty).
    testbed
        Optional testbed dict (as returned by ``Testbed.to_dict()`` or the
        in-process ``_testbed_meta`` helpers). When supplied, enables
        steps 3 (fallback port 9090 on pc_ip/ncm_ip) and 4 (kubectl
        NodePort rediscovery). When ``None``, only the legacy scheme-flip
        behaviour runs — preserving the old single-arg call shape.
    allow_kubectl
        Set False to disable the (relatively expensive) kubectl
        rediscovery step. Useful in hot paths or tests.
    persist
        When True and the resolver returns a URL different from the
        stored one, update ``testbeds.testbed_json['prometheus_url']``
        via ``_persist_resolved_url``. Safe no-op when ``testbed`` is
        missing the ``unique_testbed_id`` key.

    Behaviour preservation
    ----------------------
    * If no candidate responds, returns the original string (best-effort,
      mirrors prior behaviour so callers don't NPE on transient outages).
    * If the input was empty / None and no testbed context can produce a
      candidate, returns ``None``.
    """
    original = (url or '').strip().rstrip('/') or None

    # Fast path: serve from the per-URL TTL cache so a burst of report
    # rebuilds against the same testbed (UI auto-refresh, multiple tabs,
    # ML predictor + report racing) doesn't redo HTTP probes that just
    # answered "yes". The cache key intentionally excludes kubectl flags
    # because the resolved URL is what matters — once we know "this
    # input maps to that working output", the path that found it is
    # irrelevant. ``allow_kubectl=False`` callers can still get a kubectl-
    # discovered URL out of the cache; that's fine, we already paid the
    # cost once.
    cache_key = (original or '<none>')
    cached = _cache_get_resolved(cache_key)
    if cached is not None:
        return cached[0]

    candidates: List[str] = []
    if original:
        candidates.extend(_candidate_urls(original))
    if testbed:
        for cand in _testbed_context_candidates(testbed):
            if cand not in candidates:
                candidates.append(cand)

    for cand in candidates:
        if probe_prometheus(cand):
            resolved = cand.rstrip('/')
            if original and resolved != original:
                logger.info('Prometheus URL resolved: %s -> %s', original, resolved)
            if persist and original and resolved != original:
                _persist_resolved_url(testbed, resolved, source='probe')
            _cache_put_resolved(cache_key, resolved, True)
            return resolved

    # Last resort: ask kubectl what the current NodePort actually is.
    if allow_kubectl and testbed:
        raw = testbed.get('testbed_json') if isinstance(testbed.get('testbed_json'), dict) else {}
        pc_ip = (raw or {}).get('pc_ip') or testbed.get('pc_ip')
        username = testbed.get('username') or (raw or {}).get('username')
        password = testbed.get('password') or (raw or {}).get('password')
        if pc_ip and username and password:
            disc = _kubectl_rediscover(pc_ip, username, password)
            if disc and disc.get('url'):
                discovered = disc['url'].rstrip('/')
                node_port = disc.get('node_port')
                # Build the list of base URLs to probe. kubectl's
                # ``get_ncm_ip_and_node()`` sometimes reports a cluster-INTERNAL
                # node IP (e.g. 192.168.x.x) that the backend can't route to,
                # even though the rediscovered NodePort is correct. So besides
                # the kubectl-reported URL, ALSO pair the rediscovered NodePort
                # with the testbed's externally-reachable IPs captured at
                # onboarding (ncm_ip / pc_ip). This is what lets auto-discovery
                # survive a NodePort change without being defeated by an
                # unreachable internal IP — the recurring "Prometheus not
                # reachable after the port moved" root cause.
                ext_ncm = (raw or {}).get('ncm_ip') or testbed.get('ncm_ip')
                candidate_bases: List[str] = [discovered]
                if node_port and str(node_port).strip().isdigit():
                    for ip in (ext_ncm, pc_ip):
                        if ip:
                            paired = f'http://{ip}:{str(node_port).strip()}'
                            if paired not in candidate_bases:
                                candidate_bases.append(paired)
                # kubectl always returns http://; the NodePort itself may be
                # TLS-terminated (typical NCM setup) so probe both schemes of
                # every candidate base before giving up.
                seen_variants: set = set()
                for base in candidate_bases:
                    for variant in _candidate_urls(base):
                        if variant in seen_variants:
                            continue
                        seen_variants.add(variant)
                        if probe_prometheus(variant):
                            resolved_url = variant.rstrip('/')
                            if original and resolved_url != original:
                                logger.info(
                                    'Prometheus URL rediscovered via kubectl: %s -> %s',
                                    original, resolved_url,
                                )
                            if persist:
                                _persist_resolved_url(testbed, resolved_url, source='kubectl_rediscover')
                            _cache_put_resolved(cache_key, resolved_url, True)
                            return resolved_url
                logger.info(
                    '[prom-rediscover] kubectl returned node_port=%s (bases tried: %s) but no candidate probed healthy; keeping stored URL',
                    node_port, candidate_bases,
                )

    if original:
        logger.warning('Prometheus not reachable with any candidate; keeping configured URL: %s', original)
    # Cache the failure too — with a SHORTER TTL so a freshly-fixed URL
    # is picked up quickly without making every probe pay the slow path.
    # 15s is long enough to absorb a burst of report rebuilds but short
    # enough that the operator sees results within seconds of repairing
    # the testbed's Prometheus.
    _cache_put_resolved(cache_key, original, False, ttl_s=15.0)
    return original


# ─────────────────────────────────────────────────────────────────────────────
# High-level helper for the manual refresh endpoint (Layer B)
# ─────────────────────────────────────────────────────────────────────────────

def refresh_testbed_prometheus(
    testbed_id: str,
    *,
    force_kubectl: bool = True,
) -> Dict[str, Any]:
    """Re-resolve and persist the Prometheus URL for a single testbed.

    Returns a serialisable dict so the API handler can pass it through:
    ``{success, testbed_id, old_url, new_url, healthy, source, error?}``.

    Never raises — failures are encoded in the dict.
    """
    from database import SessionLocal  # local import to avoid cycles at module load
    from models.testbed import Testbed

    session = SessionLocal()
    try:
        row = session.query(Testbed).filter(Testbed.unique_testbed_id == testbed_id).first()
        if not row:
            return {'success': False, 'testbed_id': testbed_id, 'error': 'testbed_not_found'}

        raw = row.testbed_json if isinstance(row.testbed_json, dict) else {}
        if not isinstance(raw, dict):
            raw = {}
        old_url = raw.get('prometheus_url') or raw.get('prometheus_endpoint')

        testbed_ctx = {
            'unique_testbed_id': row.unique_testbed_id,
            'testbed_json': raw,
            'pc_ip': row.pc_ip,
            'ncm_ip': row.ncm_ip,
            'username': row.username,
            'password': row.password,
        }

        # Manual refresh MUST bypass the resolved-URL cache — the whole
        # point of the admin action is to re-discover when the operator
        # knows the URL changed. Drop both the old and new cache entries
        # before/after resolution so the next report rebuild starts cold.
        invalidate_resolved_url_cache(old_url or '<none>')
        new_url = resolve_working_prometheus_url(
            old_url,
            testbed=testbed_ctx,
            allow_kubectl=force_kubectl,
            persist=True,
        )
        invalidate_resolved_url_cache(old_url or '<none>')
        if new_url:
            invalidate_resolved_url_cache(new_url)
        healthy = bool(new_url and probe_prometheus(new_url))

        # Re-read in case persist updated it (we want the value that's
        # actually in the DB row right now). The provenance fields tell
        # us which resolution step actually produced the new URL — much
        # more useful than guessing from the call args.
        session.expire_all()
        row = session.query(Testbed).filter(Testbed.unique_testbed_id == testbed_id).first()
        persisted_tj = (row.testbed_json or {}) if row else {}
        persisted = persisted_tj.get('prometheus_url') or new_url
        source = persisted_tj.get('prometheus_url_resolved_by') or 'unchanged'

        return {
            'success': True,
            'testbed_id': testbed_id,
            'old_url': old_url,
            'new_url': persisted,
            'healthy': healthy,
            'changed': bool(old_url and persisted and old_url != persisted),
            'source': source,
        }
    finally:
        session.close()


# ─────────────────────────────────────────────────────────────────────────────
# Circuit-breaker helper for long-running controllers (Layer C)
# ─────────────────────────────────────────────────────────────────────────────

# Default recovery cooldown — prevents the resolver from SSH-ing to the PC
# on every poll when Prometheus is genuinely down. 10 minutes is short enough
# that a fix lands quickly but long enough that we don't melt the PC.
_RECOVERY_COOLDOWN_S = 600


def attempt_url_recovery(
    current_url: Optional[str],
    testbed: Optional[Dict[str, Any]],
    *,
    last_attempt_ts: float = 0.0,
    cooldown_s: int = _RECOVERY_COOLDOWN_S,
) -> Tuple[Optional[str], float, bool]:
    """Try to self-heal a Prometheus URL that's been failing.

    Designed for in-process callers (the monitor poll loop and the smart-
    execution iteration loop) that hold a long-lived controller and want
    to re-resolve the URL without restarting. Implements three guards so
    we don't melt the PC:

      * cooldown — only one attempt per ``cooldown_s`` (default 10 min)
      * probe-first — if the current URL works right now, skip kubectl
      * persist — if a new URL is discovered, write it to the testbed row
        so subsequent restarts pick up the fix without another kubectl call

    Returns ``(url, attempt_ts, changed)`` where:

      * ``url`` is the URL the caller should use going forward (may be the
        same as ``current_url`` if recovery failed or wasn't attempted)
      * ``attempt_ts`` is the timestamp the caller should store as the
        last-attempt marker
      * ``changed`` is True iff a new working URL was discovered

    Never raises.
    """
    import time as _t

    now = _t.time()
    # Cooldown gate — fail fast without any I/O.
    if now - last_attempt_ts < cooldown_s:
        return current_url, last_attempt_ts, False

    # Fast probe — current URL might just be transiently flaky; skip kubectl
    # entirely if it actually works right now. Cheap (one HTTP call).
    if current_url and probe_prometheus(current_url, timeout=4.0):
        return current_url, now, False

    try:
        resolved = resolve_working_prometheus_url(
            current_url,
            testbed=testbed,
            allow_kubectl=True,
            persist=True,
        )
    except Exception as e:  # noqa: BLE001 — never let recovery break the run
        logger.warning('attempt_url_recovery failed: %s', e)
        return current_url, now, False

    changed = bool(resolved and resolved != (current_url or '').rstrip('/'))
    return (resolved or current_url), now, changed


# ─────────────────────────────────────────────────────────────────────────────
# Persistence helper — writes resolved URL back to testbed JSON
# ─────────────────────────────────────────────────────────────────────────────

def _persist_resolved_url(
    testbed_ctx: Optional[Dict[str, Any]],
    new_url: str,
    *,
    source: str = 'probe',
) -> bool:
    """Write ``new_url`` to ``testbeds.testbed_json['prometheus_url']``.

    Returns True if the row was updated. Best-effort — swallows DB errors
    so the resolver can still return the new URL even if persistence fails.
    """
    if not (testbed_ctx and new_url):
        return False
    testbed_id = testbed_ctx.get('unique_testbed_id')
    if not testbed_id:
        return False

    try:
        from database import SessionLocal
        from models.testbed import Testbed
        from sqlalchemy.orm.attributes import flag_modified
    except Exception as e:  # noqa: BLE001
        logger.debug('persist resolved URL: import failed: %s', e)
        return False

    session = SessionLocal()
    try:
        row = session.query(Testbed).filter(Testbed.unique_testbed_id == testbed_id).first()
        if not row:
            return False
        tj = row.testbed_json
        if isinstance(tj, str):
            import json as _json
            try:
                tj = _json.loads(tj)
            except Exception:
                tj = {}
        if not isinstance(tj, dict):
            tj = {}
        # Only update if it actually changed — avoids row churn on every poll.
        existing = tj.get('prometheus_url')
        if existing == new_url:
            return False
        tj['prometheus_url'] = new_url
        # Also stash provenance + a flipped scheme cache for the resolver.
        tj['prometheus_url_resolved_by'] = source
        from datetime import datetime as _dt
        tj['prometheus_url_resolved_at'] = _dt.utcnow().isoformat() + 'Z'
        row.testbed_json = tj
        flag_modified(row, 'testbed_json')
        session.commit()
        logger.info(
            '[prom-persist] %s: prometheus_url %s -> %s (source=%s)',
            testbed_id,
            existing,
            new_url,
            source,
        )
        return True
    except Exception as e:  # noqa: BLE001
        session.rollback()
        logger.warning('[prom-persist] %s: failed to persist resolved URL: %s', testbed_id, e)
        return False
    finally:
        session.close()
