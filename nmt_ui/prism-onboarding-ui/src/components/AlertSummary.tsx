import React, { useState, useEffect } from 'react';
import type { Alert, AlertDigest } from '../types/onboarding';
import { PDFExportButton } from './PDFExportButton';
import { sortAlerts, SORTABLE_COLUMNS } from '../utils/summary_sort';
import { AlertDetailModal } from './AlertDetailModel';
import MultiUserEmailSchedule from './MultiUserEmailSchedule';
import { useAlertSearch } from '../hooks/useAlertSearch';
import { getApiBase } from '../utils/backendUrl';

const AlertSummary: React.FC = () => {
  const [alertDigests, setAlertDigests] = useState<AlertDigest[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTestbed, setSelectedTestbed] = useState<string>('');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('time');

  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage] = useState<number>(10);

  // Phase 6: when ON, collapse repeats of the same (rule, pod) into one row
  // so the "lots of slack messages" feedback stops applying to the UI too.
  // Default OFF to preserve existing user expectations.
  const [groupByPodRule, setGroupByPodRule] = useState<boolean>(false);

  const [prometheusEndpoint, setPrometheusEndpoint] = useState<string>('');

  useEffect(() => {
    const backendUrl = getApiBase();
    fetch(`${backendUrl}/api/prometheus-port`)
      .then(res => res.json())
      .then(data => {
        if (data.host_ip && data.host_port) {
          setPrometheusEndpoint(`http://${data.host_ip}:${data.host_port}`);
        } else {
          setPrometheusEndpoint('http://localhost:9090');
        }
      })
      .catch(() => setPrometheusEndpoint('http://localhost:9090'));
  }, []);

  const fetchAlerts = async () => {
    setLoading(true);
    setError('');
    try {
      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/alerts`);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Alerts API failed (${response.status}): ${errorText}`);
      }
      const result = await response.json();

      if (!result.alerts || result.alerts.length === 0) {
        setAlertDigests([]);
        return;
      }

      const grouped: { [date: string]: { [testbed: string]: Alert[] } } = {};
      result.alerts.forEach((alert: any) => {
        const date = alert.timestamp ? new Date(alert.timestamp).toLocaleDateString('en-CA', { timeZone: 'UTC' }) : 'unknown-date';
        const testbed = alert.testbed || 'default';
        if (!grouped[date]) grouped[date] = {};
        if (!grouped[date][testbed]) grouped[date][testbed] = [];
        grouped[date][testbed].push(alert);
      });
      const digests = Object.keys(grouped).sort((a, b) => b.localeCompare(a)).map(date => ({
        date,
        testbeds: grouped[date]
      }));

      setAlertDigests(digests);
      if (digests.length > 0) setSelectedDate(digests[0].date);
      setSelectedTestbed('');
    } catch (err) {
      console.error('Error fetching alerts:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch alerts');
      setAlertDigests([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (prometheusEndpoint && prometheusEndpoint.trim()) fetchAlerts();
  }, [prometheusEndpoint]);

  const handleAlertClick = (alert: Alert) => { setSelectedAlert(alert); setIsModalOpen(true); };
  const handleModalClose = () => { setIsModalOpen(false); setSelectedAlert(null); };

  const normalizeStatus = (status: string) => status.toLowerCase() === 'firing' ? 'Active' : status;

  const filteredAlerts = React.useMemo(() => {
    const selectedDigest = alertDigests.find(digest => digest.date === selectedDate);
    if (!selectedDigest) return [];

    let alerts: Alert[] = selectedTestbed === '' ? Object.values(selectedDigest.testbeds).flat() : selectedDigest.testbeds[selectedTestbed] || [];
    alerts = alerts.map(alert => ({ ...alert, status: normalizeStatus(alert.status) }));
    if (selectedSeverity !== 'All') alerts = alerts.filter(a => a.severity.toLowerCase() === selectedSeverity.toLowerCase());
    if (selectedStatus !== 'All') alerts = alerts.filter(a => normalizeStatus(a.status).toLowerCase() === selectedStatus.toLowerCase());
    return sortAlerts(alerts, sortBy);
  }, [alertDigests, selectedDate, selectedTestbed, selectedSeverity, selectedStatus, sortBy]);

  const { searchTerm, setSearchTerm, filteredAlerts: searchFilteredAlerts } = useAlertSearch(filteredAlerts);

  const totalItems = searchFilteredAlerts.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedAlerts = searchFilteredAlerts.slice(startIndex, endIndex);

  React.useEffect(() => { setCurrentPage(1); }, [selectedDate, selectedTestbed, selectedSeverity, selectedStatus, sortBy, groupByPodRule]);
  React.useEffect(() => { setSelectedTestbed(''); }, [selectedDate]);

  const getTestbedOptions = () => {
    const selectedDigest = alertDigests.find(digest => digest.date === selectedDate);
    return selectedDigest ? Object.keys(selectedDigest.testbeds) : [];
  };

  const totalAlerts = alertDigests.reduce((sum, d) => sum + Object.values(d.testbeds).flat().length, 0);
  const activeCount = filteredAlerts.filter(a => a.status === 'Active').length;
  const criticalCount = filteredAlerts.filter(a => a.severity === 'Critical').length;

  // Phase 6 KPI: distinct (rule, pod) offenders vs total alerts. Big delta
  // means the same pods are firing the same rule over and over → consistent
  // with Phase 5's first-fire-then-silent gating story for Slack.
  const distinctOffenders = React.useMemo(() => {
    const set = new Set<string>();
    for (const a of filteredAlerts) {
      const key = `${a.ruleName}::${a.namespace || ''}::${a.podName || ''}`;
      set.add(key);
    }
    return set.size;
  }, [filteredAlerts]);
  const repeatAlertCount = Math.max(0, filteredAlerts.length - distinctOffenders);

  // When grouping is ON, fold the per-iteration rows into one row per
  // (rule, pod) showing first-seen / last-seen / firing-count / max-severity.
  type GroupedAlert = {
    key: string;
    ruleName: string;
    podName: string;
    namespace: string;
    severity: 'Low' | 'Moderate' | 'Critical';
    fireCount: number;
    firstSeen: string;
    lastSeen: string;
    statusLatest: string;
    representative: Alert; // for the detail-modal click-through
  };

  const SEV_RANK: Record<string, number> = { low: 0, moderate: 1, critical: 2 };

  const groupedAlerts = React.useMemo<GroupedAlert[]>(() => {
    if (!groupByPodRule) return [];
    const buckets = new Map<string, GroupedAlert>();
    for (const a of searchFilteredAlerts) {
      const key = `${a.ruleName}::${a.namespace || ''}::${a.podName || ''}`;
      const existing = buckets.get(key);
      const ts = a.timestamp || '';
      if (!existing) {
        buckets.set(key, {
          key,
          ruleName: a.ruleName,
          podName: a.podName || '',
          namespace: a.namespace || '',
          severity: a.severity,
          fireCount: 1,
          firstSeen: ts,
          lastSeen: ts,
          statusLatest: a.status,
          representative: a,
        });
      } else {
        existing.fireCount += 1;
        if (ts && ts < existing.firstSeen) existing.firstSeen = ts;
        if (ts && ts > existing.lastSeen) {
          existing.lastSeen = ts;
          existing.statusLatest = a.status;
          existing.representative = a;
        }
        const incomingRank = SEV_RANK[(a.severity || '').toLowerCase()] ?? 1;
        const currentRank = SEV_RANK[(existing.severity || '').toLowerCase()] ?? 1;
        if (incomingRank > currentRank) existing.severity = a.severity;
      }
    }
    // Sort: critical first, then highest fireCount.
    return Array.from(buckets.values()).sort((x, y) => {
      const sx = SEV_RANK[(x.severity || '').toLowerCase()] ?? 1;
      const sy = SEV_RANK[(y.severity || '').toLowerCase()] ?? 1;
      if (sy !== sx) return sy - sx;
      return y.fireCount - x.fireCount;
    });
  }, [searchFilteredAlerts, groupByPodRule]);

  const groupedTotalItems = groupedAlerts.length;
  const groupedTotalPages = Math.ceil(groupedTotalItems / itemsPerPage);
  const groupedPaginated = groupByPodRule
    ? groupedAlerts.slice(startIndex, endIndex)
    : [];

  return (
    <div className="main-content">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-3">
        <div>
          <h2 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' }}>
              <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>notification_important</i>
            </div>
            Alert Summary
          </h2>
          <p className="text-muted mb-0" style={{ maxWidth: 700 }}>
            View and filter alerts collected from Prometheus across your testbeds. Alerts are triggered when resource metrics (CPU, memory, disk) exceed configured thresholds. Click any alert row for details.
          </p>
        </div>
        <div className="d-flex gap-2 align-items-center">
          <button className="btn btn-primary btn-sm rounded-3 d-flex align-items-center gap-1" onClick={fetchAlerts} disabled={loading}>
            {loading ? <><span className="spinner-border spinner-border-sm"></span> Loading...</> : <><i className="material-icons-outlined" style={{ fontSize: 18 }}>refresh</i>Refresh</>}
          </button>
        </div>
      </div>

      {/* Quick stat cards (Phase 6: now includes "Distinct Offenders" + "Repeats"
          so a tester can see at a glance whether 200 alerts are 200 distinct
          problems or one problem firing 200 times). */}
      {!loading && alertDigests.length > 0 && (
        <div className="row g-3 mb-4">
          {[
            { icon: 'notifications', label: 'Total Alerts', value: totalAlerts, color: '#3b82f6', sub: `Across ${alertDigests.length} days` },
            { icon: 'error', label: 'Active Now', value: activeCount, color: activeCount > 0 ? '#ef4444' : '#22c55e', sub: activeCount > 0 ? 'Require attention' : 'All clear' },
            { icon: 'warning', label: 'Critical', value: criticalCount, color: criticalCount > 0 ? '#dc2626' : '#22c55e', sub: criticalCount > 0 ? 'High priority' : 'No critical alerts' },
            { icon: 'fingerprint', label: 'Distinct Offenders', value: distinctOffenders, color: '#0ea5e9', sub: 'Unique (rule × pod) combos' },
            { icon: 'replay', label: 'Repeated Alerts', value: repeatAlertCount, color: repeatAlertCount > 0 ? '#f59e0b' : '#22c55e', sub: repeatAlertCount > 0 ? 'Same issue re-firing' : 'All alerts are first-time' },
            { icon: 'dns', label: 'Testbeds', value: getTestbedOptions().length, color: '#8b5cf6', sub: 'With alerts today' },
          ].map((c, i) => (
            <div className="col-6 col-md-4 col-lg-2" key={i}>
              <div className="card rounded-4 border shadow-none h-100">
                <div className="card-body d-flex align-items-center gap-3 p-3">
                  <div className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0" style={{ width: 44, height: 44, background: `${c.color}15` }}>
                    <i className="material-icons-outlined" style={{ fontSize: 24, color: c.color }}>{c.icon}</i>
                  </div>
                  <div>
                    <div className="text-muted small">{c.label}</div>
                    <div className="fw-bold fs-4" style={{ color: c.color }}>{c.value}</div>
                    <div className="text-muted" style={{ fontSize: '0.72rem' }}>{c.sub}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="card rounded-4 border shadow-none mb-4">
          <div className="card-body text-center py-5">
            <div className="spinner-border text-primary mb-3" style={{ width: '2.5rem', height: '2.5rem' }}><span className="visually-hidden">Loading...</span></div>
            <p className="text-muted mb-0">Fetching alerts from database...</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="alert alert-danger rounded-3 d-flex align-items-center gap-2 mb-4" role="alert">
          <i className="material-icons-outlined" style={{ fontSize: 20 }}>error</i>
          <div className="flex-grow-1">{error}</div>
          <button className="btn btn-danger btn-sm rounded-3" onClick={fetchAlerts}>Retry</button>
        </div>
      )}

      {!loading && (
        <>
          {/* Filters */}
          <div className="card rounded-4 border shadow-none mb-4">
            <div className="card-body p-4">
              <h6 className="fw-semibold mb-3 d-flex align-items-center gap-2">
                <i className="material-icons-outlined text-muted" style={{ fontSize: 20 }}>filter_list</i>
                Filters
              </h6>
              <div className="row g-3">
                <div className="col-md-2">
                  <label className="form-label fw-medium small">Date</label>
                  <select value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="form-select form-select-sm rounded-3">
                    {alertDigests.map(digest => (
                      <option key={digest.date} value={digest.date}>
                        {new Date(digest.date + 'T00:00:00.000Z').toLocaleDateString('en-US', { timeZone: 'UTC' })}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label fw-medium small">Testbed</label>
                  <select value={selectedTestbed} onChange={e => setSelectedTestbed(e.target.value)} className="form-select form-select-sm rounded-3">
                    <option value="">All Testbeds</option>
                    {getTestbedOptions().map(tb => <option key={tb} value={tb}>{tb}</option>)}
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label fw-medium small">Severity</label>
                  <select value={selectedSeverity} onChange={e => setSelectedSeverity(e.target.value)} className="form-select form-select-sm rounded-3">
                    <option value="All">All</option>
                    <option value="Critical">Critical</option>
                    <option value="Moderate">Moderate</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label fw-medium small">Status</label>
                  <select value={selectedStatus} onChange={e => setSelectedStatus(e.target.value)} className="form-select form-select-sm rounded-3">
                    <option value="All">All</option>
                    <option value="Active">Active</option>
                    <option value="Resolved">Resolved</option>
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label fw-medium small">Sort by</label>
                  <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="form-select form-select-sm rounded-3">
                    <option value="time">Time (Latest)</option>
                    <option value="severity">Severity</option>
                    <option value="status">Status</option>
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label fw-medium small">Search</label>
                  <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search alerts..." className="form-control form-control-sm rounded-3" />
                </div>
                {/* Phase 6: Group toggle — collapse repeats of (rule × pod). */}
                <div className="col-md-2 d-flex align-items-end">
                  <div className="form-check form-switch">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      role="switch"
                      id="groupByPodRule"
                      checked={groupByPodRule}
                      onChange={(e) => setGroupByPodRule(e.target.checked)}
                    />
                    <label
                      className="form-check-label small fw-medium"
                      htmlFor="groupByPodRule"
                      title="Collapse alerts firing repeatedly for the same rule + pod into one row with first/last seen timestamps and a fire count."
                    >
                      Group by Pod + Rule
                      {groupByPodRule && (
                        <span className="badge bg-info text-dark ms-1" style={{ fontSize: '0.62rem' }}>{groupedTotalItems} groups</span>
                      )}
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Testbed Overview - only when "All Testbeds" and multiple testbeds exist */}
          {selectedDate && !selectedTestbed && getTestbedOptions().length > 1 && (
            <div className="row g-3 mb-4">
              {getTestbedOptions().map(testbed => {
                const testbedAlerts = (alertDigests.find(d => d.date === selectedDate)?.testbeds[testbed] || []).map(a => ({ ...a, status: normalizeStatus(a.status) }));
                const active = testbedAlerts.filter(a => a.status === 'Active').length;
                const critical = testbedAlerts.filter(a => a.severity === 'Critical').length;
                return (
                  <div className="col-md-3 col-lg-2" key={testbed}>
                    <div className="card rounded-4 shadow-none h-100 border" style={{ cursor: 'pointer', transition: 'all 0.15s' }} onClick={() => setSelectedTestbed(testbed)}>
                      <div className="card-body p-3 text-center">
                        <div className="fw-semibold small mb-1 text-truncate" title={testbed}>{testbed}</div>
                        <div className="fw-bold fs-5 text-primary">{testbedAlerts.length}</div>
                        <div className="d-flex justify-content-center gap-1 mt-1 flex-wrap">
                          {active > 0 && <span className="badge bg-danger rounded-pill" style={{ fontSize: '0.65rem' }}>{active} active</span>}
                          {critical > 0 && <span className="badge bg-dark rounded-pill" style={{ fontSize: '0.65rem' }}>{critical} critical</span>}
                          {active === 0 && critical === 0 && <span className="badge bg-success rounded-pill" style={{ fontSize: '0.65rem' }}>clear</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Selected testbed info bar */}
          {selectedTestbed && (() => {
            const tbAlerts = (alertDigests.find(d => d.date === selectedDate)?.testbeds[selectedTestbed] || []).map(a => ({ ...a, status: normalizeStatus(a.status) }));
            const tbActive = tbAlerts.filter(a => a.status === 'Active').length;
            const tbCritical = tbAlerts.filter(a => a.severity === 'Critical').length;
            const tbResolved = tbAlerts.filter(a => a.status === 'Resolved').length;
            return (
              <div className="d-flex align-items-center gap-3 mb-4 p-3 rounded-3" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                <div className="d-flex align-items-center justify-content-center rounded-3" style={{ width: 36, height: 36, background: '#3b82f6' }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 18 }}>dns</i>
                </div>
                <div className="flex-grow-1">
                  <div className="fw-semibold" style={{ fontSize: '0.88rem' }}>{selectedTestbed}</div>
                  <div className="d-flex gap-2 mt-1">
                    <span className="badge bg-primary rounded-pill" style={{ fontSize: '0.68rem' }}>{tbAlerts.length} total</span>
                    {tbActive > 0 && <span className="badge bg-danger rounded-pill" style={{ fontSize: '0.68rem' }}>{tbActive} active</span>}
                    {tbCritical > 0 && <span className="badge bg-dark rounded-pill" style={{ fontSize: '0.68rem' }}>{tbCritical} critical</span>}
                    {tbResolved > 0 && <span className="badge bg-success rounded-pill" style={{ fontSize: '0.68rem' }}>{tbResolved} resolved</span>}
                  </div>
                </div>
                <button className="btn btn-sm btn-outline-primary rounded-3 d-flex align-items-center gap-1" onClick={() => setSelectedTestbed('')}>
                  <i className="material-icons-outlined" style={{ fontSize: 16 }}>close</i>Show All
                </button>
              </div>
            );
          })()}

          {/* Alerts Table */}
          <div className="card rounded-4 border shadow-none mb-4">
            <div className="card-header bg-transparent border-bottom p-4">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <h6 className="mb-0 fw-semibold">
                    Alerts for {selectedDate ? new Date(selectedDate + 'T00:00:00.000Z').toLocaleDateString('en-US', { timeZone: 'UTC' }) : 'No Date'}
                    {selectedTestbed && ` — ${selectedTestbed}`}
                  </h6>
                  {searchFilteredAlerts.length > 0 && (
                    <span className="text-muted small">
                      {groupByPodRule ? (
                        <>
                          {groupedTotalItems} unique offender{groupedTotalItems !== 1 ? 's' : ''} (from {searchFilteredAlerts.length} firing{searchFilteredAlerts.length !== 1 ? 's' : ''})
                          {searchTerm && ` matching "${searchTerm}"`}
                          {groupedTotalPages > 1 && ` — Page ${currentPage} of ${groupedTotalPages}`}
                        </>
                      ) : (
                        <>
                          {searchFilteredAlerts.length} alert{searchFilteredAlerts.length !== 1 ? 's' : ''}
                          {searchTerm && ` matching "${searchTerm}"`}
                          {totalPages > 1 && ` — Page ${currentPage} of ${totalPages}`}
                        </>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="card-body p-0">
              {searchFilteredAlerts.length === 0 ? (
                <div className="text-center py-5">
                  <i className="material-icons-outlined text-muted mb-2" style={{ fontSize: 48, opacity: 0.3 }}>
                    {alertDigests.length === 0 ? 'notifications_off' : 'search_off'}
                  </i>
                  {alertDigests.length === 0 ? (
                    <div>
                      <p className="fw-semibold mb-1">No alerts found</p>
                      <p className="text-muted small mb-0" style={{ maxWidth: 400, margin: '0 auto' }}>
                        No alert rules are currently firing or have recently resolved. This is normal when your cluster is healthy.
                      </p>
                    </div>
                  ) : searchTerm ? (
                    <div>
                      <p className="fw-semibold mb-1">No matches for "{searchTerm}"</p>
                      <p className="text-muted small mb-0">Try adjusting your search term or clearing filters.</p>
                    </div>
                  ) : (
                    <p className="text-muted mb-0">No alerts match the current filters.</p>
                  )}
                </div>
              ) : groupByPodRule ? (
                /* Phase 6: grouped view — one row per (rule, pod), shows
                   first-seen / last-seen / fire-count so a tester can see
                   "200 alerts = 5 unique problems each firing 40 times". */
                <div className="table-responsive">
                  <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: '0.82rem' }}>
                    <thead className="table-light">
                      <tr>
                        <th className="px-3 py-3">Severity</th>
                        <th className="px-3 py-3">Latest Status</th>
                        <th className="px-3 py-3">Rule</th>
                        <th className="px-3 py-3">Pod / Namespace</th>
                        <th className="px-3 py-3 text-center">Fires</th>
                        <th className="px-3 py-3">First Seen</th>
                        <th className="px-3 py-3">Last Seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedPaginated.map((g) => {
                        const isCriticalActive = g.severity === 'Critical' && g.statusLatest === 'Active';
                        return (
                          <tr
                            key={g.key}
                            onClick={() => handleAlertClick(g.representative)}
                            style={{ cursor: 'pointer', borderLeft: isCriticalActive ? '3px solid #dc2626' : undefined }}
                          >
                            <td className="px-3">
                              <span className={`badge rounded-pill ${g.severity === 'Critical' ? 'bg-danger' : g.severity === 'Moderate' ? 'bg-warning text-dark' : 'bg-success'}`}>
                                {g.severity}
                              </span>
                            </td>
                            <td className="px-3">
                              <span className={`badge rounded-pill ${g.statusLatest === 'Active' ? 'bg-danger' : g.statusLatest === 'Resolved' ? 'bg-success' : 'bg-secondary'}`}>
                                {g.statusLatest}
                              </span>
                            </td>
                            <td className="px-3 fw-medium">{g.ruleName}</td>
                            <td className="px-3">
                              <code className="small d-block" title={g.podName}>{g.podName || '—'}</code>
                              <span className="text-muted" style={{ fontSize: '0.7rem' }}>{g.namespace || '—'}</span>
                            </td>
                            <td className="px-3 text-center">
                              <span className={`badge rounded-pill ${g.fireCount > 10 ? 'bg-danger' : g.fireCount > 1 ? 'bg-warning text-dark' : 'bg-secondary'}`}>
                                {g.fireCount}×
                              </span>
                            </td>
                            <td className="px-3 small">
                              {g.firstSeen ? new Date(g.firstSeen).toLocaleString('en-US', { timeZone: 'UTC' }) : '—'}
                            </td>
                            <td className="px-3 small">
                              {g.lastSeen ? new Date(g.lastSeen).toLocaleString('en-US', { timeZone: 'UTC' }) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: '0.82rem' }}>
                    <thead className="table-light">
                      <tr>
                        {SORTABLE_COLUMNS.map(col => (
                          <th key={col.key} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} className="px-3 py-3" onClick={() => setSortBy(col.key)}>
                            {col.label} {sortBy === col.key && <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>arrow_downward</i>}
                          </th>
                        ))}
                        <th className="px-3 py-3">Alert Name</th>
                        {/* Phase 6: explicit Pod / Namespace column — was buried in
                            the Diagnosis text before, easy to miss. */}
                        <th className="px-3 py-3">Pod / Namespace</th>
                        <th className="px-3 py-3">Duration</th>
                        <th className="px-3 py-3" style={{ minWidth: 220 }}>Diagnosis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedAlerts.map((alert, idx) => {
                        const isCriticalActive = alert.severity === 'Critical' && alert.status === 'Active';
                        const durMin = alert.duration_minutes;
                        const durLabel = durMin != null
                          ? (durMin < 1 ? `${Math.round(durMin * 60)}s` : durMin < 60 ? `${Math.round(durMin)}m` : `${Math.floor(durMin / 60)}h ${Math.round(durMin % 60)}m`)
                          : null;
                        return (
                          <tr
                            key={`${alert.id}-${idx}`}
                            onClick={() => handleAlertClick(alert)}
                            style={{ cursor: 'pointer', borderLeft: isCriticalActive ? '3px solid #dc2626' : undefined }}
                          >
                            <td className="px-3">
                              <div className="fw-medium">{new Date(alert.timestamp).toLocaleDateString('en-US', { timeZone: 'UTC' })}</div>
                              <div className="text-muted" style={{ fontSize: '0.72rem' }}>{new Date(alert.timestamp).toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })} UTC</div>
                            </td>
                            <td className="px-3">
                              <span className={`badge rounded-pill ${alert.severity === 'Critical' ? 'bg-danger' : alert.severity === 'Moderate' ? 'bg-warning text-dark' : 'bg-success'}`}>
                                {alert.severity}
                              </span>
                            </td>
                            <td className="px-3">
                              <span className={`badge rounded-pill ${alert.status === 'Active' ? 'bg-danger' : alert.status === 'Resolved' ? 'bg-success' : 'bg-secondary'}`}>
                                {alert.status}
                              </span>
                            </td>
                            <td className="px-3 fw-medium">
                              {alert.ruleName}
                              {alert.is_actionable && <span className="badge bg-danger ms-2" style={{ fontSize: '0.62rem' }}>NEEDS ATTENTION</span>}
                              {alert.source_monitor_id && (
                                <span
                                  className="badge ms-2"
                                  style={{ background: '#0ea5e9', color: 'white', fontSize: '0.62rem' }}
                                  title={`Produced by monitor-only session ${alert.source_monitor_id}`}>
                                  monitor: {alert.source_monitor_name || alert.source_monitor_id}
                                </span>
                              )}
                            </td>
                            <td className="px-3">
                              {alert.podName ? (
                                <>
                                  <code className="small d-block" title={alert.podName}>{alert.podName}</code>
                                  <span className="text-muted" style={{ fontSize: '0.7rem' }}>{alert.namespace || '—'}</span>
                                </>
                              ) : (
                                <span className="text-muted small">{alert.namespace || '—'}</span>
                              )}
                            </td>
                            <td className="px-3 text-center text-nowrap">
                              {durLabel ? (
                                <span className="small">{durLabel}</span>
                              ) : (
                                <span className="badge bg-danger rounded-pill" style={{ fontSize: '0.68rem' }}>Active</span>
                              )}
                            </td>
                            <td className="px-3 text-muted" style={{ maxWidth: 280, lineHeight: 1.4 }}>
                              {alert.short_diagnosis || alert.description || 'Click for details'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Pagination — uses the appropriate total based on grouping toggle. */}
          {(() => {
            const pageTotal = groupByPodRule ? groupedTotalPages : totalPages;
            const itemTotal = groupByPodRule ? groupedTotalItems : totalItems;
            if (pageTotal <= 1) return null;
            return (
              <div className="d-flex justify-content-center align-items-center gap-2 mb-4">
                <button className="btn btn-outline-primary btn-sm rounded-3" onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1}>Previous</button>
                {Array.from({ length: Math.min(pageTotal, 7) }, (_, i) => {
                  let page: number;
                  if (pageTotal <= 7) {
                    page = i + 1;
                  } else if (currentPage <= 4) {
                    page = i + 1;
                  } else if (currentPage >= pageTotal - 3) {
                    page = pageTotal - 6 + i;
                  } else {
                    page = currentPage - 3 + i;
                  }
                  return (
                    <button
                      key={page}
                      className={`btn btn-sm rounded-3 ${currentPage === page ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => setCurrentPage(page)}
                      style={{ minWidth: 36 }}
                    >
                      {page}
                    </button>
                  );
                })}
                <button className="btn btn-outline-primary btn-sm rounded-3" onClick={() => setCurrentPage(p => Math.min(p + 1, pageTotal))} disabled={currentPage === pageTotal}>Next</button>
                <span className="text-muted small ms-2">Showing {startIndex + 1}–{Math.min(endIndex, itemTotal)} of {itemTotal}{groupByPodRule ? ' offenders' : ' alerts'}</span>
              </div>
            );
          })()}

          {/* Email Schedule */}
          <MultiUserEmailSchedule
            currentFilters={{ selectedDate, selectedTestbed, selectedSeverity, selectedStatus }}
          />

          {/* Export buttons */}
          <div className="d-flex justify-content-center gap-3 mt-4 flex-wrap">
            <PDFExportButton
              alerts={searchFilteredAlerts}
              selectedDate={selectedDate}
              selectedTestbed={selectedTestbed}
              selectedSeverity={selectedSeverity}
              selectedStatus={selectedStatus}
              disabled={loading}
            />
            <button
              onClick={() => {
                const params = new URLSearchParams();
                if (selectedTestbed) params.append('testbed', selectedTestbed);
                if (selectedSeverity !== 'All') params.append('severity', selectedSeverity);
                if (selectedStatus !== 'All') params.append('status', selectedStatus);
                if (selectedDate) params.append('date', selectedDate);
                window.open(`${getApiBase()}/api/alerts/download-html?${params.toString()}`, '_blank');
              }}
              disabled={loading || searchFilteredAlerts.length === 0}
              className="btn btn-sm rounded-3 d-flex align-items-center gap-1"
              style={{ background: searchFilteredAlerts.length === 0 ? '#ccc' : 'linear-gradient(135deg, #667eea, #764ba2)', color: '#fff', border: 'none' }}
            >
              <i className="material-icons-outlined" style={{ fontSize: 18 }}>download</i>
              Download HTML Report
            </button>
          </div>
        </>
      )}

      {/* Alert Detail Modal */}
      {selectedAlert && <AlertDetailModal alert={selectedAlert} isOpen={isModalOpen} onClose={handleModalClose} />}
    </div>
  );
};

export default AlertSummary;
