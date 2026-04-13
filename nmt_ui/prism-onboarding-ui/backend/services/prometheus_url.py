"""
Resolve a working Prometheus base URL when stored config uses the wrong scheme
(e.g. http:// when the server only speaks HTTPS — common for NCM nodePort exposes).
"""

from __future__ import annotations

import logging
from typing import List, Optional
from urllib.parse import urljoin

import requests

logger = logging.getLogger(__name__)


def _candidate_urls(base: str) -> List[str]:
    """Prefer HTTPS when the stored URL is HTTP (TLS-terminated Prometheus)."""
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


def probe_prometheus(base_url: str, timeout: float = 8.0) -> bool:
    """True if /api/v1/query?query=up returns Prometheus success JSON."""
    try:
        q = urljoin(base_url.rstrip('/') + '/', 'api/v1/query')
        r = requests.get(q, params={'query': 'up'}, verify=False, timeout=timeout)
        if r.status_code != 200:
            return False
        data = r.json()
        return data.get('status') == 'success'
    except Exception:
        return False


def resolve_working_prometheus_url(url: Optional[str]) -> Optional[str]:
    """
    Return a URL that responds to a minimal Prometheus instant query.
    Tries HTTPS first when the stored URL is HTTP.
    If nothing responds, returns the original string (best-effort for air-gapped/debug).
    """
    if not url or not str(url).strip():
        return None
    original = str(url).strip().rstrip('/')
    for cand in _candidate_urls(original):
        if probe_prometheus(cand):
            if cand.rstrip('/') != original:
                logger.info('Prometheus URL resolved: %s -> %s', original, cand)
            return cand.rstrip('/')
    logger.warning('Prometheus not reachable with any scheme; keeping configured URL: %s', original)
    return original
