import React, { useState, useEffect } from 'react';
import ntnxLogo from '../assets/ntnx_logo.png';
import { saveAs } from 'file-saver';
import { useOnboarding } from '../context/OnboardingContext';
import type { RuleConfig, MetricConfig } from '../types/onboarding';
import Select from 'react-select';
import { useNavigate } from 'react-router-dom';


import nameAndPodDataRaw from '../name-and-pod.json';
import metricAndThresholdDataRaw from '../metric-and-threshold.json';
// import metricAndThresholdDataRaw from '../prometheus-metrics.json';

// Add index signatures for JSON imports
const nameAndPodData: { [namespace: string]: string[] } = nameAndPodDataRaw as any;
const metricAndThresholdData: { [metric: string]: { defaultThreshold?: string } } = metricAndThresholdDataRaw as any;

const namespaceOptions = Object.keys(nameAndPodData).map(ns => ({ value: ns, label: ns }));
const metricOptions = Object.keys(metricAndThresholdData).map(metric => ({ value: metric, label: metric }));


const RuleBuilder: React.FC<{ onSave: (rule: RuleConfig) => void }> = ({ onSave }) => {
  const { onboardingForm } = useOnboarding();
  const navigate = useNavigate();
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [pods, setPods] = useState<string[]>([]);
  const [groupedPodOptions, setGroupedPodOptions] = useState<any[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  // Alert destination state (must be inside component)
  const [alertDestinationType] = useState<'slack' | 'email'>('slack');
  const [alertDestinationValue] = useState('');

  type RuleCondition = {
    pod: string;
    metric: string;
    threshold: string;
    operator?: 'AND' | 'OR';
    comparisonOperator?: '>' | '<';
    unit?: 'Memory (GB)' | 'Time (ms)' | 'Percentage' | 'Count';
  };
  type RuleBookEntry = {
    conditions: RuleCondition[];
    severity: 'Low' | 'Moderate' | 'Critical';
    description?: string;
    overrideCondition?: string;
  };
  
  const [ruleBook, setRuleBook] = useState<RuleBookEntry[]>([]);

  const handleRuleDescriptionChange = (ruleIdx: number, value: string) => {
    setRuleBook(prev => prev.map((rule, idx) => idx === ruleIdx ? { ...rule, description: value } : rule));
  };
  const handleAddRule = () => {
    setRuleBook(prev => [
      ...prev,
      {
        conditions: [
          { pod: pods[0] || '', metric: selectedMetrics[0] || '', threshold: '', operator: 'AND', comparisonOperator: '>', unit: 'Memory (GB)' }
        ],
        severity: 'Moderate'
      }
    ]);
  };

  // For per-condition pod select
  const handleRuleConditionPodChange = (ruleIdx: number, condIdx: number, pod: string) => {
    setRuleBook(prev => prev.map((rule, idx) => {
      if (idx !== ruleIdx) return rule;
      const newConds = rule.conditions.map((cond, cidx) => cidx === condIdx ? { ...cond, pod } : cond);
      return { ...rule, conditions: newConds };
    }));
  };
  const handleRuleConditionChange = (ruleIdx: number, condIdx: number, field: keyof RuleCondition, value: string) => {
    setRuleBook(prev => prev.map((rule, idx) => {
      if (idx !== ruleIdx) return rule;
      const newConds = rule.conditions.map((cond, cidx) => cidx === condIdx ? { ...cond, [field]: value } : cond);
      return { ...rule, conditions: newConds };
    }));
  };
  const handleAddCondition = (ruleIdx: number) => {
    setRuleBook(prev => prev.map((rule, idx) => {
      if (idx !== ruleIdx) return rule;
      const prevOperator = rule.conditions.length > 0 ? rule.conditions[rule.conditions.length - 1].operator || 'AND' : 'AND';
      return {
        ...rule,
        conditions: [
          ...rule.conditions,
          { pod: pods[0] || '', metric: selectedMetrics[0] || '', threshold: '', operator: prevOperator, comparisonOperator: '>', unit: 'Memory (GB)' }
        ]
      };
    }));
  };
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 16px',
    border: '1px solid #ccc',
    borderRadius: 4,
    fontSize: 14,
    marginTop: 4,
    backgroundColor: '#fff',
    color: '#000'
  };
  const customSelectStyles = {
    option: (provided: any, state: any) => ({
      ...provided,
      backgroundColor: state.isSelected
        ? '#0078d4'
        : state.isFocused
        ? '#e6f0fa'
        : '#fff',
      color: state.isSelected ? '#fff' : '#333',
      fontWeight: state.isSelected ? 600 : 400,
      padding: 10,
    }),
    multiValue: (provided: any) => ({
      ...provided,
      backgroundColor: '#0078d4',
      color: '#fff',
    }),
    multiValueLabel: (provided: any) => ({
      ...provided,
      color: '#fff',
    }),
    multiValueRemove: (provided: any) => ({
      ...provided,
      color: '#fff',
      ':hover': {
        backgroundColor: '#005a9e',
        color: '#fff',
      },
    }),
  };
  const podSelectStyles = {
    ...customSelectStyles,
    option: (provided: any, state: any) => ({
      ...provided,
      backgroundColor: state.isSelected
        ? '#0078d4'
        : state.isFocused
        ? '#e6f0fa'
        : '#fff',
      color: state.isSelected ? '#fff' : '#333',
      fontWeight: state.isSelected ? 600 : 400,
      padding: '10px 10px 10px 32px',
    }),
  };
  const handleMetricSelect = (selectedOptions: any) => {
    const metrics: string[] = selectedOptions ? selectedOptions.map((opt: any) => opt.value) : [];
    setSelectedMetrics(metrics);
  };

  useEffect(() => {
    if (namespaces.length === 0) {
      setGroupedPodOptions([]);
      setPods([]);
      return;
    }
    const groups = namespaces.map(ns => ({
      label: ns,
      options: (nameAndPodData[ns] || []).map(pod => ({ value: pod, label: pod }))
    }));
    const allPods = groups.flatMap(g => g.options.map(opt => opt.value));
    setGroupedPodOptions(groups);
    setPods(prev => prev.filter(pod => allPods.includes(pod)));
  }, [namespaces]);

  // Rules Saved to Json, and sent to backend using run_backend.py
  const handleSave = async () => {
    if (!onboardingForm) return;
    const config: any = {
      pc_ip: onboardingForm.pcIp,
      username: onboardingForm.username,
      password: onboardingForm.password,
      testbed_label: onboardingForm.ncmLabel || pods[0] || '',
      alert_destination: {
        type: alertDestinationType,
        value: alertDestinationValue
      }
    };
    ruleBook.forEach((rule, idx) => {
      const conditionArr: any[] = [];
      rule.conditions.forEach((cond, condIdx) => {
        // Find namespace for this pod
        let foundNamespace = '';
        for (const ns of namespaces) {
          if ((nameAndPodData[ns] || []).includes(cond.pod)) {
            foundNamespace = ns;
            break;
          }
        }
        conditionArr.push({
          namespace: foundNamespace || (namespaces[0] || ''),
          pod_name: cond.pod,
          metric: cond.metric,
          operator: cond.comparisonOperator || '>',
          value: cond.threshold,
          unit: cond.unit || 'Memory (GB)'
        });
        if (condIdx < rule.conditions.length - 1) {
          conditionArr.push({ logical_operator: cond.operator || 'AND' });
        }
      });
      config[`rule${idx + 1}`] = {
        severity: rule.severity,
        description: rule.description || '',
        override_condition: rule.overrideCondition || '',
        condition: conditionArr
      };
    });
    
    // Structure the config with Rules bracket
    const configJson = { 
      Config: {
        ...config,
        Rules: {}
      }
    };
    
    // Move the rules into the Rules bracket
    const baseConfig = { ...config };
    const rules: any = {};
    Object.keys(baseConfig).forEach(key => {
      if (key.startsWith('rule')) {
        rules[key] = (baseConfig as any)[key];
        delete (baseConfig as any)[key];
      }
    });
    
    configJson.Config = {
      ...baseConfig,
      Rules: rules
    };
    
    // Download the file locally (keep existing functionality)
    const blob = new Blob([JSON.stringify(configJson, null, 2)], { type: 'application/json' });
    saveAs(blob, 'nmt_config.json');
    
    // Show success message after download
    setShowSuccess(true);
    
    // COMMENTED OUT: IMMEDIATE DEPLOYMENT - Send config directly to backend for immediate run_backen.py execution
    // try {
    //   console.log('Immediately deploying config to remote server...');
    //   const backendUrl = 'http://localhost:5000';
    //   const deployResponse = await fetch(`${backendUrl}/api/deploy-config-immediate`, {
    //     method: 'POST',
    //     headers: {
    //       'Content-Type': 'application/json',
    //     },
    //     body: JSON.stringify({
    //       config: configJson,
    //       timestamp: new Date().toISOString()
    //     })
    //   });
    //   
    //   const deployResult = await deployResponse.json();
    //   if (deployResult.success) {
    //     console.log('Config deployed immediately:', deployResult.message);
    //     console.log('Remote output:', deployResult.stdout);
    //     setShowSuccess(true);
    //   } else {
    //     console.error('Failed to deploy config immediately:', deployResult.error);
    //   }
    // } catch (error) {
    //   console.error('Error in immediate deployment:', error);
    // }

    // Hide Svae Rule Button Oonce Saved

    

    // Also send to Prometheus server via backend (optional/secondary)
    // try {
    //   const prometheusEndpoint = onboardingForm.prometheusEndpoint || `http://${onboardingForm.pcIp}:9090`;
    //   const backendUrl = 'http://localhost:5000';
    //   const response = await fetch(`${backendUrl}/api/upload-config`, {
    //     method: 'POST',
    //     headers: {
    //       'Content-Type': 'application/json',
    //     },
    //     body: JSON.stringify({
    //       config: configJson,
    //       prometheus_endpoint: prometheusEndpoint,
    //       timestamp: new Date().toISOString()
    //     })
    //   });
      
    //   const result = await response.json();
    //   if (result.success) {
    //     console.log('Config also uploaded to Prometheus:', result.message);
    //   } else {
    //     console.error('Failed to upload to Prometheus:', result.error);
    //   }
    // } catch (error) {
    //   console.error('Error uploading to Prometheus:', error);
    // }
    
    // Message now stays permanently - no auto-hide
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
            <li className="breadcrumb-item active">Rule Builder</li>
          </ol>
        </nav>
      </div>

      <div style={{
        maxWidth: 1000,
        margin: '0 auto',
      }}>
      <div className="card rounded-4 border-0 shadow-sm" style={{
        padding: 32,
      }}>
        <img src={ntnxLogo} alt="Nutanix Logo" style={{ width: 120, margin: '0 auto 0px', display: 'block' }} />
        <h4 style={{ textAlign: 'center', color: '#333', marginTop: 0, marginBottom: 10, fontWeight: 700, letterSpacing: 0.5 }}>NCM Monitoring Tool (Testing)</h4>
        <h3 style={{ textAlign: 'center', color: '#333', marginBottom: 16 }}>Rule Builder Testing</h3>

        {/* Navigation Button to Alert Summary */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <button
            type="button"
            onClick={() => navigate('/alert-summary')}
            style={{
              background: '#28a745',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '10px 20px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            📊 View Alert Summary
          </button>
        </div>

        {/* Namespace select */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h4 style={{ margin: 0, color: '#444' }}>Namespaces</h4>
            <button 
              type="button"
              onClick={() => setNamespaces(Object.keys(nameAndPodData))}
              style={{
                background: '#0078d4',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              Select All
            </button>
          </div>
          
        <Select
          options={namespaceOptions}
          value={namespaceOptions.filter(opt => namespaces.includes(opt.value))}
          onChange={(selectedOptions) =>
            setNamespaces(selectedOptions ? selectedOptions.map(opt => opt.value) : [])
          }
          placeholder="Select Namespaces"
          isMulti
          isClearable
          styles={customSelectStyles}
          closeMenuOnSelect={false}
        />
        </div>

        {/* Pod select (grouped by namespace) */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h4 style={{ margin: 0, color: '#444' }}>Pod Names</h4>
            <button 
              type="button"
              onClick={() => {
                const allPods = groupedPodOptions.flatMap(group => group.options.map((opt: any) => opt.value));
                setPods(allPods);
              }}
              style={{
                background: '#0078d4',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              Select All
            </button>
          </div>
          
        <Select
          options={groupedPodOptions}
          value={(() => {
            const selected: any[] = [];
            groupedPodOptions.forEach((group: any) => {
              group.options.forEach((opt: any) => {
                if (pods.includes(opt.value)) selected.push(opt);
              });
            });
            return selected;
          })()}
          onChange={(selectedOptions: any) =>
            setPods(selectedOptions ? selectedOptions.map((opt: any) => opt.value) : [])
          }
          placeholder="Select Pods"
          isMulti
          isClearable
          styles={podSelectStyles}
          closeMenuOnSelect={false}
        />
        </div>

        {/* Metrics selection and thresholds */}
        <div>
          <h4 style={{ marginBottom: 8, color: '#444' }}>Metrics</h4>
          <Select
            options={metricOptions}
            value={metricOptions.filter(opt => selectedMetrics.includes(opt.value))}
            onChange={handleMetricSelect}
            placeholder="Select Metrics"
            isMulti
            isClearable
            styles={customSelectStyles}
            closeMenuOnSelect={false}
          />
        </div>

        {/* Rule Book Section */}
        <div style={{ marginTop: 32, padding: 16, border: '1px solid #eee', borderRadius: 8, background: '#f8fafd' }}>
          <h3 style={{ color: '#000', marginBottom: 12 }}>Rule Book</h3>
          {ruleBook.map((rule, ruleIdx) => (
            <div key={ruleIdx} style={{ marginBottom: 24, padding: 12, border: '1px solid #ddd', borderRadius: 6, background: '#fff' }}>
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ color: '#000' }}>Rule-{ruleIdx + 1}</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#000' }}>Severity:</span>
                  <select
                    value={rule.severity}
                    onChange={e => setRuleBook(prev => prev.map((r, idx) => idx === ruleIdx ? { ...r, severity: e.target.value as 'Low' | 'Moderate' | 'Critical' } : r))}
                    style={{ ...inputStyle, width: 140, color: '#000', marginLeft: 4 }}
                  >
                    <option value="Low">Low</option>
                    <option value="Moderate">Moderate</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>
              </div>
              {/* Rule Description input */}
              <div style={{ marginBottom: 8 }}>
                <input
                  type="text"
                  value={rule.description || ''}
                  onChange={e => handleRuleDescriptionChange(ruleIdx, e.target.value)}
                  placeholder="Enter rule description..."
                  style={{ ...inputStyle, width: '95%', fontSize: 15, marginTop: 0, marginBottom: 0, background: '#f8fafd', border: '1px solid #ccc' }}
                />
              </div>
              {/* Optional Override Condition input */}
              {/* <div style={{ marginBottom: 10 }}>
                <input
                  type="text"
                  value={rule.overrideCondition || ''}
                  onChange={e => handleOverrideConditionChange(ruleIdx, e.target.value)}
                  placeholder="*Override Condition (optional)"
                  style={{ ...inputStyle, width: '95%', fontSize: 14, marginTop: 0, marginBottom: 0, background: '#f4f4f4', border: '1px solid #bbb', fontStyle: 'italic' }}
                />
              </div> */}
              {/* Pod select is now per condition, not per rule */}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                <thead>
                  <tr style={{ background: '#f0f4fa' }}>
                    <th style={{ border: '1px solid #ddd', padding: 6, fontWeight: 600, color: '#333' }}>Pod Name</th>
                    <th style={{ border: '1px solid #ddd', padding: 6, fontWeight: 600, color: '#333' }}>Metric Name</th>
                    <th style={{ border: '1px solid #ddd', padding: 6, fontWeight: 600, color: '#333' }}>Operator</th>
                    <th style={{ border: '1px solid #ddd', padding: 6, fontWeight: 600, color: '#333' }}>Threshold Value</th>
                    <th style={{ border: '1px solid #ddd', padding: 2, fontWeight: 600, color: '#333', width: 50, minWidth: 50, maxWidth: 50 }}>Unit</th>
                    <th style={{ border: '1px solid #ddd', padding: 6, fontWeight: 600, color: '#333' }}>Logical Operator</th>
                  </tr>
                </thead>
                <tbody>
                  {rule.conditions.map((cond, condIdx) => (
                    <tr key={condIdx}>
                      {/* Pod Name */}
                      <td style={{ border: '1px solid #ddd', padding: 4 }}>
                        <select
                          value={cond.pod}
                          onChange={e => handleRuleConditionPodChange(ruleIdx, condIdx, e.target.value)}
                          style={{ ...inputStyle, width: 120, color: '#000', margin: 0 }}
                        >
                          {pods.map(pod => (
                            <option key={pod} value={pod}>{pod}</option>
                          ))}
                        </select>
                      </td>
                      {/* Metric Name */}
                      <td style={{ border: '1px solid #ddd', padding: 4 }}>
                        <select
                          value={cond.metric}
                          onChange={e => handleRuleConditionChange(ruleIdx, condIdx, 'metric', e.target.value)}
                          style={{ ...inputStyle, width: 140, color: '#000', margin: 0 }}
                        >
                          {selectedMetrics.map(metric => (
                            <option key={metric} value={metric}>{metric}</option>
                          ))}
                        </select>
                      </td>
                      {/* Operator */}
                      <td style={{ border: '1px solid #ddd', padding: 4, textAlign: 'center' }}>
                        <select
                          value={cond.comparisonOperator || '>'}
                          onChange={e => handleRuleConditionChange(ruleIdx, condIdx, 'comparisonOperator', e.target.value as '>' | '<')}
                          style={{ ...inputStyle, width: 60, color: '#000', margin: 0 }}
                        >
                          <option value=">">&gt;</option>
                          <option value="<">&lt;</option>
                        </select>
                      </td>
                      {/* Threshold Value */}
                      <td style={{ border: '1px solid #ddd', padding: 4 }}>
                        <input
                          type="text"
                          value={cond.threshold}
                          onChange={e => handleRuleConditionChange(ruleIdx, condIdx, 'threshold', e.target.value)}
                          style={{ ...inputStyle, width: 90, color: '#000', margin: 0 }}
                        />
                      </td>
                      {/* Unit */}
                      <td style={{ border: '1px solid #ddd', padding: 2, textAlign: 'center', color: '#555', position: 'relative', width: 50, minWidth: 50, maxWidth: 50 }}>
                        <span style={{ position: 'absolute', left: 4, top: 8, fontWeight: 500, color: '#0078d4', fontSize: 13 }}>
                          {cond.unit === 'Time (ms)'
                            ? 'ms'
                            : cond.unit === 'Memory (GB)'
                            ? 'GB'
                            : cond.unit === 'Percentage'
                            ? '%'
                            : cond.unit === 'Count'
                            ? '#'
                            : 'GB'}
                        </span>
                        <select
                          value={cond.unit || 'Memory (GB)'}
                          onChange={e => handleRuleConditionChange(ruleIdx, condIdx, 'unit', e.target.value as 'Memory (GB)' | 'Time (ms)' | 'Percentage')}
                          style={{ ...inputStyle, width: 50, minWidth: 50, maxWidth: 50, color: 'transparent', margin: 0, position: 'relative', zIndex: 1, background: 'transparent', fontSize: 13, paddingLeft: 18 }}
                        >
                          <option value="Memory (GB)">Memory (GB)</option>
                          <option value="Time (ms)">Time (ms)</option>
                          <option value="Percentage">Percentage</option>
                          <option value="Count">Count</option>
                        </select>
                      </td>
                      {/* Logical Operator */}
                      <td style={{ border: '1px solid #ddd', padding: 4, textAlign: 'center' }}>
                        {condIdx < rule.conditions.length - 1 ? (
                          <select
                            value={cond.operator}
                            onChange={e => handleRuleConditionChange(ruleIdx, condIdx, 'operator', e.target.value as 'AND' | 'OR')}
                            style={{ ...inputStyle, width: 85, color: '#000', margin: 0 }}
                          >
                            <option value="AND">AND</option>
                            <option value="OR">OR</option>
                          </select>
                        ) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" onClick={() => handleAddCondition(ruleIdx)} style={{ marginTop: 6, background: '#e6f0fa', color: '#0078d4', border: 'none', borderRadius: 4, padding: '6px 12px', fontWeight: 500, cursor: 'pointer' }}>
                + Add Condition
              </button>
            </div>
          ))}
          <button type="button" onClick={handleAddRule} style={{ background: '#0078d4', color: '#fff', border: 'none', borderRadius: 4, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}>
            + Add Rule
          </button>

          {/* Alert destination selection */}
          {/* <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24, marginBottom: 8 }}>
            <span style={{ fontWeight: 600, color: '#333' }}>Alert Destination:</span>
            <select
              value={alertDestinationType}
              onChange={e => setAlertDestinationType(e.target.value as 'slack' | 'email')}
              style={{ ...inputStyle, width: 100, margin: 0, fontSize: 14 }}
            >
              <option value="slack">Slack</option>
              <option value="email">Email</option>
            </select>
            <input
              type="text"
              value={alertDestinationValue}
              onChange={e => setAlertDestinationValue(e.target.value)}
              placeholder={alertDestinationType === 'slack' ? 'Slack channel (e.g. #alerts)' : 'Email address'}
              style={{ ...inputStyle, width: 220, margin: 0, fontSize: 14 }}
            />
          </div> */}

          {/* Prometheus Connection Test */}
          {/* <div style={{ marginTop: 16, padding: 12, border: '1px solid #ddd', borderRadius: 6, background: '#f9f9f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, color: '#333' }}>Prometheus Connection:</span>
              <button 
                type="button" 
                onClick={testPrometheusConnection}
                disabled={isTestingConnection}
                style={{ 
                  background: isTestingConnection ? '#ccc' : '#28a745', 
                  color: '#fff', 
                  border: 'none', 
                  borderRadius: 4, 
                  padding: '6px 12px', 
                  fontWeight: 500, 
                  cursor: isTestingConnection ? 'not-allowed' : 'pointer' 
                }}
              >
                {isTestingConnection ? 'Testing...' : 'Test Connection'}
              </button>
            </div>
            {connectionStatus && (
              <div style={{ 
                background: '#fff', 
                border: '1px solid #eee', 
                borderRadius: 4, 
                padding: 8, 
                fontSize: 13, 
                fontFamily: 'monospace',
                whiteSpace: 'pre-line',
                color: '#333'
              }}>
                {connectionStatus}
              </div>
            )}
          </div> */}
        </div>

        {showSuccess && (
          <div style={{ margin: '16px 0', color: 'green', fontWeight: 600, fontSize: 18 }}>
            ✅ Congratulations, your TestBed "Name" is being monitored by NCM monitoring tool. Any anamolies observed as per the above rules would be notified on slack channel #ncm_monitoring.
You may also look at "Prometheus end point link" for live alerts

            <div style={{ marginTop: 12 }}>
              <button 
                type="button" 
                onClick={() => setShowSuccess(false)}
                style={{
                  background: '#0078d4',
                  color: '#fff',
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: 4,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontSize: 14
                }}
              >
                Edit Rules
              </button>
            </div>
          </div>
        )}
        {!showSuccess && (
          <button type="button" onClick={handleSave} style={{
            background: '#0078d4',
            color: '#fff',
            padding: '10px 0',
            border: 'none',
            borderRadius: 4,
            fontWeight: 600,
            cursor: 'pointer'
          }}>
            Save Rule
          </button>
        )}
      </div>
      </div>
    </div>
  );
};

export default RuleBuilder;


