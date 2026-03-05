import { useState, useMemo } from 'react';
import type { Alert } from '../types/onboarding';

/**
 * Custom hook for searching alerts by description.
 * @param alerts The list of alerts to search.
 */
export function useAlertSearch(alerts: Alert[]) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredAlerts = useMemo(() => {
    if (!searchTerm.trim()) return alerts;
    const lower = searchTerm.toLowerCase();
    return alerts.filter(alert => {
      // Search all string fields in the alert object
      return Object.entries(alert).some(([, value]) => {
        if (typeof value === 'string' || typeof value === 'number') {
          return String(value).toLowerCase().includes(lower);
        }
        // Optionally, search arrays (e.g., emailAddresses)
        if (Array.isArray(value)) {
          return value.some(v => String(v).toLowerCase().includes(lower));
        }
        return false;
      });
    });
  }, [alerts, searchTerm]);

  return { searchTerm, setSearchTerm, filteredAlerts };
}
