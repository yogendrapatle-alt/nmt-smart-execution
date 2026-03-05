// src/utils/summary_sort.ts

import type { Alert } from '../types/onboarding';

// Severity order for sorting: Critical > Moderate > Low
const severityOrder: Record<string, number> = {
  'critical': 3,
  'moderate': 2,
  'low': 1,
};

export function normalizeStatus(status: string): string {
  if (status.toLowerCase() === 'firing') return 'Active';
  return status;
}

export function sortAlerts(alerts: Alert[], sortBy: string): Alert[] {
  return [...alerts].sort((a, b) => {
    switch (sortBy) {
      case 'time':
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      case 'pod':
        return a.podName.localeCompare(b.podName);
      case 'namespace':
        return a.namespace.localeCompare(b.namespace);
      case 'severity': {
        const aSeverity = (a.severity || '').toLowerCase();
        const bSeverity = (b.severity || '').toLowerCase();
        return (severityOrder[bSeverity] || 0) - (severityOrder[aSeverity] || 0);
      }
      case 'status':
        return normalizeStatus(a.status).localeCompare(normalizeStatus(b.status));
      case 'rule':
        return a.ruleName.localeCompare(b.ruleName);
      default:
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    }
  });
}

export const SORTABLE_COLUMNS = [
  { key: 'time', label: 'Time' },
  { key: 'severity', label: 'Severity' },
  { key: 'status', label: 'Status' },
  // Add more if needed
];