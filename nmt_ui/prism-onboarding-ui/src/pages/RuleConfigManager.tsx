import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import RuleBuilderExperimental from '../components/RuleBuilderExperimental';
import ntnxLogo from '../assets/new_nutanix_logo.png';
import { IS_FAKE_MODE } from '../config/fakeMode';
import { getFakeTestbeds, getFakeRulesByTestbed } from '../fake-data';
import { getApiBase } from '../utils/backendUrl';

interface Testbed {
  id: number;
  unique_testbed_id: string;
  testbed_label: string;
  pc_ip: string | null;
  ncm_ip: string | null;
  uuid: string | null;
}

interface Rule {
  id: string;
  testbed_id: string;
  pc_ip: string;
  timestamp: string;
  config: any;
}

const RuleConfigManager: React.FC = () => {
  const navigate = useNavigate();
  
  // State
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [selectedTestbed, setSelectedTestbed] = useState<string>('');
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [showRuleBuilder, setShowRuleBuilder] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [testingSlack, setTestingSlack] = useState(false);
  const [slackWebhookUrl, setSlackWebhookUrl] = useState<string>('');
  const [showSlackConfig, setShowSlackConfig] = useState(false);

  // Fetch testbeds on mount and check for pre-selected testbed
  useEffect(() => {
    fetchTestbeds();
    
    // Check if testbed was pre-selected from MyTestbeds
    const preSelectedTestbedId = localStorage.getItem('unique_testbed_id');
    if (preSelectedTestbedId) {
      setSelectedTestbed(preSelectedTestbedId);
      // Clear it after use
      localStorage.removeItem('unique_testbed_id');
    }
  }, []);

  // Fetch rules when testbed selected
  useEffect(() => {
    if (selectedTestbed) {
      fetchRulesForTestbed(selectedTestbed);
    } else {
      setRules([]);
    }
  }, [selectedTestbed]);

  const fetchTestbeds = async () => {
    try {
      // FAKE DATA MODE
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const data = getFakeTestbeds();
        setTestbeds(data.testbeds || []);
        return;
      }

      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/get-testbeds`);
      const data = await response.json();
      
      if (data.success) {
        setTestbeds(data.testbeds || []);
      }
    } catch (error) {
      console.error('Error fetching testbeds:', error);
      showError('Failed to fetch testbeds');
    }
  };

  const fetchRulesForTestbed = async (testbedId: string) => {
    setLoading(true);
    try {
      // FAKE DATA MODE
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 400));
        const data = getFakeRulesByTestbed(testbedId);
        setRules(data.rules || []);
        setLoading(false);
        return;
      }

      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/get-rules-by-testbed/${testbedId}`);
      const data = await response.json();
      
      if (data.success) {
        setRules(data.rules || []);
      } else {
        showError('Failed to fetch rules');
      }
    } catch (error) {
      console.error('Error fetching rules:', error);
      showError('Failed to fetch rules');
    } finally {
      setLoading(false);
    }
  };

  const handleAddRule = () => {
    if (!selectedTestbed) {
      showError('Please select a testbed first');
      return;
    }
    setEditingRule(null);
    setShowRuleBuilder(true);
  };

  const handleEditRule = (rule: Rule) => {
    setEditingRule(rule);
    setShowRuleBuilder(true);
  };

  const handleSaveRule = async (ruleConfig: any) => {
    try {
      const backendUrl = getApiBase();
      let savedRuleId = null;
      
      if (editingRule) {
        // Update existing rule
        const response = await fetch(`${backendUrl}/api/update-rule/${editingRule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rule_config: ruleConfig })
        });
        
        const data = await response.json();
        if (data.success) {
          savedRuleId = editingRule.id;
          showSuccess('Rule updated successfully');
          await fetchRulesForTestbed(selectedTestbed);
        } else {
          showError(data.error || 'Failed to update rule');
          return;
        }
      } else {
        // Add new rule
        const response = await fetch(`${backendUrl}/api/add-rule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            testbed_id: selectedTestbed,
            rule_config: ruleConfig
          })
        });
        
        const data = await response.json();
        if (data.success) {
          savedRuleId = data.rule_id;
          showSuccess('Rule added successfully');
          await fetchRulesForTestbed(selectedTestbed);
        } else {
          showError(data.error || 'Failed to add rule');
          return;
        }
      }
      
      setShowRuleBuilder(false);
      setEditingRule(null);
      
      // Auto-deploy rules after successful save
      if (savedRuleId) {
        console.log('[DEBUG] Auto-deploying rules after save...');
        await handleDeployRules();
      }
    } catch (error) {
      console.error('Error saving rule:', error);
      showError('Failed to save rule');
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) {
      return;
    }
    
    try {
      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/delete-rule/${ruleId}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      if (data.success) {
        showSuccess('Rule deleted successfully');
        fetchRulesForTestbed(selectedTestbed);
      } else {
        showError(data.error || 'Failed to delete rule');
      }
    } catch (error) {
      console.error('Error deleting rule:', error);
      showError('Failed to delete rule');
    }
  };

  const handleDeployRules = async () => {
    if (!selectedTestbed) {
      showError('Please select a testbed');
      return;
    }
    
    if (rules.length === 0) {
      showError('No rules to deploy');
      return;
    }
    
    try {
      const backendUrl = getApiBase();
      
      // Get the latest rule config
      const latestRule = rules[0];
      
      // Ensure timestamp is present
      const timestamp = latestRule.timestamp || new Date().toISOString();
      
      const response = await fetch(`${backendUrl}/api/deploy-config-immediate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unique_testbed_id: selectedTestbed,
          unique_rule_id: latestRule.id,
          pc_ip: latestRule.pc_ip,
          config: latestRule.config,
          timestamp: timestamp
        })
      });
      
      const data = await response.json();
      if (data.success) {
        showSuccess('Rules deployed to Prometheus successfully');
      } else {
        showError(data.error || 'Failed to deploy rules');
      }
    } catch (error) {
      console.error('Error deploying rules:', error);
      showError('Failed to deploy rules');
    }
  };

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setErrorMessage('');
    setTimeout(() => setSuccessMessage(''), 5000);
  };

  const showError = (message: string) => {
    setErrorMessage(message);
    setSuccessMessage('');
    setTimeout(() => setErrorMessage(''), 5000);
  };

  const handleTestSlackAlert = async () => {
    if (!slackWebhookUrl) {
      showError('Please enter a Slack webhook URL');
      return;
    }

    setTestingSlack(true);
    try {
      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/test-slack-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_url: slackWebhookUrl,
          testbed_id: selectedTestbed,
          testbed_label: selectedTestbedData?.testbed_label || 'Test Testbed'
        })
      });

      const data = await response.json();
      if (data.success) {
        showSuccess('Test alert sent to Slack successfully! Check your channel.');
      } else {
        showError(data.error || 'Failed to send test alert');
      }
    } catch (error) {
      console.error('Error testing Slack alert:', error);
      showError('Failed to send test alert');
    } finally {
      setTestingSlack(false);
    }
  };

  const handleUpdateSlackWebhook = async () => {
    if (!selectedTestbed || !slackWebhookUrl) {
      showError('Please select a testbed and enter a webhook URL');
      return;
    }

    try {
      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/update-slack-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testbed_id: selectedTestbed,
          webhook_url: slackWebhookUrl
        })
      });

      const data = await response.json();
      if (data.success) {
        showSuccess('Slack webhook URL updated successfully');
        setShowSlackConfig(false);
      } else {
        showError(data.error || 'Failed to update webhook URL');
      }
    } catch (error) {
      console.error('Error updating Slack webhook:', error);
      showError('Failed to update webhook URL');
    }
  };

  const getSlackWebhookFromRule = (rule: Rule) => {
    return rule.config?.alert_destination?.value || '';
  };

  const getRuleName = (rule: Rule) => {
    // Extract rule name from config
    if (rule.config?.Config?.rules) {
      const rulesList = Object.values(rule.config.Config.rules);
      if (rulesList.length > 0) {
        return `${rulesList.length} rule(s)`;
      }
    }
    return 'Rule Config';
  };

  const getRuleType = (rule: Rule) => {
    // Determine rule type from config
    if (rule.config?.Config?.rules?.pod_rules) return 'Pod Rules';
    if (rule.config?.Config?.rules?.node_rules) return 'Node Rules';
    return 'Mixed Rules';
  };

  const selectedTestbedData = testbeds.find(tb => tb.unique_testbed_id === selectedTestbed);

  return (
    <div className="main-content">
      {/* Breadcrumb */}
      <div className="d-flex align-items-center justify-content-between mb-4">
        <nav aria-label="breadcrumb">
          <ol className="breadcrumb mb-0">
            <li className="breadcrumb-item">
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }}>
                <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle' }}>home</i>
              </a>
            </li>
            <li className="breadcrumb-item active">Rule & Config Manager</li>
          </ol>
        </nav>
      </div>

      {/* Page Title */}
      <div className="mb-4">
        <h1 className="h3 mb-2 text-gray-800">
          <i className="material-icons-outlined" style={{ fontSize: 28, verticalAlign: 'middle', marginRight: 8, color: '#667eea' }}>rule</i>
          Rule & Config Manager
        </h1>
        <p className="text-muted mb-0">Configure and manage monitoring rules for your testbeds without JSON files</p>
      </div>
      {/* Messages */}
      {successMessage && (
        <div className="alert alert-success alert-dismissible fade show d-flex align-items-center" role="alert">
          <i className="material-icons-outlined me-2">check_circle</i>
          <div>{successMessage}</div>
          <button type="button" className="btn-close" onClick={() => setSuccessMessage('')} aria-label="Close"></button>
        </div>
      )}
      
      {errorMessage && (
        <div className="alert alert-danger alert-dismissible fade show d-flex align-items-center" role="alert">
          <i className="material-icons-outlined me-2">error_outline</i>
          <div>{errorMessage}</div>
          <button type="button" className="btn-close" onClick={() => setErrorMessage('')} aria-label="Close"></button>
        </div>
      )}

      {/* Testbed Selector */}
      <div className="card border-0 shadow-sm mb-4">
        <div className="card-body p-4">
          <h5 className="card-title mb-3">
            <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 8, color: '#667eea' }}>dns</i>
            Select Testbed
          </h5>
          <div className="row g-3 align-items-center">
            <div className="col-md-8">
              <select
                value={selectedTestbed}
                onChange={(e) => setSelectedTestbed(e.target.value)}
                className="form-select form-select-lg"
              >
                <option value="">-- Select a Testbed to Manage Rules --</option>
                {testbeds.map(tb => (
                  <option key={tb.unique_testbed_id} value={tb.unique_testbed_id}>
                    {tb.testbed_label} ({tb.ncm_ip || tb.pc_ip || 'Not Deployed'})
                  </option>
                ))}
              </select>
            </div>
            
            {selectedTestbedData && (
              <div className="col-md-4">
                <span className={`badge ${selectedTestbedData.ncm_ip ? 'bg-success' : 'bg-warning'} px-3 py-2`} style={{ fontSize: '0.9rem' }}>
                  <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>
                    {selectedTestbedData.ncm_ip ? 'check_circle' : 'pending'}
                  </i>
                  {selectedTestbedData.ncm_ip ? 'Active' : 'Configured'}
                </span>
              </div>
            )}
          </div>
          
          {selectedTestbedData && (
            <div className="mt-3 p-3 bg-light rounded">
              <div className="row g-2 small text-muted">
                <div className="col-12">
                  <strong className="text-dark">Testbed Details:</strong>
                </div>
                {selectedTestbedData.pc_ip && (
                  <div className="col-md-4">
                    <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }}>computer</i>
                    <strong>PC IP:</strong> {selectedTestbedData.pc_ip}
                  </div>
                )}
                {selectedTestbedData.ncm_ip && (
                  <div className="col-md-4">
                    <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }}>cloud</i>
                    <strong>NCM IP:</strong> {selectedTestbedData.ncm_ip}
                  </div>
                )}
                {selectedTestbedData.uuid && (
                  <div className="col-md-4">
                    <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }}>fingerprint</i>
                    <strong>UUID:</strong> {selectedTestbedData.uuid.substring(0, 8)}...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Rules List */}
      {selectedTestbed && (
        <>
        <div className="card border-0 shadow-sm mb-4">
          <div className="card-header bg-white py-3">
            <div className="d-flex justify-content-between align-items-center">
              <h5 className="mb-0">
                <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 8, color: '#667eea' }}>list_alt</i>
                Rules for {selectedTestbedData?.testbed_label}
              </h5>
              <div className="d-flex gap-2">
                <button
                  onClick={handleAddRule}
                  className="btn btn-primary d-flex align-items-center gap-2"
                >
                  <i className="material-icons-outlined" style={{ fontSize: 18 }}>add</i>
                  Add New Rule
                </button>
                
                {rules.length > 0 && (
                  <button
                    onClick={handleDeployRules}
                    className="btn btn-success d-flex align-items-center gap-2"
                  >
                    <i className="material-icons-outlined" style={{ fontSize: 18 }}>rocket_launch</i>
                    Deploy Rules
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-5">
                <div className="spinner-border text-primary" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
                <p className="text-muted mt-2">Loading rules...</p>
              </div>
            ) : rules.length === 0 ? (
              <div className="text-center py-5 px-4">
                <i className="material-icons-outlined text-muted" style={{ fontSize: 48 }}>rule</i>
                <h6 className="text-muted mt-3 mb-2">No Rules Configured Yet</h6>
                <p className="text-muted small mb-0">Click "Add New Rule" to create your first monitoring rule for this testbed.</p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="px-4 py-3">Rule Name</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">PC IP</th>
                      <th className="px-4 py-3">Slack Alert</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3 text-end">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map(rule => (
                      <tr key={rule.id}>
                        <td className="px-4 py-3">
                          <i className="material-icons-outlined text-primary" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 8 }}>description</i>
                          {getRuleName(rule)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="badge bg-info">{getRuleType(rule)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <code className="text-muted">{rule.pc_ip}</code>
                        </td>
                        <td className="px-4 py-3">
                          {getSlackWebhookFromRule(rule) ? (
                            <span className="badge bg-success">
                              <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>check</i> Configured
                            </span>
                          ) : (
                            <span className="badge bg-secondary">Not Set</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted small">
                          {new Date(rule.timestamp).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-end">
                          <button
                            onClick={() => handleEditRule(rule)}
                            className="btn btn-sm btn-warning me-2"
                            title="Edit Rule"
                          >
                            <i className="material-icons-outlined" style={{ fontSize: 16 }}>edit</i>
                          </button>
                          <button
                            onClick={() => handleDeleteRule(rule.id)}
                            className="btn btn-sm btn-danger"
                            title="Delete Rule"
                          >
                            <i className="material-icons-outlined" style={{ fontSize: 16 }}>delete</i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Slack Alert Configuration */}
        <div className="card border-0 shadow-sm">
          <div className="card-header bg-white d-flex justify-content-between align-items-center">
            <h5 className="card-title mb-0">
              <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 8, color: '#611f69' }}>notifications_active</i>
              Slack Alert Configuration
            </h5>
            <button
              onClick={() => setShowSlackConfig(!showSlackConfig)}
              className="btn btn-sm btn-outline-primary"
            >
              <i className="material-icons-outlined" style={{ fontSize: 16 }}>
                {showSlackConfig ? 'expand_less' : 'expand_more'}
              </i>
            </button>
          </div>

          {showSlackConfig && (
            <div className="card-body">
              <div className="alert alert-info d-flex align-items-start">
                <i className="material-icons-outlined me-2" style={{ fontSize: 20 }}>info</i>
                <div>
                  <strong>How to get a Slack Webhook URL:</strong>
                  <ol className="mb-0 mt-2 ps-3">
                    <li>Go to your Slack workspace → <strong>Apps</strong></li>
                    <li>Search for <strong>"Incoming Webhooks"</strong> and add it</li>
                    <li>Choose a channel (e.g., #ncm_monitoring)</li>
                    <li>Copy the generated webhook URL</li>
                  </ol>
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label">
                  <strong>Slack Webhook URL</strong>
                  <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
                  value={slackWebhookUrl}
                  onChange={(e) => setSlackWebhookUrl(e.target.value)}
                />
                <small className="text-muted">This URL will be used to send alert notifications to your Slack channel</small>
              </div>

              {rules.length > 0 && getSlackWebhookFromRule(rules[0]) && (
                <div className="alert alert-success mb-3">
                  <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 8 }}>check_circle</i>
                  <strong>Current webhook:</strong> {getSlackWebhookFromRule(rules[0]).substring(0, 50)}...
                </div>
              )}

              <div className="d-flex gap-2">
                <button
                  onClick={handleTestSlackAlert}
                  disabled={testingSlack || !slackWebhookUrl}
                  className="btn btn-warning d-flex align-items-center gap-2"
                >
                  {testingSlack ? (
                    <>
                      <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                      Sending Test...
                    </>
                  ) : (
                    <>
                      <i className="material-icons-outlined" style={{ fontSize: 18 }}>send</i>
                      Test Slack Alert
                    </>
                  )}
                </button>
                
                <button
                  onClick={handleUpdateSlackWebhook}
                  disabled={!slackWebhookUrl}
                  className="btn btn-primary d-flex align-items-center gap-2"
                >
                  <i className="material-icons-outlined" style={{ fontSize: 18 }}>save</i>
                  Save Webhook URL
                </button>
              </div>

              <div className="mt-3 p-3 bg-light rounded">
                <h6 className="mb-2">
                  <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 4 }}>lightbulb</i>
                  What happens when alerts trigger?
                </h6>
                <ul className="mb-0 small text-muted">
                  <li>Prometheus monitors your testbed based on configured rules</li>
                  <li>When a threshold is exceeded, an alert is triggered</li>
                  <li>Alert is sent to Alertmanager</li>
                  <li>Alertmanager routes the alert to your Slack channel</li>
                  <li>You receive a notification with alert details (name, severity, description)</li>
                </ul>
              </div>
            </div>
          )}
        </div>
        </>
      )}

      {!selectedTestbed && (
        <div className="card border-0 shadow-sm">
          <div className="card-body text-center py-5">
            <div style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)'
            }}>
              <i className="material-icons-outlined text-white" style={{ fontSize: 40 }}>rule</i>
            </div>
            <h4 className="mb-3">Welcome to Rule & Config Manager</h4>
            <p className="text-muted mb-3">
              Select a testbed from the dropdown above to view and manage its monitoring rules.
            </p>
            <div className="row g-3 mt-4">
              <div className="col-md-4">
                <div className="p-3 bg-light rounded">
                  <i className="material-icons-outlined text-primary" style={{ fontSize: 32 }}>add_circle</i>
                  <h6 className="mt-2 mb-1">Add Multiple Rules</h6>
                  <small className="text-muted">Configure multiple rules per testbed</small>
                </div>
              </div>
              <div className="col-md-4">
                <div className="p-3 bg-light rounded">
                  <i className="material-icons-outlined text-success" style={{ fontSize: 32 }}>cloud_done</i>
                  <h6 className="mt-2 mb-1">No JSON Files</h6>
                  <small className="text-muted">Direct configuration without downloads</small>
                </div>
              </div>
              <div className="col-md-4">
                <div className="p-3 bg-light rounded">
                  <i className="material-icons-outlined text-warning" style={{ fontSize: 32 }}>rocket_launch</i>
                  <h6 className="mt-2 mb-1">Easy Deployment</h6>
                  <small className="text-muted">Deploy rules with a single click</small>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rule Builder Modal */}
      {showRuleBuilder && (
        <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex={-1}>
          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header bg-light">
                <h5 className="modal-title d-flex align-items-center gap-2">
                  <i className="material-icons-outlined text-primary">
                    {editingRule ? 'edit' : 'add_circle'}
                  </i>
                  {editingRule ? 'Edit Rule Configuration' : 'Add New Rule Configuration'}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowRuleBuilder(false);
                    setEditingRule(null);
                  }}
                  aria-label="Close"
                ></button>
              </div>
              
              <div className="modal-body">
                <RuleBuilderExperimental
                  onSave={handleSaveRule}
                  initialConfig={editingRule?.config}
                  testbedContext={{
                    unique_testbed_id: selectedTestbed,
                    testbed: testbeds.find(t => t.unique_testbed_id === selectedTestbed),
                    simpleMode: true
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RuleConfigManager;
