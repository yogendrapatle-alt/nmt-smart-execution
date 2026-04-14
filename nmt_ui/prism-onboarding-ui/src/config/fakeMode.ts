/**
 * Fake Data Mode Configuration
 * 
 * This module controls whether the application runs in FAKE DATA MODE.
 * 
 * FAKE MODE is for DEMO purposes only:
 * - Displays realistic fake data
 * - NO backend calls made
 * - NO database impact
 * - 100% frontend-only
 * 
 * To enable:
 *   Create .env.local with: VITE_FAKE_DATA_MODE=true
 * 
 * To disable:
 *   Remove the line or set: VITE_FAKE_DATA_MODE=false
 * 
 * GUARANTEE: When disabled, app behaves EXACTLY as before.
 */

export const IS_FAKE_MODE = import.meta.env.VITE_FAKE_DATA_MODE === 'true';

// Log mode on startup (helps debugging)
if (IS_FAKE_MODE && import.meta.env.DEV) {
  console.log('%cFAKE DATA MODE ENABLED', 'color: #ff9800; font-size: 14px; font-weight: bold;');
}

export default IS_FAKE_MODE;
