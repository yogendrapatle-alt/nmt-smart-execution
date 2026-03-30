// src/api/configApi.ts

import { getApiBase } from '../utils/backendUrl';

export async function fetchConfig(pc_ip: string) {
  const backendUrl = getApiBase();
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
