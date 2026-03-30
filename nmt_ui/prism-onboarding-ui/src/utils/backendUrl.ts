/**
 * Backend API base URL for HTTP calls from the browser.
 *
 * - Default (empty): same-origin — use Vite dev proxy (`/api` → :5000) or nginx in production.
 * - Override: set `VITE_API_BASE_URL` or legacy `VITE_BACKEND_URL` (e.g. `http://host:5000`).
 */

export function getApiBase(): string {
  const raw = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_BACKEND_URL ?? '';
  if (typeof raw !== 'string') return '';
  return raw.replace(/\/$/, '');
}

/** @deprecated Use getApiBase() — kept for existing imports */
export function getAutoBackendUrl(): string {
  return getApiBase();
}

/** @deprecated Use getApiBase() */
export function getBackendUrl(): string {
  return getApiBase();
}

/**
 * Probe common locations for /api/health (optional UI flows).
 */
export async function detectWorkingBackendUrl(): Promise<string> {
  const explicit = getApiBase();
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  candidates.push('');
  candidates.push(`${window.location.protocol}//${window.location.hostname}:5000`);
  candidates.push('http://127.0.0.1:5000');
  candidates.push('http://localhost:5000');

  const seen = new Set<string>();
  for (const base of candidates) {
    if (seen.has(base)) continue;
    seen.add(base);
    const url = base === '' ? '/api/health' : `${base.replace(/\/$/, '')}/api/health`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        return base === '' ? '' : base.replace(/\/$/, '');
      }
    } catch {
      // try next
    }
  }
  return getApiBase();
}
