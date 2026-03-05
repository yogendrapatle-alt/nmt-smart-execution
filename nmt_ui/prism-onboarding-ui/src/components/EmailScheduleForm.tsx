import React, { useState } from 'react';

export interface EmailScheduleData {
  emailAddresses: string[];
  enabled: boolean;
  scheduleTime: string;
  timezone: string;
  severityFilter: string;
  statusFilter: string;
  testbedFilter: string;
  smtpServer?: string;
  smtpPort?: number;
  smtpUsername?: string;
  smtpPassword?: string;
  smtpUseTls?: boolean;
}

interface EmailScheduleFormProps {
  initialData: EmailScheduleData;
  onSave: (data: EmailScheduleData) => Promise<void>;
  onTest: (email: string) => Promise<void>;
  loading?: boolean;
  success?: string;
  error?: string;
  testbedOptions: string[];
  onAdvancedToggle?: () => void;
  showAdvanced?: boolean;
  hideFilters?: boolean;
  currentFilters?: {
    selectedDate: string;
    selectedTestbed: string;
    selectedSeverity: string;
    selectedStatus: string;
  };
}

const EmailScheduleForm: React.FC<EmailScheduleFormProps> = ({
  initialData,
  onSave,
  onTest,
  loading = false,
  success = '',
  error = '',
  testbedOptions = [],
  onAdvancedToggle,
  showAdvanced = false,
  hideFilters = false,
  currentFilters
}) => {
  // Initialize form data with currentFilters if provided
  const getInitialFormData = () => {
    if (currentFilters && hideFilters) {
      return {
        ...initialData,
        severityFilter: currentFilters.selectedSeverity || 'All',
        statusFilter: currentFilters.selectedStatus || 'All',
        testbedFilter: currentFilters.selectedTestbed || 'All'
      };
    }
    return initialData;
  };

  const [formData, setFormData] = useState<EmailScheduleData>(getInitialFormData());
  const [testEmail, setTestEmail] = useState<string>('');
  const [testLoading, setTestLoading] = useState<boolean>(false);

  const inputStyle = {
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    backgroundColor: '#fff',
    color: '#333',
    outline: 'none',
    transition: 'border-color 0.3s ease'
  };

  const addEmailAddress = () => {
    setFormData({
      ...formData,
      emailAddresses: [...formData.emailAddresses, '']
    });
  };

  const removeEmailAddress = (index: number) => {
    setFormData({
      ...formData,
      emailAddresses: formData.emailAddresses.filter((_, i) => i !== index)
    });
  };

  const updateEmailAddress = (index: number, value: string) => {
    const newAddresses = [...formData.emailAddresses];
    newAddresses[index] = value;
    setFormData({
      ...formData,
      emailAddresses: newAddresses
    });
  };

  const handleSave = async () => {
    await onSave(formData);
  };

  const handleTest = async () => {
    if (!testEmail.trim()) return;
    setTestLoading(true);
    try {
      await onTest(testEmail.trim());
    } finally {
      setTestLoading(false);
    }
  };

  const timezones = [
    'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai',
    'Australia/Sydney', 'Pacific/Auckland'
  ];

  return (
    <div style={{ 
      padding: '20px', 
      backgroundColor: '#f8f9fa', 
      borderRadius: '8px',
      border: '1px solid #e9ecef',
      marginBottom: '20px'
    }}>
      <h4 style={{ 
        marginBottom: '16px', 
        color: '#333', 
        display: 'flex', 
        alignItems: 'center', 
        gap: '8px' 
      }}>
        📧 Email Report Scheduling
      </h4>
      
      {/* Enable/Disable Toggle */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px', 
          cursor: 'pointer' 
        }}>
          <input
            type="checkbox"
            checked={formData.enabled}
            onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
            style={{ transform: 'scale(1.2)' }}
          />
          <span style={{ fontWeight: '600', color: '#333' }}>
            Enable daily email reports
          </span>
        </label>
      </div>

      {formData.enabled && (
        <>
          {/* Email Addresses */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '8px', 
              fontWeight: '600', 
              color: '#333' 
            }}>
              Email Recipients *
            </label>
            {formData.emailAddresses.map((email, idx) => (
              <div key={idx} style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                marginBottom: '8px' 
              }}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => updateEmailAddress(idx, e.target.value)}
                  placeholder="Enter email address"
                  style={{ ...inputStyle, flex: 1 }}
                  required
                />
                {formData.emailAddresses.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeEmailAddress(idx)}
                    style={{
                      background: '#dc3545',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '8px 12px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                    title="Remove this email address"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addEmailAddress}
              style={{
                background: '#007bff',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                padding: '8px 16px',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '14px',
                marginTop: '8px'
              }}
            >
              + Add Email Address
            </button>
          </div>

          {/* Schedule Configuration */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
            gap: '16px', 
            marginBottom: '16px' 
          }}>
            <div>
              <label style={{ 
                display: 'block', 
                marginBottom: '4px', 
                fontWeight: '600', 
                color: '#333' 
              }}>
                Schedule Time *
              </label>
              <input
                type="time"
                value={formData.scheduleTime}
                onChange={(e) => setFormData({ ...formData, scheduleTime: e.target.value })}
                style={inputStyle}
                required
              />
            </div>

            <div>
              <label style={{ 
                display: 'block', 
                marginBottom: '4px', 
                fontWeight: '600', 
                color: '#333' 
              }}>
                Timezone *
              </label>
              <select
                value={formData.timezone}
                onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                style={inputStyle}
                required
              >
                {timezones.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Filter Configuration */}
          {!hideFilters && (
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
              gap: '16px', 
              marginBottom: '16px' 
            }}>
              <div>
                <label style={{ 
                  display: 'block', 
                  marginBottom: '4px', 
                  fontWeight: '600', 
                  color: '#333' 
                }}>
                  Severity Filter
                </label>
                <select
                  value={formData.severityFilter}
                  onChange={(e) => setFormData({ ...formData, severityFilter: e.target.value })}
                  style={inputStyle}
                >
                  <option value="All">All Severities</option>
                  <option value="Critical">Critical Only</option>
                  <option value="Moderate">Moderate and Above</option>
                  <option value="Low">Low and Above</option>
                </select>
              </div>

              <div>
                <label style={{ 
                  display: 'block', 
                  marginBottom: '4px', 
                  fontWeight: '600', 
                  color: '#333' 
                }}>
                  Status Filter
                </label>
                <select
                  value={formData.statusFilter}
                  onChange={(e) => setFormData({ ...formData, statusFilter: e.target.value })}
                  style={inputStyle}
                >
                  <option value="All">All Statuses</option>
                  <option value="Active">Active Only</option>
                  <option value="Resolved">Resolved Only</option>
                </select>
              </div>

              <div>
                <label style={{ 
                  display: 'block', 
                  marginBottom: '4px', 
                  fontWeight: '600', 
                  color: '#333' 
                }}>
                  Testbed Filter
                </label>
                <select
                  value={formData.testbedFilter}
                  onChange={(e) => setFormData({ ...formData, testbedFilter: e.target.value })}
                  style={inputStyle}
                >
                  <option value="All">All Testbeds</option>
                  {testbedOptions.map(testbed => (
                    <option key={testbed} value={testbed}>{testbed}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Show current filters when hidden */}
          {hideFilters && currentFilters && (
            <div style={{
              padding: '12px',
              backgroundColor: '#f8f9fa',
              border: '1px solid #e9ecef',
              borderRadius: '6px',
              marginBottom: '16px'
            }}>
              <p style={{
                margin: '0 0 8px 0',
                fontWeight: '600',
                color: '#495057',
                fontSize: '14px'
              }}>
                Email will use current page filters:
              </p>
              <div style={{
                display: 'flex',
                gap: '12px',
                fontSize: '13px',
                color: '#6c757d'
              }}>
                <span>Date: {currentFilters.selectedDate}</span>
                <span>Severity: {currentFilters.selectedSeverity}</span>
                <span>Status: {currentFilters.selectedStatus}</span>
                <span>Testbed: {currentFilters.selectedTestbed}</span>
              </div>
            </div>
          )}

          {/* Advanced SMTP Configuration Toggle */}
          {onAdvancedToggle && (
            <div style={{ marginBottom: '16px' }}>
              <button
                type="button"
                onClick={onAdvancedToggle}
                style={{
                  background: 'transparent',
                  color: '#007bff',
                  border: '1px solid #007bff',
                  borderRadius: '4px',
                  padding: '8px 16px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                {showAdvanced ? '🔼 Hide' : '🔽 Show'} SMTP Configuration
              </button>
            </div>
          )}

          {/* Test Email Section */}
          <div style={{ 
            marginTop: '16px', 
            padding: '16px', 
            backgroundColor: '#fff', 
            borderRadius: '6px',
            border: '1px solid #dee2e6'
          }}>
            <h5 style={{ marginBottom: '12px', color: '#333' }}>Test Email</h5>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="Enter test email address"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                type="button"
                onClick={handleTest}
                disabled={!testEmail.trim() || testLoading}
                style={{
                  background: testLoading ? '#6c757d' : '#17a2b8',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '10px 16px',
                  fontWeight: '600',
                  cursor: testLoading ? 'not-allowed' : 'pointer',
                  fontSize: '14px'
                }}
              >
                {testLoading ? 'Sending...' : 'Send Test'}
              </button>
            </div>
            <small style={{ color: '#6c757d', marginTop: '4px', display: 'block' }}>
              Send a test email to verify your configuration
            </small>
          </div>
        </>
      )}

      {/* Status Messages */}
      {success && (
        <div style={{
          marginTop: '16px',
          padding: '12px',
          backgroundColor: '#d4edda',
          border: '1px solid #c3e6cb',
          borderRadius: '4px',
          color: '#155724'
        }}>
          ✅ {success}
        </div>
      )}

      {error && (
        <div style={{
          marginTop: '16px',
          padding: '12px',
          backgroundColor: '#f8d7da',
          border: '1px solid #f5c6cb',
          borderRadius: '4px',
          color: '#721c24'
        }}>
          ❌ {error}
        </div>
      )}

      {/* Save Button */}
      {formData.enabled && (
        <div style={{ marginTop: '16px' }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading || formData.emailAddresses.every(e => !e.trim())}
            style={{
              background: loading || formData.emailAddresses.every(e => !e.trim()) 
                ? '#6c757d' : '#28a745',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              padding: '12px 24px',
              fontWeight: '600',
              cursor: loading || formData.emailAddresses.every(e => !e.trim()) 
                ? 'not-allowed' : 'pointer',
              fontSize: '16px'
            }}
          >
            {loading ? 'Saving...' : 'Save Schedule'}
          </button>
        </div>
      )}
    </div>
  );
};

export default EmailScheduleForm;
