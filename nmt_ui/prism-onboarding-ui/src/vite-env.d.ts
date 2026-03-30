/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Explicit API origin, e.g. http://10.x.x.x:5000 — omit for same-origin (proxy/nginx) */
  readonly VITE_API_BASE_URL?: string;
  /** Legacy alias for VITE_API_BASE_URL */
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
