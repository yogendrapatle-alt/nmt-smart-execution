import React, { useState } from 'react';

interface SMTPConfigurationProps {
  onClose: () => void;
  onTestConnection: () => void;
}

export const SMTPConfiguration: React.FC<SMTPConfigurationProps> = ({
  onClose,
}) => {
  const [connectionStatus, setConnectionStatus] = useState<string>('');

  const handleTestConnection = async () => {
    setConnectionStatus('Testing...');
    try {
      const response = await fetch('/api/smtp/test');
      const result = await response.json();
      
      if (result.success) {
        setConnectionStatus('✅ Connection successful! Internal relay is working.');
      } else {
        setConnectionStatus(`❌ Connection failed: ${result.message}`);
      }
    } catch (error) {
      setConnectionStatus('❌ Connection test failed');
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '30px',
        borderRadius: '8px',
        maxWidth: '600px',
        width: '90%',
        maxHeight: '80vh',
        overflow: 'auto'
      }}>
        <h3 style={{ marginTop: 0, color: '#333', marginBottom: '20px' }}>
          📧 Email Configuration - Nutanix Internal Relay
        </h3>

        <div style={{
          backgroundColor: '#e8f5e8',
          border: '1px solid #4caf50',
          borderRadius: '4px',
          padding: '15px',
          marginBottom: '20px'
        }}>
          <h4 style={{ marginTop: 0, color: '#2e7d32' }}>✅ Pre-configured for Nutanix</h4>
          <p style={{ margin: '8px 0', fontSize: '14px', color: '#2e7d32' }}>
            Your email system is pre-configured to use the Nutanix internal mail relay.
            <strong> No user passwords or credentials required!</strong>
          </p>
        </div>

        <div style={{
          backgroundColor: '#f8f9fa',
          border: '1px solid #dee2e6',
          borderRadius: '4px',
          padding: '15px',
          marginBottom: '20px'
        }}>
          <h4 style={{ marginTop: 0, color: '#495057' }}>Current Configuration:</h4>
          <table style={{ width: '100%', fontSize: '14px' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>SMTP Server:</td>
                <td style={{ padding: '4px 8px' }}>10.4.8.37 (Nutanix Internal)</td>
              </tr>
              <tr style={{ backgroundColor: '#f8f9fa' }}>
                <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>Port:</td>
                <td style={{ padding: '4px 8px' }}>25</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>Authentication:</td>
                <td style={{ padding: '4px 8px', color: '#28a745' }}>None Required ✅</td>
              </tr>
              <tr style={{ backgroundColor: '#f8f9fa' }}>
                <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>Sender:</td>
                <td style={{ padding: '4px 8px' }}>ncm-monitoring@nutanix.com</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>Security:</td>
                <td style={{ padding: '4px 8px', color: '#28a745' }}>Internal Network ✅</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{
          backgroundColor: '#fff3cd',
          border: '1px solid #ffeaa7',
          borderRadius: '4px',
          padding: '15px',
          marginBottom: '20px'
        }}>
          <h4 style={{ marginTop: 0, color: '#856404' }}>📋 Requirements:</h4>
          <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '14px', color: '#856404' }}>
            <li>Must be connected to Nutanix VPN</li>
            <li>Recipients must have @nutanix.com email addresses</li>
            <li>System automatically uses corporate-approved settings</li>
          </ul>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '20px' }}>
          <button
            onClick={handleTestConnection}
            style={{
              padding: '10px 20px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            🔍 Test Connection
          </button>
          
          {connectionStatus && (
            <span style={{
              fontSize: '14px',
              padding: '5px 10px',
              borderRadius: '4px',
              backgroundColor: connectionStatus.includes('✅') ? '#d4edda' : '#f8d7da',
              color: connectionStatus.includes('✅') ? '#155724' : '#721c24',
              border: `1px solid ${connectionStatus.includes('✅') ? '#c3e6cb' : '#f5c6cb'}`
            }}>
              {connectionStatus}
            </span>
          )}
        </div>

        <div style={{
          backgroundColor: '#e7f3ff',
          border: '1px solid #b3d9ff',
          borderRadius: '4px',
          padding: '15px',
          marginBottom: '20px'
        }}>
          <h4 style={{ marginTop: 0, color: '#0056b3' }}>🎯 What This Means:</h4>
          <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '14px', color: '#0056b3' }}>
            <li><strong>Secure:</strong> No personal passwords required</li>
            <li><strong>Compliant:</strong> Uses approved Nutanix infrastructure</li>
            <li><strong>Simple:</strong> Just configure recipient emails and schedule</li>
            <li><strong>Professional:</strong> Emails come from official service account</li>
          </ul>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            ✅ Configuration Ready
          </button>
        </div>
      </div>
    </div>
  );
};

export default SMTPConfiguration;
