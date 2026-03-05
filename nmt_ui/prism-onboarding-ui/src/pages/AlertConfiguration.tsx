/**
 * Alert Configuration Page
 * 
 * Configure Slack, Email, and Webhook notifications for testbeds
 */

import React, { useState, useEffect } from 'react';
import '../styles/AlertConfiguration.css';

interface AlertConfig {
  slack: {
    enabled: boolean;
    webhook_url: string;
  };
  email: {
    enabled: boolean;
    smtp_host: string;
    smtp_port: number;
    username: string;
    password: string;
    from_email: string;
    recipients: string[];
    use_tls: boolean;
  };
  webhook: {
    enabled: boolean;
    url: string;
    headers: Record<string, string>;
  };
}

interface Testbed {
  unique_testbed_id: string;
  testbed_label: string;
  pc_ip: string;
}

const AlertConfiguration: React.FC = () => {
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [selectedTestbed, setSelectedTestbed] = useState<string>('');
  const [config, setConfig] = useState<AlertConfig | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  useEffect(() => {
    fetchTestbeds();
  }, []);

  useEffect(() => {
    if (selectedTestbed) {
      fetchConfig();
    }
  }, [selectedTestbed]);

  const fetchTestbeds = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/get-testbeds');
      const data = await response.json();
      if (data.success && data.testbeds) {
        setTestbeds(data.testbeds);
        if (data.testbeds.length > 0) {
          setSelectedTestbed(data.testbeds[0].unique_testbed_id);
        }
      }
    } catch (err: any) {
      console.error('Error fetching testbeds:', err);
    }
  };

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/alerts/config/${selectedTestbed}`);
      const data = await response.json();
      if (data.success) {
        setConfig(data.config);
      }
    } catch (err: any) {
      console.error('Error fetching config:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    
    setSaving(true);
    setMessage(null);
    
    try {
      const response = await fetch(`/api/alerts/config/${selectedTestbed}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      
      const data = await response.json();
      
      if (data.success) {
        setMessage({type: 'success', text: 'Configuration saved successfully!'});
      } else {
        setMessage({type: 'error', text: data.error || 'Failed to save configuration'});
      }
    } catch (err: any) {
      setMessage({type: 'error', text: err.message});
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (channel: string) => {
    setTesting({...testing, [channel]: true});
    setMessage(null);
    
    try {
      const response = await fetch('/api/alerts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testbed_id: selectedTestbed,
          channels: [channel]
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        const result = data.results[channel];
        setMessage({
          type: result ? 'success' : 'error',
          text: result ? `${channel} test successful!` : `${channel} test failed`
        });
      } else {
        setMessage({type: 'error', text: data.error});
      }
    } catch (err: any) {
      setMessage({type: 'error', text: err.message});
    } finally {
      setTesting({...testing, [channel]: false});
    }
  };

  if (!config) {
    return <div className="alert-config-page"><div className="loading">Loading...</div></div>;
  }

  return (
    <div className="alert-config-page">
      <div className="page-header">
        <h1>🔔 Alert Configuration</h1>
        <p>Configure notifications for Smart Execution events</p>
      </div>

      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="testbed-selector">
        <label>Select Testbed:</label>
        <select 
          value={selectedTestbed} 
          onChange={(e) => setSelectedTestbed(e.target.value)}
        >
          {testbeds.map((tb) => (
            <option key={tb.unique_testbed_id} value={tb.unique_testbed_id}>
              {tb.testbed_label} ({tb.pc_ip})
            </option>
          ))}
        </select>
      </div>

      {/* Slack Configuration */}
      <div className="config-section">
        <div className="section-header">
          <h2>📱 Slack</h2>
          <label className="toggle">
            <input
              type="checkbox"
              checked={config.slack.enabled}
              onChange={(e) => setConfig({
                ...config,
                slack: {...config.slack, enabled: e.target.checked}
              })}
            />
            <span className="slider"></span>
          </label>
        </div>
        
        {config.slack.enabled && (
          <div className="section-content">
            <div className="form-group">
              <label>Webhook URL</label>
              <input
                type="url"
                value={config.slack.webhook_url}
                onChange={(e) => setConfig({
                  ...config,
                  slack: {...config.slack, webhook_url: e.target.value}
                })}
                placeholder="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
              />
              <small>Get webhook URL from <a href="https://api.slack.com/messaging/webhooks" target="_blank">Slack API</a></small>
            </div>
            <button 
              className="btn-test"
              onClick={() => handleTest('slack')}
              disabled={testing.slack || !config.slack.webhook_url}
            >
              {testing.slack ? 'Testing...' : 'Test Slack'}
            </button>
          </div>
        )}
      </div>

      {/* Email Configuration */}
      <div className="config-section">
        <div className="section-header">
          <h2>📧 Email</h2>
          <label className="toggle">
            <input
              type="checkbox"
              checked={config.email.enabled}
              onChange={(e) => setConfig({
                ...config,
                email: {...config.email, enabled: e.target.checked}
              })}
            />
            <span className="slider"></span>
          </label>
        </div>
        
        {config.email.enabled && (
          <div className="section-content">
            <div className="form-row">
              <div className="form-group">
                <label>SMTP Host</label>
                <input
                  type="text"
                  value={config.email.smtp_host}
                  onChange={(e) => setConfig({
                    ...config,
                    email: {...config.email, smtp_host: e.target.value}
                  })}
                  placeholder="smtp.gmail.com"
                />
              </div>
              <div className="form-group">
                <label>SMTP Port</label>
                <input
                  type="number"
                  value={config.email.smtp_port}
                  onChange={(e) => setConfig({
                    ...config,
                    email: {...config.email, smtp_port: parseInt(e.target.value)}
                  })}
                />
              </div>
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label>Username</label>
                <input
                  type="text"
                  value={config.email.username}
                  onChange={(e) => setConfig({
                    ...config,
                    email: {...config.email, username: e.target.value}
                  })}
                />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  value={config.email.password}
                  onChange={(e) => setConfig({
                    ...config,
                    email: {...config.email, password: e.target.value}
                  })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>From Email</label>
              <input
                type="email"
                value={config.email.from_email}
                onChange={(e) => setConfig({
                  ...config,
                  email: {...config.email, from_email: e.target.value}
                })}
                placeholder="alerts@example.com"
              />
            </div>

            <div className="form-group">
              <label>Recipients (comma-separated)</label>
              <input
                type="text"
                value={config.email.recipients.join(', ')}
                onChange={(e) => setConfig({
                  ...config,
                  email: {...config.email, recipients: e.target.value.split(',').map(s => s.trim())}
                })}
                placeholder="user1@example.com, user2@example.com"
              />
            </div>

            <div className="form-checkbox">
              <input
                type="checkbox"
                id="use_tls"
                checked={config.email.use_tls}
                onChange={(e) => setConfig({
                  ...config,
                  email: {...config.email, use_tls: e.target.checked}
                })}
              />
              <label htmlFor="use_tls">Use TLS</label>
            </div>

            <button 
              className="btn-test"
              onClick={() => handleTest('email')}
              disabled={testing.email}
            >
              {testing.email ? 'Testing...' : 'Test Email'}
            </button>
          </div>
        )}
      </div>

      {/* Webhook Configuration */}
      <div className="config-section">
        <div className="section-header">
          <h2>🔗 Webhook</h2>
          <label className="toggle">
            <input
              type="checkbox"
              checked={config.webhook.enabled}
              onChange={(e) => setConfig({
                ...config,
                webhook: {...config.webhook, enabled: e.target.checked}
              })}
            />
            <span className="slider"></span>
          </label>
        </div>
        
        {config.webhook.enabled && (
          <div className="section-content">
            <div className="form-group">
              <label>Webhook URL</label>
              <input
                type="url"
                value={config.webhook.url}
                onChange={(e) => setConfig({
                  ...config,
                  webhook: {...config.webhook, url: e.target.value}
                })}
                placeholder="https://webhook.site/your-unique-url"
              />
              <small>Test with <a href="https://webhook.site" target="_blank">webhook.site</a></small>
            </div>
            <button 
              className="btn-test"
              onClick={() => handleTest('webhook')}
              disabled={testing.webhook || !config.webhook.url}
            >
              {testing.webhook ? 'Testing...' : 'Test Webhook'}
            </button>
          </div>
        )}
      </div>

      <div className="actions">
        <button 
          className="btn-save"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
};

export default AlertConfiguration;
