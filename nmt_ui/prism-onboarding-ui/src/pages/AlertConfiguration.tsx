import React, { useState, useEffect } from 'react';
import { getApiBase } from '../utils/backendUrl';

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

const ChannelToggle: React.FC<{ label: string; enabled: boolean; onChange: (v: boolean) => void }> = ({ label, enabled, onChange }) => (
  <div className="form-check form-switch d-flex align-items-center gap-2 mb-0">
    <input className="form-check-input" type="checkbox" role="switch" checked={enabled} onChange={e => onChange(e.target.checked)} style={{ width: 44, height: 22, cursor: 'pointer' }} />
    <label className="form-check-label fw-semibold" style={{ fontSize: 'var(--text-sm, 0.875rem)', cursor: 'pointer' }} onClick={() => onChange(!enabled)}>{label}</label>
  </div>
);

const AlertConfiguration: React.FC = () => {
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [selectedTestbed, setSelectedTestbed] = useState<string>('');
  const [config, setConfig] = useState<AlertConfig | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { fetchTestbeds(); }, []);
  useEffect(() => { if (selectedTestbed) fetchConfig(); }, [selectedTestbed]);

  const fetchTestbeds = async () => {
    try {
      const response = await fetch(`${getApiBase()}/api/get-testbeds`);
      const data = await response.json();
      if (data.success && data.testbeds) {
        setTestbeds(data.testbeds);
        if (data.testbeds.length > 0) setSelectedTestbed(data.testbeds[0].unique_testbed_id);
      }
    } catch (err) {
      console.error('Error fetching testbeds:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const response = await fetch(`${getApiBase()}/api/alerts/config/${selectedTestbed}`);
      const data = await response.json();
      if (data.success) setConfig(data.config);
    } catch (err) {
      console.error('Error fetching config:', err);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`${getApiBase()}/api/alerts/config/${selectedTestbed}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await response.json();
      setMessage(data.success
        ? { type: 'success', text: 'Configuration saved successfully!' }
        : { type: 'error', text: data.error || 'Failed to save configuration' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (channel: string) => {
    setTesting(t => ({ ...t, [channel]: true }));
    setMessage(null);
    try {
      const response = await fetch(`${getApiBase()}/api/alerts/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testbed_id: selectedTestbed, channels: [channel] }),
      });
      const data = await response.json();
      if (data.success) {
        const ok = data.results[channel];
        setMessage({ type: ok ? 'success' : 'error', text: ok ? `${channel} test successful!` : `${channel} test failed` });
      } else {
        setMessage({ type: 'error', text: data.error });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setTesting(t => ({ ...t, [channel]: false }));
    }
  };

  const selectedTb = testbeds.find(t => t.unique_testbed_id === selectedTestbed);

  if (loading) {
    return (
      <div className="main-content">
        <div className="card border-0 rounded-3" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="card-body text-center py-5">
            <div className="spinner-border text-primary mb-3" style={{ width: '2.5rem', height: '2.5rem' }}><span className="visually-hidden">Loading...</span></div>
            <p className="text-muted mb-0">Loading configuration...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="main-content">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-3">
        <div>
          <h2 className="fw-bold mb-1 d-flex align-items-center gap-2">
            <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
              <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>tune</i>
            </div>
            Alert Configuration
          </h2>
          <p className="text-muted mb-0" style={{ maxWidth: 700 }}>
            Configure Slack, Email, and Webhook notification channels for smart execution alerts. Each testbed can have its own configuration.
          </p>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-danger'} rounded-3 d-flex align-items-center gap-2 mb-4`} role="alert">
          <i className="material-icons-outlined" style={{ fontSize: 20 }}>{message.type === 'success' ? 'check_circle' : 'error'}</i>
          <div className="flex-grow-1">{message.text}</div>
          <button type="button" className="btn-close" onClick={() => setMessage(null)} />
        </div>
      )}

      {/* Testbed Selector */}
      <div className="card border-0 rounded-3 mb-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <div className="card-body p-4">
          <div className="d-flex align-items-center gap-3 flex-wrap">
            <div className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0" style={{ width: 40, height: 40, background: 'linear-gradient(135deg, #667eea, #764ba2)' }}>
              <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>dns</i>
            </div>
            <div className="flex-grow-1" style={{ maxWidth: 400 }}>
              <label className="form-label fw-semibold mb-1 small">Select Testbed</label>
              <select className="form-select form-select-sm rounded-3" value={selectedTestbed} onChange={e => setSelectedTestbed(e.target.value)}>
                {testbeds.map(tb => (
                  <option key={tb.unique_testbed_id} value={tb.unique_testbed_id}>
                    {tb.testbed_label} ({tb.pc_ip})
                  </option>
                ))}
              </select>
            </div>
            {selectedTb && (
              <div className="ms-auto d-flex gap-4 flex-wrap">
                <div style={{ fontSize: '0.82rem' }}><span className="text-muted">IP:</span> <code className="ms-1">{selectedTb.pc_ip}</code></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {config && (
        <>
          {/* Slack */}
          <div className="card border-0 rounded-3 mb-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="card-body p-4">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div className="d-flex align-items-center gap-2">
                  <div className="d-flex align-items-center justify-content-center rounded-3" style={{ width: 36, height: 36, background: config.slack.enabled ? '#4A154B15' : '#f1f5f9' }}>
                    <i className="material-icons-outlined" style={{ fontSize: 20, color: config.slack.enabled ? '#4A154B' : '#94a3b8' }}>chat</i>
                  </div>
                  <h6 className="mb-0 fw-semibold">Slack Notifications</h6>
                </div>
                <ChannelToggle label={config.slack.enabled ? 'Enabled' : 'Disabled'} enabled={config.slack.enabled} onChange={v => setConfig({ ...config, slack: { ...config.slack, enabled: v } })} />
              </div>

              {config.slack.enabled && (
                <div className="pt-2 border-top">
                  <div className="mt-3">
                    <label className="form-label fw-medium small">Webhook URL</label>
                    <input type="url" className="form-control form-control-sm rounded-3" value={config.slack.webhook_url} onChange={e => setConfig({ ...config, slack: { ...config.slack, webhook_url: e.target.value } })} placeholder="https://hooks.slack.com/services/YOUR/WEBHOOK/URL" />
                    <div className="form-text">Get a webhook URL from <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer">Slack API</a></div>
                  </div>
                  <button className="btn btn-sm btn-outline-success rounded-3 mt-3 d-flex align-items-center gap-1" onClick={() => handleTest('slack')} disabled={testing.slack || !config.slack.webhook_url}>
                    {testing.slack ? <><span className="spinner-border spinner-border-sm" /> Testing...</> : <><i className="material-icons-outlined" style={{ fontSize: 16 }}>send</i>Test Slack</>}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Email */}
          <div className="card border-0 rounded-3 mb-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="card-body p-4">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div className="d-flex align-items-center gap-2">
                  <div className="d-flex align-items-center justify-content-center rounded-3" style={{ width: 36, height: 36, background: config.email.enabled ? '#3b82f615' : '#f1f5f9' }}>
                    <i className="material-icons-outlined" style={{ fontSize: 20, color: config.email.enabled ? '#3b82f6' : '#94a3b8' }}>email</i>
                  </div>
                  <h6 className="mb-0 fw-semibold">Email Notifications</h6>
                </div>
                <ChannelToggle label={config.email.enabled ? 'Enabled' : 'Disabled'} enabled={config.email.enabled} onChange={v => setConfig({ ...config, email: { ...config.email, enabled: v } })} />
              </div>

              {config.email.enabled && (
                <div className="pt-2 border-top">
                  <div className="row g-3 mt-1">
                    <div className="col-md-8">
                      <label className="form-label fw-medium small">SMTP Host</label>
                      <input type="text" className="form-control form-control-sm rounded-3" value={config.email.smtp_host} onChange={e => setConfig({ ...config, email: { ...config.email, smtp_host: e.target.value } })} placeholder="smtp.gmail.com" />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label fw-medium small">SMTP Port</label>
                      <input type="number" className="form-control form-control-sm rounded-3" value={config.email.smtp_port} onChange={e => setConfig({ ...config, email: { ...config.email, smtp_port: parseInt(e.target.value) || 587 } })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label fw-medium small">Username</label>
                      <input type="text" className="form-control form-control-sm rounded-3" value={config.email.username} onChange={e => setConfig({ ...config, email: { ...config.email, username: e.target.value } })} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label fw-medium small">Password</label>
                      <input type="password" className="form-control form-control-sm rounded-3" value={config.email.password} onChange={e => setConfig({ ...config, email: { ...config.email, password: e.target.value } })} />
                    </div>
                    <div className="col-12">
                      <label className="form-label fw-medium small">From Email</label>
                      <input type="email" className="form-control form-control-sm rounded-3" value={config.email.from_email} onChange={e => setConfig({ ...config, email: { ...config.email, from_email: e.target.value } })} placeholder="alerts@example.com" />
                    </div>
                    <div className="col-12">
                      <label className="form-label fw-medium small">Recipients (comma-separated)</label>
                      <input type="text" className="form-control form-control-sm rounded-3" value={config.email.recipients.join(', ')} onChange={e => setConfig({ ...config, email: { ...config.email, recipients: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })} placeholder="user1@example.com, user2@example.com" />
                    </div>
                    <div className="col-12">
                      <div className="form-check">
                        <input className="form-check-input" type="checkbox" id="use_tls" checked={config.email.use_tls} onChange={e => setConfig({ ...config, email: { ...config.email, use_tls: e.target.checked } })} />
                        <label className="form-check-label small" htmlFor="use_tls">Use TLS encryption</label>
                      </div>
                    </div>
                  </div>
                  <button className="btn btn-sm btn-outline-success rounded-3 mt-3 d-flex align-items-center gap-1" onClick={() => handleTest('email')} disabled={testing.email}>
                    {testing.email ? <><span className="spinner-border spinner-border-sm" /> Testing...</> : <><i className="material-icons-outlined" style={{ fontSize: 16 }}>send</i>Test Email</>}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Webhook */}
          <div className="card border-0 rounded-3 mb-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="card-body p-4">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div className="d-flex align-items-center gap-2">
                  <div className="d-flex align-items-center justify-content-center rounded-3" style={{ width: 36, height: 36, background: config.webhook.enabled ? '#10b98115' : '#f1f5f9' }}>
                    <i className="material-icons-outlined" style={{ fontSize: 20, color: config.webhook.enabled ? '#10b981' : '#94a3b8' }}>webhook</i>
                  </div>
                  <h6 className="mb-0 fw-semibold">Webhook Notifications</h6>
                </div>
                <ChannelToggle label={config.webhook.enabled ? 'Enabled' : 'Disabled'} enabled={config.webhook.enabled} onChange={v => setConfig({ ...config, webhook: { ...config.webhook, enabled: v } })} />
              </div>

              {config.webhook.enabled && (
                <div className="pt-2 border-top">
                  <div className="mt-3">
                    <label className="form-label fw-medium small">Webhook URL</label>
                    <input type="url" className="form-control form-control-sm rounded-3" value={config.webhook.url} onChange={e => setConfig({ ...config, webhook: { ...config.webhook, url: e.target.value } })} placeholder="https://webhook.site/your-unique-url" />
                    <div className="form-text">Test with <a href="https://webhook.site" target="_blank" rel="noreferrer">webhook.site</a></div>
                  </div>
                  <button className="btn btn-sm btn-outline-success rounded-3 mt-3 d-flex align-items-center gap-1" onClick={() => handleTest('webhook')} disabled={testing.webhook || !config.webhook.url}>
                    {testing.webhook ? <><span className="spinner-border spinner-border-sm" /> Testing...</> : <><i className="material-icons-outlined" style={{ fontSize: 16 }}>send</i>Test Webhook</>}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Save Button */}
          <div className="d-flex justify-content-end">
            <button className="btn btn-primary rounded-3 d-flex align-items-center gap-2 px-4" onClick={handleSave} disabled={saving} style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', border: 'none' }}>
              {saving ? <><span className="spinner-border spinner-border-sm" /> Saving...</> : <><i className="material-icons-outlined" style={{ fontSize: 18 }}>save</i>Save Configuration</>}
            </button>
          </div>
        </>
      )}

      {!config && !loading && (
        <div className="card border-0 rounded-3" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="card-body text-center py-5">
            <i className="material-icons-outlined text-muted mb-2" style={{ fontSize: 48, opacity: 0.3 }}>settings</i>
            <p className="fw-semibold mb-1">Select a testbed to configure alerts</p>
            <p className="text-muted small mb-0">Choose a testbed from the dropdown above to manage its notification settings.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default AlertConfiguration;
