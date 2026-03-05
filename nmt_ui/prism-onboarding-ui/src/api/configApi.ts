// src/api/configApi.ts

export async function fetchConfig(pc_ip: string) {
  // Always use localhost:5000 for backend in development
  const backendUrl = 'http://localhost:5000';
  const response = await fetch(
    `${backendUrl}/api/fetch-config?pc_ip=${encodeURIComponent(pc_ip)}`
  );
  if (!response.ok) {
    let errorMsg = 'Failed to fetch config';
    try {
      const err = await response.json();
      errorMsg = err.error || errorMsg;
    } catch {}
    throw new Error(errorMsg);
  }
  const data = await response.json();
  return data.config;
}
