import React, { useState } from 'react';
import { getAutoBackendUrl } from '../utils/backendUrl';

interface EmailSchedule {
  id: number;
  userEmail: string;
  scheduleName: string;
  emailAddresses: string[];
  enabled: boolean;
  scheduleTime: string;
  timezone: string;
  subject?: string;
  filters: any;
  createdAt: string;
  updatedAt: string;
  lastExecutedAt?: string;
  lastExecutionStatus?: string;
  executionError?: string;
}

interface MultiUserEmailScheduleProps {
  currentFilters?: {
    selectedDate: string;
    selectedTestbed: string;
    selectedSeverity: string;
    selectedStatus: string;
  };
}

const MultiUserEmailSchedule: React.FC<MultiUserEmailScheduleProps> = ({ 
  currentFilters
}) => {
  const [userEmail, setUserEmail] = useState<string>('');
  const [schedules, setSchedules] = useState<EmailSchedule[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [success, setSuccess] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);
  
  // Form state for creating new schedule
  const [newSchedule, setNewSchedule] = useState({
    scheduleName: '',
    emailAddresses: [''],
    scheduleTime: '09:00',
    timezone: 'UTC',
    subject: 'Daily Alert Report'
  });

  const clearMessages = () => {
    setSuccess('');
    setError('');
  };

  const formatFilters = (filters: any) => {
    if (!filters) return 'No filters applied';
    
    const filterParts = [];
    
    if (filters.severity && filters.severity !== 'all') {
      filterParts.push(`Severity: ${filters.severity.charAt(0).toUpperCase() + filters.severity.slice(1)}`);
    }
    
    if (filters.status && filters.status !== 'all') {
      filterParts.push(`Status: ${filters.status.charAt(0).toUpperCase() + filters.status.slice(1)}`);
    }
    
    if (filters.testbed && filters.testbed !== 'all') {
      filterParts.push(`Testbed: ${filters.testbed}`);
    }
    
    return filterParts.length > 0 ? filterParts.join(', ') : 'No filters applied';
  };

  const loadUserSchedules = async (email: string) => {
    if (!email.trim()) {
      setSchedules([]);
      return;
    }

    setLoading(true);
    clearMessages();

    try {
      const backendUrl = getAutoBackendUrl();
      const response = await fetch(`${backendUrl}/api/user-schedules?userEmail=${encodeURIComponent(email)}`);
      
      if (!response.ok) {
        throw new Error(`Failed to load schedules: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        setSchedules(result.schedules || []);
      } else {
        setError(result.error || 'Failed to load schedules');
        setSchedules([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user schedules');
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  };

  const createSchedule = async () => {
    const trimmedEmails = newSchedule.emailAddresses.map(e => e.trim()).filter(e => e);
    
    if (!userEmail.trim() || !userEmail.includes('@')) {
      setError('Please enter a valid user email address');
      return;
    }
    
    if (!newSchedule.scheduleName.trim()) {
      setError('Please enter a schedule name');
      return;
    }
    
    if (trimmedEmails.length === 0) {
      setError('Please enter at least one recipient email address');
      return;
    }

    for (const email of trimmedEmails) {
      if (!email.includes('@')) {
        setError(`Invalid email address: ${email}`);
        return;
      }
    }

    setLoading(true);
    clearMessages();

    try {
      const scheduleData = {
        userEmail: userEmail.trim(),
        scheduleName: newSchedule.scheduleName.trim(),
        emailAddresses: trimmedEmails,
        enabled: true,
        scheduleTime: newSchedule.scheduleTime,
        timezone: newSchedule.timezone,
        subject: newSchedule.subject.trim() || 'Daily Alert Report',
        filters: {
          severity: currentFilters?.selectedSeverity?.toLowerCase() || 'all',
          status: currentFilters?.selectedStatus?.toLowerCase() || 'all',
          testbed: currentFilters?.selectedTestbed || 'all'
        }
      };

      const backendUrl = getAutoBackendUrl();
      const response = await fetch(`${backendUrl}/api/schedule-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(scheduleData)
      });

      const result = await response.json();

      if (result.success) {
        setSuccess(`✅ Schedule "${newSchedule.scheduleName}" created successfully`);
        setShowCreateForm(false);
        setNewSchedule({
          scheduleName: '',
          emailAddresses: [''],
          scheduleTime: '09:00',
          timezone: 'UTC',
          subject: 'Daily Alert Report'
        });
        // Reload schedules
        await loadUserSchedules(userEmail);
      } else {
        setError(result.error || 'Failed to create schedule');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create schedule');
    } finally {
      setLoading(false);
    }
  };

  const deleteSchedule = async (scheduleId: number) => {
    if (!confirm('Are you sure you want to delete this schedule?')) {
      return;
    }

    setLoading(true);
    clearMessages();

    try {
      const backendUrl = getAutoBackendUrl();
      const response = await fetch(`${backendUrl}/api/schedule-email?userEmail=${encodeURIComponent(userEmail)}&scheduleId=${scheduleId}`, {
        method: 'DELETE'
      });

      const result = await response.json();

      if (result.success) {
        setSuccess('✅ Schedule deleted successfully');
        // Reload schedules
        await loadUserSchedules(userEmail);
      } else {
        setError(result.error || 'Failed to delete schedule');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete schedule');
    } finally {
      setLoading(false);
    }
  };

  const toggleScheduleStatus = async (schedule: EmailSchedule) => {
    setLoading(true);
    clearMessages();

    try {
      const updatedSchedule = {
        userEmail: schedule.userEmail,
        scheduleName: schedule.scheduleName,
        emailAddresses: schedule.emailAddresses,
        enabled: !schedule.enabled,
        scheduleTime: schedule.scheduleTime,
        timezone: schedule.timezone,
        subject: schedule.subject || 'Daily Alert Report',
        filters: schedule.filters
      };

      const backendUrl = getAutoBackendUrl();
      const response = await fetch(`${backendUrl}/api/schedule-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedSchedule)
      });

      const result = await response.json();

      if (result.success) {
        setSuccess(`✅ Schedule ${updatedSchedule.enabled ? 'enabled' : 'disabled'} successfully`);
        // Reload schedules
        await loadUserSchedules(userEmail);
      } else {
        setError(result.error || 'Failed to update schedule');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update schedule');
    } finally {
      setLoading(false);
    }
  };

  const sendTestEmail = async (schedule: EmailSchedule) => {
    setLoading(true);
    clearMessages();

    try {
      const backendUrl = getAutoBackendUrl();
      const response = await fetch(`${backendUrl}/api/test-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          emailAddresses: schedule.emailAddresses,
          subject: `TEST: ${schedule.subject || 'Daily Alert Report'}`
        })
      });

      const result = await response.json();

      if (result.success) {
        setSuccess(`✅ Test email sent to ${schedule.emailAddresses.join(', ')}`);
      } else {
        setError(result.error || 'Failed to send test email');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send test email');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: '8px 12px',
    border: '1px solid #ccc',
    borderRadius: 4,
    fontSize: 14,
    backgroundColor: '#fff',
    color: '#000'
  };

  const getStatusBadge = (schedule: EmailSchedule) => {
    if (!schedule.enabled) {
      return <span style={{ padding: '2px 6px', backgroundColor: '#6c757d', color: '#fff', borderRadius: 3, fontSize: 12 }}>Disabled</span>;
    }
    
    if (schedule.lastExecutionStatus === 'success') {
      return <span style={{ padding: '2px 6px', backgroundColor: '#28a745', color: '#fff', borderRadius: 3, fontSize: 12 }}>✓ Active</span>;
    } else if (schedule.lastExecutionStatus === 'failed') {
      return <span style={{ padding: '2px 6px', backgroundColor: '#dc3545', color: '#fff', borderRadius: 3, fontSize: 12 }}>⚠ Error</span>;
    } else {
      return <span style={{ padding: '2px 6px', backgroundColor: '#007bff', color: '#fff', borderRadius: 3, fontSize: 12 }}>● Enabled</span>;
    }
  };

  return (
    <div style={{
      backgroundColor: '#f8f9fa',
      padding: '20px',
      borderRadius: '8px',
      marginBottom: '20px',
      border: '1px solid #dee2e6'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px' }}>
        <h3 style={{ margin: 0, color: '#333', display: 'flex', alignItems: 'center', gap: '8px' }}>
          📧 Multi-User Email Scheduling
        </h3>
        
        <div style={{
          fontSize: '12px',
          padding: '4px 8px',
          backgroundColor: '#e8f5e8',
          color: '#2e7d32',
          borderRadius: '4px',
          border: '1px solid #4caf50',
          fontWeight: '500'
        }}>
          ✅ Production Ready
        </div>
      </div>

      {/* Current filters info */}
      {currentFilters && (
        <div style={{
          backgroundColor: '#e7f3ff',
          padding: '12px',
          borderRadius: '4px',
          marginBottom: '15px',
          border: '1px solid #b3d9ff'
        }}>
          <p style={{ margin: 0, fontSize: '14px', color: '#0056b3' }}>
            <strong>📊 Using current page filters:</strong> 
            {` Testbed: ${currentFilters.selectedTestbed || 'All'} | `}
            {` Severity: ${currentFilters.selectedSeverity || 'All'} | `}
            {` Status: ${currentFilters.selectedStatus || 'All'}`}
          </p>
        </div>
      )}

      {/* User email input */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#333' }}>
          User Email Address
        </label>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="email"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            placeholder="Enter user email to manage schedules..."
            style={{ ...inputStyle, flex: 1 }}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                loadUserSchedules(userEmail);
              }
            }}
          />
          <button
            onClick={() => loadUserSchedules(userEmail)}
            disabled={loading || !userEmail.trim()}
            style={{
              background: loading || !userEmail.trim() ? '#ccc' : '#007bff',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '8px 16px',
              fontWeight: 600,
              cursor: loading || !userEmail.trim() ? 'not-allowed' : 'pointer',
              fontSize: 14
            }}
          >
            {loading ? '🔄' : '🔍'} Load Schedules
          </button>
        </div>
      </div>

      {/* Status messages */}
      {success && (
        <div style={{
          backgroundColor: '#d4edda',
          color: '#155724',
          padding: '12px',
          borderRadius: '4px',
          border: '1px solid #c3e6cb',
          marginBottom: '15px'
        }}>
          {success}
        </div>
      )}

      {error && (
        <div style={{
          backgroundColor: '#f8d7da',
          color: '#721c24',
          padding: '12px',
          borderRadius: '4px',
          border: '1px solid #f5c6cb',
          marginBottom: '15px'
        }}>
          {error}
        </div>
      )}

      {/* Schedules list */}
      {userEmail.trim() && schedules.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h4 style={{ margin: 0, color: '#333' }}>
              Email Schedules for {userEmail} ({schedules.length})
            </h4>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              style={{
                background: '#28a745',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '8px 16px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 14
              }}
            >
              ➕ Add New Schedule
            </button>
          </div>

          <div style={{ display: 'grid', gap: '12px' }}>
            {schedules.map(schedule => (
              <div
                key={schedule.id}
                style={{
                  backgroundColor: '#fff',
                  border: '1px solid #dee2e6',
                  borderRadius: '6px',
                  padding: '16px',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '16px',
                  alignItems: 'start'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <h5 style={{ margin: 0, color: '#333', fontSize: '16px' }}>
                      {schedule.scheduleName}
                    </h5>
                    {getStatusBadge(schedule)}
                  </div>
                  
                  <div style={{ fontSize: '14px', color: '#666', marginBottom: '4px' }}>
                    <strong>Recipients:</strong> {schedule.emailAddresses.join(', ')}
                  </div>
                  
                  <div style={{ fontSize: '14px', color: '#666', marginBottom: '4px' }}>
                    <strong>Schedule:</strong> {schedule.scheduleTime} {schedule.timezone}
                  </div>
                  
                  {/* Display applied filters */}
                  <div style={{ fontSize: '14px', color: '#666', marginBottom: '4px' }}>
                    <strong>Filters:</strong> {formatFilters(schedule.filters)}
                  </div>
                  
                  {schedule.lastExecutedAt && (
                    <div style={{ fontSize: '12px', color: '#999' }}>
                      Last executed: {new Date(schedule.lastExecutedAt).toLocaleString()}
                    </div>
                  )}

                  {schedule.executionError && (
                    <div style={{ fontSize: '12px', color: '#dc3545', marginTop: '4px' }}>
                      Error: {schedule.executionError}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => toggleScheduleStatus(schedule)}
                    disabled={loading}
                    style={{
                      background: schedule.enabled ? '#ffc107' : '#28a745',
                      color: schedule.enabled ? '#000' : '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: loading ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {schedule.enabled ? '⏸️ Disable' : '▶️ Enable'}
                  </button>

                  <button
                    onClick={() => sendTestEmail(schedule)}
                    disabled={loading}
                    style={{
                      background: '#17a2b8',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: loading ? 'not-allowed' : 'pointer'
                    }}
                  >
                    📤 Test
                  </button>

                  <button
                    onClick={() => deleteSchedule(schedule.id)}
                    disabled={loading}
                    style={{
                      background: '#dc3545',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: loading ? 'not-allowed' : 'pointer'
                    }}
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No schedules message */}
      {userEmail.trim() && !loading && schedules.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          backgroundColor: '#fff',
          border: '1px solid #dee2e6',
          borderRadius: '6px',
          marginBottom: '20px'
        }}>
          <div style={{ fontSize: '16px', color: '#666', marginBottom: '15px' }}>
            No email schedules found for {userEmail}
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            style={{
              background: '#28a745',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '10px 20px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            ➕ Create First Schedule
          </button>
        </div>
      )}

      {/* Create new schedule form */}
      {showCreateForm && userEmail.trim() && (
        <div style={{
          backgroundColor: '#fff',
          border: '1px solid #dee2e6',
          borderRadius: '6px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h4 style={{ margin: 0, color: '#333' }}>Create New Email Schedule</h4>
            <button
              onClick={() => setShowCreateForm(false)}
              style={{
                background: '#6c757d',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: 12
              }}
            >
              ✖️ Cancel
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '15px', marginBottom: '15px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600, color: '#333' }}>
                Schedule Name
              </label>
              <input
                type="text"
                value={newSchedule.scheduleName}
                onChange={(e) => setNewSchedule({ ...newSchedule, scheduleName: e.target.value })}
                placeholder="e.g., Daily Morning Report"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600, color: '#333' }}>
                Schedule Time
              </label>
              <input
                type="time"
                value={newSchedule.scheduleTime}
                onChange={(e) => setNewSchedule({ ...newSchedule, scheduleTime: e.target.value })}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600, color: '#333' }}>
                Timezone
              </label>
              <select
                value={newSchedule.timezone}
                onChange={(e) => setNewSchedule({ ...newSchedule, timezone: e.target.value })}
                style={inputStyle}
              >
                <option value="UTC">UTC</option>
                <option value="PST">PST</option>
                <option value="EST">EST</option>
                <option value="CST">CST</option>
                <option value="MST">MST</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600, color: '#333' }}>
              Subject
            </label>
            <input
              type="text"
              value={newSchedule.subject}
              onChange={(e) => setNewSchedule({ ...newSchedule, subject: e.target.value })}
              placeholder="Daily Alert Report"
              style={{ ...inputStyle, width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600, color: '#333' }}>
              Recipient Email Addresses
            </label>
            {newSchedule.emailAddresses.map((email, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    const newEmails = [...newSchedule.emailAddresses];
                    newEmails[idx] = e.target.value;
                    setNewSchedule({ ...newSchedule, emailAddresses: newEmails });
                  }}
                  placeholder="Enter recipient email address"
                  style={{ ...inputStyle, flex: 1 }}
                />
                {newSchedule.emailAddresses.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const newEmails = newSchedule.emailAddresses.filter((_, i) => i !== idx);
                      setNewSchedule({ ...newSchedule, emailAddresses: newEmails });
                    }}
                    style={{
                      background: '#dc3545',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '8px',
                      cursor: 'pointer',
                      fontSize: 12
                    }}
                  >
                    ✖
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setNewSchedule({ 
                ...newSchedule, 
                emailAddresses: [...newSchedule.emailAddresses, ''] 
              })}
              style={{
                background: '#007bff',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '6px 12px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 12
              }}
            >
              ➕ Add Email
            </button>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={createSchedule}
              disabled={loading}
              style={{
                background: loading ? '#ccc' : '#28a745',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '10px 20px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: 14
              }}
            >
              {loading ? '🔄 Creating...' : '💾 Create Schedule'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiUserEmailSchedule;
