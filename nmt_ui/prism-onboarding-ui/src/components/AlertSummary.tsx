import React, { useState, useEffect } from 'react';
import ntnxLogo from '../assets/new_nutanix_logo.png';
import type { Alert, AlertDigest } from '../types/onboarding';
import { useNavigate } from 'react-router-dom';
import { PDFExportButton } from './PDFExportButton';
import { sortAlerts, SORTABLE_COLUMNS } from '../utils/summary_sort';
import { AlertDetailModal } from './AlertDetailModel';
import MultiUserEmailSchedule from './MultiUserEmailSchedule';
import { useAlertSearch } from '../hooks/useAlertSearch';
import { getApiBase } from '../utils/backendUrl';



const AlertSummary: React.FC = () => {
  const navigate = useNavigate();
    // No longer need onboarding context since we get prometheusEndpoint from backend
  const [alertDigests, setAlertDigests] = useState<AlertDigest[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTestbed, setSelectedTestbed] = useState<string>('');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingProgress, setLoadingProgress] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('time');
  
  // Modal state
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage] = useState<number>(10);
  
  // Prometheus endpoint override - PRIMARY DATA SOURCE
  const [prometheusEndpoint, setPrometheusEndpoint] = useState<string>(''); // Always set from backend

  useEffect(() => {
    // Fetch the host_ip and host_port from backend - always use localhost:5000 in development
    const backendUrl = getApiBase();
    fetch(`${backendUrl}/api/prometheus-port`)
      .then(res => res.json())
      .then(data => {
        if (data.host_ip && data.host_port) {
          setPrometheusEndpoint(`http://${data.host_ip}:${data.host_port}`);
        } else {
          // fallback or error handling
          setPrometheusEndpoint('http://localhost:9090');
        }
      })
      .catch(() => setPrometheusEndpoint('http://localhost:9090'));
  }, []);

  
  // ...existing code...

  // Removed alert detail modal state


  // Fetch alerts from backend database API
  const fetchAlerts = async () => {
    setLoading(true);
    setError('');
    setLoadingProgress('Fetching alerts from database...');

    try {
      // Build query params for filters (add more as needed)
      const params = new URLSearchParams();
      if (selectedSeverity !== 'All') params.append('severity', selectedSeverity);
      if (selectedStatus !== 'All') params.append('status', selectedStatus);
      // Pagination can be added here if needed

      // Always use localhost:5000 for backend in development
      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/alerts?${params.toString()}`);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Alerts API failed with status ${response.status}: ${errorText}`);
      }
      setLoadingProgress('Processing alert data...');
      const result = await response.json();

      if (!result.alerts || result.alerts.length === 0) {
        setAlertDigests([]);
        setLoadingProgress('✅ Successfully connected - No alerts found');
        return;
      }

      // Group alerts by date and testbed for compatibility with existing UI
      const grouped: { [date: string]: { [testbed: string]: Alert[] } } = {};
      result.alerts.forEach((alert: any) => {
        // Use UTC date to avoid timezone issues
        const date = alert.timestamp ? new Date(alert.timestamp).toLocaleDateString('en-CA', { timeZone: 'UTC' }) : 'unknown-date';
        const testbed = alert.testbed || 'default';
        if (!grouped[date]) grouped[date] = {};
        if (!grouped[date][testbed]) grouped[date][testbed] = [];
        grouped[date][testbed].push(alert);
      });
      const alertDigests = Object.keys(grouped).sort((a, b) => b.localeCompare(a)).map(date => ({
        date,
        testbeds: grouped[date]
      }));

      setAlertDigests(alertDigests);
      if (alertDigests.length > 0) {
        setSelectedDate(alertDigests[0].date);
      }
      setLoadingProgress('✅ Successfully loaded alerts from database');
    } catch (err) {
      console.error('Error fetching alerts from database:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch alerts from database';
      setError(errorMessage);
      setLoadingProgress('❌ Alerts API connection failed');
      setAlertDigests([]);
    } finally {
      setLoading(false);
      setTimeout(() => setLoadingProgress(''), 2000);
    }
  };

  // Fetch alerts only after prometheusEndpoint is set
  useEffect(() => {
    if (prometheusEndpoint && prometheusEndpoint.trim()) {
      fetchAlerts();
    }
  }, [prometheusEndpoint]);

  // Handle alert row click to open detail modal
  const handleAlertClick = (alert: Alert) => {
    setSelectedAlert(alert);
    setIsModalOpen(true);
  };

  // Handle modal close
  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedAlert(null);
  };  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'Critical': return '#dc3545';
      case 'Moderate': return '#fd7e14';
      case 'Low': return '#28a745';
      default: return '#6c757d';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active': return '#dc3545'; // Red
      case 'Pending': return '#fd7e14'; // Orange
      case 'Resolved': return '#28a745'; // Green
      default: return '#6c757d'; // Gray
    }
  };


  // Normalize status: treat 'firing' as 'Active' everywhere in the UI
  const normalizeStatus = (status: string) => {
    if (status.toLowerCase() === 'firing') return 'Active';
    return status;
  };

  const filteredAlerts = React.useMemo(() => {
    const selectedDigest = alertDigests.find(digest => digest.date === selectedDate);
    if (!selectedDigest) return [];

    let alerts: Alert[] = [];
    if (selectedTestbed === '') {
      alerts = Object.values(selectedDigest.testbeds).flat();
    } else {
      alerts = selectedDigest.testbeds[selectedTestbed] || [];
    }

    // Normalize status for all alerts
    alerts = alerts.map(alert => ({ ...alert, status: normalizeStatus(alert.status) }));

    // Apply severity filter (case-insensitive)
    if (selectedSeverity !== 'All') {
      alerts = alerts.filter(alert => alert.severity.toLowerCase() === selectedSeverity.toLowerCase());
    }

    // Apply status filter (case-insensitive)
    if (selectedStatus !== 'All') {
      alerts = alerts.filter(alert => normalizeStatus(alert.status).toLowerCase() === selectedStatus.toLowerCase());
    }

    // Use modular sort
    return sortAlerts(alerts, sortBy);
  }, [alertDigests, selectedDate, selectedTestbed, selectedSeverity, selectedStatus, sortBy]);

  // Apply search filter using the custom hook
  const { searchTerm, setSearchTerm, filteredAlerts: searchFilteredAlerts } = useAlertSearch(filteredAlerts);

  // Pagination calculations
  const totalItems = searchFilteredAlerts.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedAlerts = searchFilteredAlerts.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [selectedDate, selectedTestbed, selectedSeverity, selectedStatus, sortBy]);

  const getTestbedOptions = () => {
    const selectedDigest = alertDigests.find(digest => digest.date === selectedDate);
    if (!selectedDigest) return [];
    return Object.keys(selectedDigest.testbeds);
  };

  const inputStyle: React.CSSProperties = {
    padding: '8px 12px',
    border: '1px solid #ccc',
    borderRadius: 4,
    fontSize: 14,
    backgroundColor: '#fff',
    color: '#000'
  };

  return (
    <div className="main-content">
      {/* Breadcrumb */}
      <div className="d-flex align-items-center mb-4">
        <nav aria-label="breadcrumb">
          <ol className="breadcrumb mb-0">
            <li className="breadcrumb-item">
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }}>
                <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle' }}>home</i>
              </a>
            </li>
            <li className="breadcrumb-item active">Alert Summary</li>
          </ol>
        </nav>
      </div>

      <div className="card rounded-4 border-0 shadow-sm" style={{ padding: 40, overflow: 'hidden' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 90,
            height: 90,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)'
          }}>
            <img src={ntnxLogo} alt="Nutanix Logo" style={{ width: 55, height: 55, objectFit: 'contain' }} />
          </div>
          <h2 style={{ color: '#00008B', marginTop: 0, marginBottom: 10, fontWeight: 700, letterSpacing: '-0.5px', fontSize: 32 }}>Alert Summary</h2>
          <p className="text-muted mb-0" style={{ fontSize: 16 }}>Monitor and manage alerts from your testbeds</p>
        </div>

        {/* Refresh Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
          <button
            type="button"
            onClick={fetchAlerts}
            disabled={loading}
            className="btn btn-success"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderRadius: 8,
              padding: '10px 24px',
              fontWeight: 600,
              fontSize: 15,
              boxShadow: loading ? 'none' : '0 2px 8px rgba(40,167,69,0.25)'
            }}
          >
            <i className="material-icons-outlined" style={{ fontSize: 20 }}>refresh</i>
            {loading ? 'Loading...' : 'Refresh Alerts'}
          </button>
        </div>

        {/* Loading State */}
        {loading && (
          <div style={{ 
            textAlign: 'center', 
            padding: 32, 
            color: '#666',
            backgroundColor: '#f8f9fa',
            borderRadius: 8,
            border: '1px solid #dee2e6'
          }}>
            <div style={{ fontSize: 16, marginBottom: 8 }}>🔄 Loading alerts...</div>
            {loadingProgress && (
              <div style={{ 
                fontSize: 14, 
                color: '#007bff',
                fontWeight: 500,
                marginTop: 8,
                padding: '8px 16px',
                backgroundColor: '#e7f3ff',
                borderRadius: 4,
                border: '1px solid #b3d9ff',
                display: 'inline-block'
              }}>
                {loadingProgress}
              </div>
            )}
            <div style={{ 
              fontSize: 12, 
              color: '#999', 
              marginTop: 16,
              fontStyle: 'italic',
              lineHeight: 1.4
            }}>
              ⏱️ This may take some time to complete...
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div style={{ 
            textAlign: 'center', 
            padding: 20, 
            color: '#dc3545',
            backgroundColor: '#f8d7da',
            borderRadius: 8,
            border: '1px solid #f5c6cb',
            marginBottom: 16
          }}>
            ❌ {error}
            <div style={{ marginTop: 8 }}>
              <button
                onClick={fetchAlerts}
                style={{
                  background: '#dc3545',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '8px 16px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontSize: 14
                }}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {!loading && (
          <>

        {/* Email Scheduling Section */}
        {/* <div style={{ 
          padding: 20, 
          backgroundColor: '#f0f8ff', 
          borderRadius: 8,
          border: '1px solid #b3d9ff',
          marginBottom: 20
        }}>
          <h4 style={{ marginBottom: 16, color: '#333', display: 'flex', alignItems: 'center', gap: 8 }}>
            📧 Email Report Scheduling
          </h4>
          
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={emailScheduleEnabled}
                onChange={(e) => setEmailScheduleEnabled(e.target.checked)}
                style={{ transform: 'scale(1.2)' }}
              />
              <span style={{ fontWeight: 600, color: '#333' }}>Enable daily email reports</span>
            </label>
          </div>

          {emailScheduleEnabled && (
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
              gap: 16, 
              marginBottom: 16 
            }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, color: '#333' }}>Email Addresses *</label>
                {emailAddresses.map((email, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <input
                      type="email"
                      value={email}
                      onChange={e => {
                        const newEmails = [...emailAddresses];
                        newEmails[idx] = e.target.value;
                        setEmailAddresses(newEmails);
                      }}
                      placeholder="Enter email address"
                      style={{ ...inputStyle, flex: 1 }}
                      required
                    />
                    {emailAddresses.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setEmailAddresses(emailAddresses.filter((_, i) => i !== idx))}
                        style={{
                          background: '#dc3545',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 4,
                          padding: '4px 10px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontSize: 14
                        }}
                        title="Remove this email address"
                      >
                        ✖
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setEmailAddresses([...emailAddresses, ''])}
                  style={{
                    background: '#0078d4',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    padding: '6px 14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: 14,
                    marginTop: 4
                  }}
                >
                  ➕ Add Email
                </button>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, color: '#333' }}>Schedule Time</label>
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, color: '#333' }}>Timezone</label>
                <select
                  value={scheduleTimezone}
                  onChange={(e) => setScheduleTimezone(e.target.value)}
                  style={inputStyle}
                >
                  {getTimezoneOptions().map(tz => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, color: '#333' }}>Severity Filter</label>
                <select
                  value={emailSeverityFilter}
                  onChange={(e) => setEmailSeverityFilter(e.target.value)}
                  style={inputStyle}
                >
                  <option value="All">All Severities</option>
                  <option value="Critical">Critical</option>
                  <option value="Moderate">Moderate</option>
                  <option value="Moderate">Moderate & Above</option>
                  <option value="Moderate">Moderate & Below</option>
                  <option value="Low">Low</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, color: '#333' }}>Testbed Filter</label>
                <select
                  value={emailTestbedFilter}
                  onChange={(e) => setEmailTestbedFilter(e.target.value)}
                  style={inputStyle}
                >
                  <option value="All">All Testbeds</option>
                  {getTestbedOptions().map(testbed => (
                    <option key={testbed} value={testbed}>{testbed}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              onClick={handleScheduleEmail}
              disabled={emailScheduleEnabled && emailAddresses.every(e => !e.trim())}
              style={{
                background: emailScheduleEnabled && emailAddresses.every(e => !e.trim()) ? '#ccc' : '#28a745',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '10px 20px',
                fontWeight: 600,
                cursor: emailScheduleEnabled && emailAddresses.every(e => !e.trim()) ? 'not-allowed' : 'pointer',
                fontSize: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              {emailScheduleEnabled ? '📅 Schedule Email' : '🚫 Disable Schedule'}
            </button>

            {scheduleSuccess && (
              <div style={{ 
                color: '#28a745', 
                fontSize: 14, 
                fontWeight: 500,
                padding: '8px 12px',
                backgroundColor: '#d4edda',
                borderRadius: 4,
                border: '1px solid #c3e6cb'
              }}>
                ✅ {scheduleSuccess}
              </div>
            )}

            {scheduleError && (
              <div style={{ 
                color: '#dc3545', 
                fontSize: 14, 
                fontWeight: 500,
                padding: '8px 12px',
                backgroundColor: '#f8d7da',
                borderRadius: 4,
                border: '1px solid #f5c6cb'
              }}>
                ❌ {scheduleError}
              </div>
            )}
          </div>

          {emailScheduleEnabled && (
            <div style={{ 
              marginTop: 12, 
              padding: 12, 
              backgroundColor: '#fff3cd', 
              borderRadius: 4,
              border: '1px solid #ffeaa7',
              fontSize: 13,
              color: '#856404'
            }}>
              📝 <strong>Note:</strong> You will receive a daily email report with alerts matching your filter criteria at the specified time.
            </div>
          )}
        </div> */}

        {/* Filters Section */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
          gap: 16, 
          padding: 24, 
          background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)', 
          borderRadius: 12,
          border: '1px solid #dee2e6',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
          marginBottom: 24
        }}>
          <div>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#333', fontSize: 14 }}>
              <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 4, color: '#0078d4' }}>calendar_today</i>
              Select Date
            </label>
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="form-control"
              style={{ borderRadius: 8, border: '1px solid #dee2e6', padding: '10px 12px', fontSize: 14 }}
            >
              {alertDigests.map(digest => (
                <option key={digest.date} value={digest.date}>
                  {new Date(digest.date + 'T00:00:00.000Z').toLocaleDateString('en-US', { timeZone: 'UTC' })}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#333', fontSize: 14 }}>
              <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 4, color: '#0078d4' }}>dns</i>
              Select Testbed
            </label>
            <select
              value={selectedTestbed}
              onChange={(e) => setSelectedTestbed(e.target.value)}
              className="form-control"
              style={{ borderRadius: 8, border: '1px solid #dee2e6', padding: '10px 12px', fontSize: 14 }}
            >
              <option value="">All Testbeds</option>
              {getTestbedOptions().map(testbed => (
                <option key={testbed} value={testbed}>{testbed}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#333', fontSize: 14 }}>
              <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 4, color: '#0078d4' }}>warning</i>
              Filter by Severity
            </label>
            <select
              value={selectedSeverity}
              onChange={(e) => setSelectedSeverity(e.target.value)}
              className="form-control"
              style={{ borderRadius: 8, border: '1px solid #dee2e6', padding: '10px 12px', fontSize: 14 }}
            >
              <option value="All">All Severities</option>
              <option value="Critical">Critical</option>
              <option value="Moderate">Moderate</option>
              <option value="Low">Low</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#333', fontSize: 14 }}>
              <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 4, color: '#0078d4' }}>info</i>
              Filter by Status
            </label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="form-control"
              style={{ borderRadius: 8, border: '1px solid #dee2e6', padding: '10px 12px', fontSize: 14 }}
            >
              <option value="All">All Status</option>
              <option value="Active">Active</option>
              {/* <option value="Pending">Pending</option> */}
              <option value="Resolved">Resolved</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#333', fontSize: 14 }}>
              <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 4, color: '#0078d4' }}>sort</i>
              Sort by
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="form-control"
              style={{ borderRadius: 8, border: '1px solid #dee2e6', padding: '10px 12px', fontSize: 14 }}
            >
              <option value="time">Time (Latest First)</option>
              <option value="severity">Severity (Critical First)</option>
              <option value="status">Status (Active First)</option>
              {/* <option value="rule">Rule Name (A-Z)</option>
              <option value="pod">Pod Name (A-Z)</option>
              <option value="namespace">Namespace (A-Z)</option> */}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#333', fontSize: 14 }}>
              <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 4, color: '#0078d4' }}>search</i>
              Search
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search alerts..."
              className="form-control"
              style={{
                borderRadius: 8,
                border: '1px solid #dee2e6',
                padding: '10px 12px',
                fontSize: 14
              }}
            />
          </div>
        </div>

        {/* Summary Stats */}
        {selectedDate && (
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
            gap: 20,
            marginBottom: 24
          }}>
            {getTestbedOptions().map(testbed => {
              const testbedAlerts = (alertDigests.find(d => d.date === selectedDate)?.testbeds[testbed] || []).map(a => ({ ...a, status: normalizeStatus(a.status) }));

              const activeCount = testbedAlerts.filter(a => a.status === 'Active').length;
              const pendingCount = testbedAlerts.filter(a => a.status === 'Pending').length;
              const resolvedCount = testbedAlerts.filter(a => a.status === 'Resolved').length;
              const criticalCount = testbedAlerts.filter(a => a.severity === 'Critical').length;

              return (
                <div key={testbed} className="card" style={{
                  border: selectedTestbed === testbed ? '2px solid #0078d4' : '1px solid #dee2e6',
                  borderRadius: 12,
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  background: selectedTestbed === testbed ? 'linear-gradient(135deg, #e6f0fa 0%, #ffffff 100%)' : '#fff',
                  boxShadow: selectedTestbed === testbed ? '0 4px 12px rgba(0,120,212,0.2)' : '0 2px 8px rgba(0,0,0,0.06)'
                }} onClick={() => setSelectedTestbed(selectedTestbed === testbed ? '' : testbed)}>
                  <div className="card-body p-4">
                    <h4 style={{ margin: '0 0 12px 0', color: '#333', fontWeight: 700, fontSize: 18 }}>{testbed}</h4>
                    <div style={{ fontSize: 36, fontWeight: 'bold', color: '#0078d4', lineHeight: 1, marginBottom: 8 }}>{testbedAlerts.length}</div>
                    <div style={{ fontSize: 13, color: '#666', fontWeight: 500, marginBottom: 12 }}>Total Alerts</div>
                    <div style={{ fontSize: 13, marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                      {activeCount > 0 && <span className="badge bg-danger" style={{ fontSize: 12, padding: '4px 8px' }}>🔴 {activeCount} Active</span>}
                      {pendingCount > 0 && <span className="badge bg-warning" style={{ fontSize: 12, padding: '4px 8px' }}>⏳ {pendingCount} Pending</span>}
                      {resolvedCount > 0 && <span className="badge bg-success" style={{ fontSize: 12, padding: '4px 8px' }}>✅ {resolvedCount} Resolved</span>}
                      {criticalCount > 0 && <span className="badge bg-danger" style={{ fontSize: 12, padding: '4px 8px' }}>⚠️ {criticalCount} Critical</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Alerts Table */}
        <div style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 16, color: '#333' }}>
            Alerts for {selectedDate ? new Date(selectedDate + 'T00:00:00.000Z').toLocaleDateString('en-US', { timeZone: 'UTC' }) : 'No Date Selected'}
            {selectedTestbed && ` - ${selectedTestbed}`}
            {searchFilteredAlerts.length > 0 && (
              <span>
                {` (${searchFilteredAlerts.length} total alerts`}
                {searchTerm && ` matching "${searchTerm}"`}
                {totalPages > 1 && ` - Page ${currentPage} of ${totalPages}`}
                {`)`}
              </span>
            )}
          </h4>
          
          {/* Table explanation */}
          <div style={{ 
            marginBottom: 16, 
            padding: 12, 
            backgroundColor: '#e8f4fd', 
            borderRadius: 4,
            border: '1px solid #bee5eb',
            fontSize: 13,
            color: '#0c5460'
          }}>
            💡 <strong>Click on any row</strong> to view detailed alert information including summary, description, and trigger time.
          </div>
          
          {searchFilteredAlerts.length === 0 ? (
            <div style={{ 
              textAlign: 'center', 
              padding: 32, 
              color: '#666',
              backgroundColor: '#f8f9fa',
              borderRadius: 8,
              border: '1px solid #dee2e6'
            }}>
              {alertDigests.length === 0 ? (
                <div>
                  <div style={{ fontSize: 16, marginBottom: 8 }}>🎯 No alerts found</div>
                  <div style={{ fontSize: 14, color: '#856404', lineHeight: 1.5 }}>
                    This is normal if:
                    <ul style={{ textAlign: 'left', display: 'inline-block', marginTop: 8 }}>
                      <li>No alert rules are currently firing</li>
                      <li>No alerts have been resolved in the last 24 hours</li>
                      <li>Alert rules are not configured in Prometheus</li>
                      <li>The ALERTS metric is not available</li>
                    </ul>
                  </div>
                </div>
              ) : searchTerm ? (
                <div>
                  <div style={{ fontSize: 16, marginBottom: 8 }}>🔍 No alerts found matching "{searchTerm}"</div>
                  <div style={{ fontSize: 14, color: '#666' }}>
                    Try adjusting your search term or clearing the search to see all alerts.
                  </div>
                </div>
              ) : (
                "No alerts found for the selected criteria."
              )}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #dee2e6', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <table className="table table-hover mb-0" style={{ 
                  width: '100%', 
                  borderCollapse: 'collapse',
                  backgroundColor: '#fff'
                }}>
                  <thead style={{ background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)' }}>
                    <tr>
                    {/* <th style={{ border: '1px solid #dee2e6', padding: 12, textAlign: 'center', fontWeight: 600, color: '#333' }}>Time</th>
                    <th style={{ border: '1px solid #dee2e6', padding: 12, textAlign: 'center', fontWeight: 600, color: '#333' }}>Severity</th>
                    <th style={{ border: '1px solid #dee2e6', padding: 12, textAlign: 'center', fontWeight: 600, color: '#333' }}>Status</th> */}
                      {SORTABLE_COLUMNS.map(col => (
                        <th
                          key={col.key}
                          style={{
                            cursor: 'pointer',
                            textAlign: 'center',
                            fontWeight: 700,
                            color: '#333',
                            borderBottom: '2px solid #dee2e6',
                            padding: 16,
                            fontSize: 14,
                            textDecoration: sortBy === col.key ? 'underline' : 'none',
                            textUnderlineOffset: sortBy === col.key ? '6px' : undefined,
                            textDecorationThickness: sortBy === col.key ? '2px' : undefined
                          }}
                          onClick={() => setSortBy(col.key)}
                        >
                          {col.label}
                        </th>
                      ))}
                      <th style={{ borderBottom: '2px solid #dee2e6', padding: 16, textAlign: 'center', fontWeight: 700, color: '#333', fontSize: 14 }}>Alert Name</th>
                      <th style={{ borderBottom: '2px solid #dee2e6', padding: 16, textAlign: 'center', fontWeight: 700, color: '#333', fontSize: 14 }}>Summary</th>
                      <th style={{ borderBottom: '2px solid #dee2e6', padding: 16, textAlign: 'center', fontWeight: 700, color: '#333', fontSize: 14 }}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedAlerts.map((alert, idx) => (
                      <tr 
                        key={`${alert.id}-${idx}`} 
                        style={{ 
                          backgroundColor: idx % 2 === 0 ? '#fff' : '#f8f9fa',
                          transition: 'background-color 0.2s ease',
                          cursor: 'pointer'
                        }}
                        onClick={() => handleAlertClick(alert)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#e8f4fd';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#fff' : '#f8f9fa';
                        }}
                      >
                        <td style={{ border: '1px solid #dee2e6', padding: 14, fontSize: 13, color: '#000', verticalAlign: 'middle' }}>
                          <div style={{ fontWeight: 600 }}>{new Date(alert.timestamp).toLocaleDateString('en-US', { timeZone: 'UTC' })}</div>
                          <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>{new Date(alert.timestamp).toLocaleTimeString('en-US', { 
                            hour12: true, 
                            hour: 'numeric', 
                            minute: '2-digit',
                            timeZone: 'UTC'
                          })} UTC</div>
                        </td>
                        <td style={{ border: '1px solid #dee2e6', padding: 14, verticalAlign: 'middle' }}>
                          <span className="badge" style={{ 
                            padding: '6px 12px', 
                            borderRadius: 6, 
                            fontSize: 12, 
                            fontWeight: 600,
                            color: '#fff',
                            backgroundColor: getSeverityColor(alert.severity)
                          }}>
                            {alert.severity}
                          </span>
                        </td>
                        <td style={{ border: '1px solid #dee2e6', padding: 14, verticalAlign: 'middle' }}>
                          <span className="badge" style={{ 
                            padding: '6px 12px', 
                            borderRadius: 6, 
                            fontSize: 12, 
                            fontWeight: 600,
                            color: '#fff',
                            backgroundColor: getStatusColor(alert.status)
                          }}>
                            {alert.status}
                          </span>
                        </td>
                        <td style={{ border: '1px solid #dee2e6', padding: 14, fontWeight: 600, color: '#000', verticalAlign: 'middle' }}>{alert.ruleName}</td>
                        <td style={{ border: '1px solid #dee2e6', padding: 14, color: '#000', verticalAlign: 'middle' }}>{alert.summary || 'N/A'}</td>
                        <td style={{ border: '1px solid #dee2e6', padding: 14, color: '#000', maxWidth: 200, verticalAlign: 'middle' }}>{alert.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          
          {/* Pagination Controls */}
          {searchFilteredAlerts.length > itemsPerPage && (
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center', 
              gap: 16, 
              marginTop: 20,
              padding: '16px 0'
            }}>
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                style={{
                  background: currentPage === 1 ? '#ccc' : '#0078d4',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '8px 16px',
                  fontWeight: 500,
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  fontSize: 14
                }}
              >
                ← Previous
              </button>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {(() => {
                  const pageButtons = [];
                  const maxVisiblePages = 5; // Show max 5 page numbers
                  
                  if (totalPages <= maxVisiblePages + 2) {
                    // Show all pages if total is small
                    for (let i = 1; i <= totalPages; i++) {
                      pageButtons.push(
                        <button
                          key={i}
                          onClick={() => setCurrentPage(i)}
                          style={{
                            background: currentPage === i ? '#0078d4' : '#fff',
                            color: currentPage === i ? '#fff' : '#0078d4',
                            border: '1px solid #0078d4',
                            borderRadius: 4,
                            padding: '8px 12px',
                            fontWeight: 500,
                            cursor: 'pointer',
                            fontSize: 14,
                            minWidth: 40
                          }}
                        >
                          {i}
                        </button>
                      );
                    }
                  } else {
                    // Complex pagination with ellipsis
                    // Always show page 1
                    pageButtons.push(
                      <button
                        key={1}
                        onClick={() => setCurrentPage(1)}
                        style={{
                          background: currentPage === 1 ? '#0078d4' : '#fff',
                          color: currentPage === 1 ? '#fff' : '#0078d4',
                          border: '1px solid #0078d4',
                          borderRadius: 4,
                          padding: '8px 12px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          fontSize: 14,
                          minWidth: 40
                        }}
                      >
                        1
                      </button>
                    );
                    
                    // Show ellipsis if current page is far from start
                    if (currentPage > 4) {
                      pageButtons.push(
                        <span key="start-ellipsis" style={{ padding: '8px 4px', color: '#666' }}>...</span>
                      );
                    }
                    
                    // Show pages around current page
                    const startPage = Math.max(2, currentPage - 1);
                    const endPage = Math.min(totalPages - 1, currentPage + 1);
                    
                    for (let i = startPage; i <= endPage; i++) {
                      if (i !== 1 && i !== totalPages) {
                        pageButtons.push(
                          <button
                            key={i}
                            onClick={() => setCurrentPage(i)}
                            style={{
                              background: currentPage === i ? '#0078d4' : '#fff',
                              color: currentPage === i ? '#fff' : '#0078d4',
                              border: '1px solid #0078d4',
                              borderRadius: 4,
                              padding: '8px 12px',
                              fontWeight: 500,
                              cursor: 'pointer',
                              fontSize: 14,
                              minWidth: 40
                            }}
                          >
                            {i}
                          </button>
                        );
                      }
                    }
                    
                    // Show ellipsis if current page is far from end
                    if (currentPage < totalPages - 3) {
                      pageButtons.push(
                        <span key="end-ellipsis" style={{ padding: '8px 4px', color: '#666' }}>...</span>
                      );
                    }
                    
                    // Always show last page
                    if (totalPages > 1) {
                      pageButtons.push(
                        <button
                          key={totalPages}
                          onClick={() => setCurrentPage(totalPages)}
                          style={{
                            background: currentPage === totalPages ? '#0078d4' : '#fff',
                            color: currentPage === totalPages ? '#fff' : '#0078d4',
                            border: '1px solid #0078d4',
                            borderRadius: 4,
                            padding: '8px 12px',
                            fontWeight: 500,
                            cursor: 'pointer',
                            fontSize: 14,
                            minWidth: 40
                          }}
                        >
                          {totalPages}
                        </button>
                      );
                    }
                  }
                  
                  return pageButtons;
                })()}
              </div>
              
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                style={{
                  background: currentPage === totalPages ? '#ccc' : '#0078d4',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '8px 16px',
                  fontWeight: 500,
                  cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                  fontSize: 14
                }}
              >
                Next →
              </button>
              
              <div style={{ 
                marginLeft: 16, 
                fontSize: 14, 
                color: '#666',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}>
                Showing {startIndex + 1}-{Math.min(endIndex, totalItems)} of {totalItems} alerts
              </div>
            </div>
          )}
        </div>

            {/* Multi-User Email Schedule Section - Uses current page filters */}
            <MultiUserEmailSchedule 
              // Pass current filter state so email scheduling uses the same filters as the page
              currentFilters={{
                selectedDate,
                selectedTestbed,
                selectedSeverity,
                selectedStatus
              }}
            />

            {/* PDF Export Button */}

            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 24 }}>
              <PDFExportButton
                alerts={searchFilteredAlerts}
                selectedDate={selectedDate}
                selectedTestbed={selectedTestbed}
                selectedSeverity={selectedSeverity}
                selectedStatus={selectedStatus}
                disabled={loading}
              />

              {/* Your existing CSV export button can stay here */}
            </div>

        {/* Export/Download Button */}
        {/* <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
          <button
            onClick={() => {
              const csvContent = [
                ['Date', 'Time', 'Testbed', 'Severity', 'Status', 'Rule', 'Summary', 'Pod', 'Namespace', 'Query', 'Condition', 'Description'],
                ...filteredAlerts.map(alert => [
                  selectedDate,
                  new Date(alert.timestamp).toLocaleTimeString(),
                  selectedTestbed || 'All',
                  alert.severity,
                  alert.status,
                  alert.ruleName,
                  alert.summary || 'N/A',
                  alert.podName,
                  alert.namespace,
                  alert.metric,
                  `${alert.value} ${alert.operator} ${alert.threshold}`,
                  alert.description
                ])
              ].map(row => row.join(',')).join('\n');
              
              const blob = new Blob([csvContent], { type: 'text/csv' });
              const url = window.URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `alert-summary-${selectedDate}${selectedTestbed ? `-${selectedTestbed}` : ''}.csv`;
              link.click();
              window.URL.revokeObjectURL(url);
            }}
            style={{
              background: '#0078d4',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '12px 24px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            📥 Export to CSV
          </button>
        </div> */}
        </>
        )}

        {/* Alert Detail Modal */}
        {selectedAlert && (
          <AlertDetailModal
            alert={selectedAlert}
            isOpen={isModalOpen}
            onClose={handleModalClose}
          />
        )}

        {/* Alert detail modal removed */}
      </div>
    </div>
  );
};

export default AlertSummary;
