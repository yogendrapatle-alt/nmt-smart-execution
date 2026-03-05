import { useState, useEffect } from 'react';
import { getAutoBackendUrl } from '../utils/backendUrl';
import type { EmailScheduleData } from '../components/EmailScheduleForm';

export const useEmailSchedule = () => {
  const [emailScheduleData, setEmailScheduleData] = useState<EmailScheduleData>({
    emailAddresses: [''],
    enabled: false,
    scheduleTime: '09:00',
    timezone: 'UTC',
    severityFilter: 'All',
    statusFilter: 'All',
    testbedFilter: 'All',
    smtpServer: '',
    smtpPort: 587,
    smtpUsername: '',
    smtpPassword: '',
    smtpUseTls: true
  });

  const [loading, setLoading] = useState<boolean>(false);
  const [success, setSuccess] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Load existing email schedule configuration
  const loadEmailSchedule = async () => {
    try {
      const backendUrl = getAutoBackendUrl();
      const response = await fetch(`${backendUrl}/api/schedule-email`);
      
      if (response.ok) {
        const result = await response.json();
        
        if (result.success && result.config) {
          const config = result.config;
          setEmailScheduleData({
            emailAddresses: Array.isArray(config.emailAddresses) && config.emailAddresses.length > 0 
              ? config.emailAddresses 
              : [''],
            enabled: config.enabled || false,
            scheduleTime: config.scheduleTime || '09:00',
            timezone: config.timezone || 'UTC',
            severityFilter: config.severityFilter || 'All',
            statusFilter: config.statusFilter || 'All',
            testbedFilter: config.testbedFilter || 'All',
            smtpServer: config.smtpServer || '',
            smtpPort: config.smtpPort || 587,
            smtpUsername: config.smtpUsername || '',
            smtpPassword: '', // Don't load password for security
            smtpUseTls: config.smtpUseTls !== false
          });
        }
      }
    } catch (err) {
      console.error('Error loading email schedule:', err);
      // Silently fail - not critical for the main functionality
    }
  };

  // Save email schedule configuration
  const saveEmailSchedule = async (data: EmailScheduleData) => {
    const trimmedEmails = data.emailAddresses.map(e => e.trim()).filter(e => e);
    
    // Validation
    if (data.enabled && trimmedEmails.length === 0) {
      setError('Please enter at least one valid email address');
      return;
    }
    
    for (const email of trimmedEmails) {
      if (!email.includes('@')) {
        setError(`Invalid email address: ${email}`);
        return;
      }
    }

    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const scheduleData = {
        emailAddresses: trimmedEmails,
        enabled: data.enabled,
        scheduleTime: data.scheduleTime,
        timezone: data.timezone,
        severityFilter: data.severityFilter,
        statusFilter: data.statusFilter,
        testbedFilter: data.testbedFilter,
        ...(data.smtpServer && { smtpServer: data.smtpServer }),
        ...(data.smtpPort && { smtpPort: data.smtpPort }),
        ...(data.smtpUsername && { smtpUsername: data.smtpUsername }),
        ...(data.smtpPassword && { smtpPassword: data.smtpPassword }),
        smtpUseTls: data.smtpUseTls
      };

      const backendUrl = getAutoBackendUrl();
      const response = await fetch(`${backendUrl}/api/schedule-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(scheduleData)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        setSuccess(data.enabled 
          ? `✅ Daily email report scheduled for ${trimmedEmails.join(', ')} at ${data.scheduleTime} ${data.timezone}`
          : '✅ Email schedule has been disabled'
        );
        // Update local state
        setEmailScheduleData({ ...data, emailAddresses: trimmedEmails });
      } else {
        setError(result.error || 'Failed to save email schedule');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save email schedule');
    } finally {
      setLoading(false);
    }
  };

  // Send test email
  const sendTestEmail = async (email: string) => {
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address for testing');
      return;
    }

    setError('');
    setSuccess('');

    try {
      const backendUrl = getAutoBackendUrl();
      const response = await fetch(`${backendUrl}/api/test-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ emailAddresses: [email.trim()] })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setSuccess(`✅ Test email sent successfully to ${email.trim()}`);
      } else {
        setError(result.error || 'Failed to send test email');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send test email');
    }
  };

  // Test SMTP configuration (simplified for internal relay)
  const testSMTPConfiguration = async () => {
    setError('');
    setSuccess('');

    try {
      const backendUrl = getAutoBackendUrl();
      const response = await fetch(`${backendUrl}/api/smtp/test`, {
        method: 'GET'  // No POST data needed for internal relay
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setSuccess('✅ Internal mail relay connection is working');
      } else {
        setError(result.message || 'Internal mail relay test failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to test internal mail relay');
    }
  };

  // Clear messages
  const clearMessages = () => {
    setSuccess('');
    setError('');
  };

  // Load schedule on mount
  useEffect(() => {
    loadEmailSchedule();
  }, []);

  return {
    emailScheduleData,
    setEmailScheduleData,
    loading,
    success,
    error,
    saveEmailSchedule,
    sendTestEmail,
    testSMTPConfiguration,
    loadEmailSchedule,
    clearMessages
  };
};
