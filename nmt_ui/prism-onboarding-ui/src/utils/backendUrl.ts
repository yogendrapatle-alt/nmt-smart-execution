/**
 * Auto-detect backend URL utility
 * This eliminates the need for hardcoded IP addresses
 */

/**
 * Get the backend URL by auto-detecting the current host
 * @returns {string} The backend URL
 */
export function getBackendUrl(): string {
  // If explicitly set in environment, use that
  if (import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL;
  }

  // Auto-detect based on current window location
  const protocol = window.location.protocol; // http: or https:
  const hostname = window.location.hostname; // IP or domain name
  
  // Use the same host as the frontend, but port 5000 for backend
  return `${protocol}//${hostname}:5000`;
}

/**
 * Alternative method: Try multiple possible backend URLs
 * @returns {Promise<string>} The working backend URL
 */
export async function detectWorkingBackendUrl(): Promise<string> {
  const possibleUrls = [
    // Try environment variable first
    import.meta.env.VITE_BACKEND_URL,
    // Try same host as frontend
    `${window.location.protocol}//${window.location.hostname}:5000`,
    // Fallback to localhost
    'http://localhost:5000',
    // Try common internal network ranges
    'http://127.0.0.1:5000',
  ].filter(Boolean); // Remove undefined values

  for (const url of possibleUrls) {
    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch(`${url}/api/health`, { 
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        console.log(`✅ Found working backend at: ${url}`);
        return url;
      }
    } catch (error) {
      console.log(`❌ Backend not reachable at: ${url}`);
    }
  }

  // If nothing works, use the first URL as fallback
  const fallback = possibleUrls[0] || 'http://localhost:5000';
  console.warn(`⚠️ No backend found, using fallback: ${fallback}`);
  return fallback;
}

/**
 * Simple method - use localhost for development, auto-detect for production
 */
export function getAutoBackendUrl(): string {
  // If environment variable is set, use it
  if (import.meta.env.VITE_BACKEND_URL) {
    console.log('getAutoBackendUrl: Using VITE_BACKEND_URL:', import.meta.env.VITE_BACKEND_URL);
    return import.meta.env.VITE_BACKEND_URL;
  }

  const { protocol, hostname } = window.location;
  console.log('getAutoBackendUrl:', { protocol, hostname });
  
  // If accessing via localhost or 127.0.0.1, use localhost for backend
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:5000';
  }
  
  // Otherwise use the same hostname (for production/VM deployments)
  return `${protocol}//${hostname}:5000`;
}
