import React, { useState } from 'react';
import EmailScheduleForm from './EmailScheduleForm';
import { SMTPConfiguration } from './SMTPConfiguration';
import { useEmailSchedule } from '../hooks/useEmailSchedule';

interface EmailScheduleProps {
  testbedOptions?: string[];
  className?: string;
  currentFilters?: {
    selectedDate: string;
    selectedTestbed: string;
    selectedSeverity: string;
    selectedStatus: string;
  };
}

const EmailSchedule: React.FC<EmailScheduleProps> = ({ 
  testbedOptions = [],
  className = '',
  currentFilters
}) => {
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  
  const {
    emailScheduleData,
    loading,
    success,
    error,
    saveEmailSchedule,
    sendTestEmail,
    testSMTPConfiguration
  } = useEmailSchedule();

  const handleAdvancedToggle = () => {
    setShowAdvanced(!showAdvanced);
  };

  const handleSave = async (data: typeof emailScheduleData) => {
    // Merge current page filters with email schedule data
    const dataWithFilters = {
      ...data,
      // Use the current page filters instead of separate email schedule filters
      testbedFilter: currentFilters?.selectedTestbed || 'all',
      severityFilter: currentFilters?.selectedSeverity || 'all',
      statusFilter: currentFilters?.selectedStatus || 'all'
    };
    await saveEmailSchedule(dataWithFilters);
  };

  const handleTest = async (email: string) => {
    await sendTestEmail(email);
  };

  const handleSMTPTest = async () => {
    await testSMTPConfiguration();
  };

  return (
    <div className={className} style={{
      backgroundColor: '#f8f9fa',
      padding: '20px',
      borderRadius: '8px',
      marginBottom: '20px',
      border: '1px solid #dee2e6'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px' }}>
        <h3 style={{ margin: 0, color: '#333', display: 'flex', alignItems: 'center', gap: '8px' }}>
          📧 Email Alert Scheduling
        </h3>
        
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{
            fontSize: '12px',
            padding: '4px 8px',
            backgroundColor: '#e8f5e8',
            color: '#2e7d32',
            borderRadius: '4px',
            border: '1px solid #4caf50',
            fontWeight: '500'
          }}>
            ✅ Nutanix Internal Relay
          </div>
          
          <button
            onClick={handleAdvancedToggle}
            style={{
              padding: '6px 12px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500'
            }}
          >
            ⚙️ View Email Config
          </button>
        </div>
      </div>

      <div style={{
        backgroundColor: '#e7f3ff',
        padding: '12px',
        borderRadius: '4px',
        marginBottom: '15px',
        border: '1px solid #b3d9ff'
      }}>
        <p style={{ margin: 0, fontSize: '14px', color: '#0056b3', marginBottom: '8px' }}>
          <strong>🎯 Pre-configured:</strong> Email system uses Nutanix internal relay (10.4.8.37:25). 
          No passwords required - just configure recipients and schedule!
        </p>
        {currentFilters && (
          <p style={{ margin: 0, fontSize: '14px', color: '#0056b3' }}>
            <strong>📊 Using current page filters:</strong> 
            {` Testbed: ${currentFilters.selectedTestbed || 'All'} | `}
            {` Severity: ${currentFilters.selectedSeverity || 'All'} | `}
            {` Status: ${currentFilters.selectedStatus || 'All'}`}
          </p>
        )}
      </div>

      <EmailScheduleForm
        initialData={emailScheduleData}
        onSave={handleSave}
        onTest={handleTest}
        loading={loading}
        success={success}
        error={error}
        testbedOptions={testbedOptions}
        onAdvancedToggle={handleAdvancedToggle}
        showAdvanced={showAdvanced}
        hideFilters={true}
        currentFilters={currentFilters}
      />
      
      {showAdvanced && (
        <SMTPConfiguration
          onClose={() => setShowAdvanced(false)}
          onTestConnection={handleSMTPTest}
        />
      )}
    </div>
  );
};

export default EmailSchedule;
