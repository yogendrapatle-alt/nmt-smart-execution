/**
 * Multi-Testbed Configure Page
 * 
 * Select multiple testbeds and start parallel executions
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/MultiTestbedConfigure.css';
import { getApiBase } from '../utils/backendUrl';

interface Testbed {
  unique_testbed_id: string;
  testbed_label: string;
  pc_ip: string;
  ncm_ip: string;
  status?: string;
}

interface TestbedGroup {
  group_id: string;
  group_name: string;
  description: string;
  testbed_ids: string[];
  testbed_count: number;
}

const MultiTestbedConfigure: React.FC = () => {
  const navigate = useNavigate();
  
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [groups, setGroups] = useState<TestbedGroup[]>([]);
  const [selectedTestbeds, setSelectedTestbeds] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  
  // Configuration
  const [executionName, setExecutionName] = useState('');
  const [cpuThreshold, setCpuThreshold] = useState(70);
  const [memoryThreshold, setMemoryThreshold] = useState(65);
  const [aiEnabled, setAiEnabled] = useState(true);
  
  // Entity configuration
  const [selectedEntities, setSelectedEntities] = useState<Record<string, string[]>>({
    'vm': ['CREATE', 'DELETE'],
    'blueprint_multi_vm': ['CREATE', 'EXECUTE']
  });
  
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  useEffect(() => {
    fetchTestbeds();
    fetchGroups();
  }, []);

  const fetchTestbeds = async () => {
    try {
      const response = await fetch(`${getApiBase()}/api/get-testbeds`);
      const data = await response.json();
      if (data.success && data.testbeds) {
        setTestbeds(data.testbeds);
      }
    } catch (err) {
      console.error('Error fetching testbeds:', err);
    }
  };

  const fetchGroups = async () => {
    try {
      const response = await fetch('/api/testbed-groups');
      const data = await response.json();
      if (data.success) {
        setGroups(data.groups);
      }
    } catch (err) {
      console.error('Error fetching groups:', err);
    }
  };

  const handleTestbedToggle = (testbedId: string) => {
    setSelectedTestbeds(prev => 
      prev.includes(testbedId)
        ? prev.filter(id => id !== testbedId)
        : [...prev, testbedId]
    );
  };

  const handleGroupSelect = (groupId: string) => {
    setSelectedGroup(groupId);
    
    if (groupId) {
      const group = groups.find(g => g.group_id === groupId);
      if (group) {
        setSelectedTestbeds(group.testbed_ids);
      }
    }
  };

  const handleSelectAll = () => {
    if (selectedTestbeds.length === testbeds.length) {
      setSelectedTestbeds([]);
    } else {
      setSelectedTestbeds(testbeds.map(tb => tb.unique_testbed_id));
    }
  };

  const handleStartExecution = async () => {
    if (selectedTestbeds.length < 2) {
      setMessage({type: 'error', text: 'Please select at least 2 testbeds'});
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/multi-testbed/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          execution_name: executionName || 'Multi-Testbed Execution',
          testbed_ids: selectedTestbeds,
          target_config: {
            cpu_threshold: cpuThreshold,
            memory_threshold: memoryThreshold,
            stop_condition: 'any'
          },
          entities_config: selectedEntities,
          ai_settings: {
            ai_enabled: aiEnabled,
            ml_enabled: aiEnabled
          }
        })
      });

      const data = await response.json();

      if (data.success) {
        setMessage({type: 'success', text: `Started execution on ${data.total_testbeds} testbeds!`});
        
        // Navigate to monitor page after 2 seconds
        setTimeout(() => {
          navigate(`/multi-testbed/monitor/${data.multi_execution_id}`);
        }, 2000);
      } else {
        setMessage({type: 'error', text: data.error || 'Failed to start execution'});
      }
    } catch (err: any) {
      setMessage({type: 'error', text: err.message});
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="multi-testbed-configure">
      <div className="page-header">
        <h1>🚀 Multi-Testbed Orchestration</h1>
        <p>Run Smart Executions across multiple testbeds simultaneously</p>
      </div>

      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="config-container">
        {/* Testbed Selection */}
        <div className="config-section">
          <div className="section-header">
            <h2>Select Testbeds ({selectedTestbeds.length} selected)</h2>
            <button className="btn-secondary" onClick={handleSelectAll}>
              {selectedTestbeds.length === testbeds.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          {/* Group Selection */}
          {groups.length > 0 && (
            <div className="group-selector">
              <label>Quick Select from Group:</label>
              <select value={selectedGroup} onChange={(e) => handleGroupSelect(e.target.value)}>
                <option value="">-- Select a group --</option>
                {groups.map(group => (
                  <option key={group.group_id} value={group.group_id}>
                    {group.group_name} ({group.testbed_count} testbeds)
                  </option>
                ))}
              </select>
              <button 
                className="btn-link"
                onClick={() => navigate('/testbed-groups')}
              >
                Manage Groups
              </button>
            </div>
          )}

          {/* Testbed List */}
          <div className="testbed-list">
            {testbeds.map(testbed => (
              <label key={testbed.unique_testbed_id} className="testbed-item">
                <input
                  type="checkbox"
                  checked={selectedTestbeds.includes(testbed.unique_testbed_id)}
                  onChange={() => handleTestbedToggle(testbed.unique_testbed_id)}
                />
                <div className="testbed-info">
                  <div className="testbed-name">{testbed.testbed_label}</div>
                  <div className="testbed-details">
                    PC: {testbed.pc_ip} | NCM: {testbed.ncm_ip}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Configuration */}
        <div className="config-section">
          <h2>Execution Configuration</h2>

          <div className="form-group">
            <label>Execution Name (Optional)</label>
            <input
              type="text"
              value={executionName}
              onChange={(e) => setExecutionName(e.target.value)}
              placeholder="e.g., Production Cluster Load Test"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>CPU Threshold (%)</label>
              <input
                type="number"
                value={cpuThreshold}
                onChange={(e) => setCpuThreshold(Number(e.target.value))}
                min="10"
                max="100"
              />
            </div>
            <div className="form-group">
              <label>Memory Threshold (%)</label>
              <input
                type="number"
                value={memoryThreshold}
                onChange={(e) => setMemoryThreshold(Number(e.target.value))}
                min="10"
                max="100"
              />
            </div>
          </div>

          <div className="form-checkbox">
            <input
              type="checkbox"
              id="ai-enabled"
              checked={aiEnabled}
              onChange={(e) => setAiEnabled(e.target.checked)}
            />
            <label htmlFor="ai-enabled">
              Enable AI-Powered Adaptive Load
            </label>
          </div>
        </div>

        {/* Entity Selection */}
        <div className="config-section">
          <h2>Entity Operations</h2>
          <div className="entity-selection">
            <label className="entity-item">
              <input type="checkbox" defaultChecked />
              <span>VM - CREATE, DELETE</span>
            </label>
            <label className="entity-item">
              <input type="checkbox" defaultChecked />
              <span>Blueprint Multi-VM - CREATE, EXECUTE</span>
            </label>
            <label className="entity-item">
              <input type="checkbox" />
              <span>Blueprint Single-VM - CREATE</span>
            </label>
          </div>
        </div>

        {/* Summary & Actions */}
        <div className="config-section summary-section">
          <h2>Execution Summary</h2>
          <div className="summary-grid">
            <div className="summary-item">
              <div className="summary-label">Testbeds</div>
              <div className="summary-value">{selectedTestbeds.length}</div>
            </div>
            <div className="summary-item">
              <div className="summary-label">Target CPU</div>
              <div className="summary-value">{cpuThreshold}%</div>
            </div>
            <div className="summary-item">
              <div className="summary-label">Target Memory</div>
              <div className="summary-value">{memoryThreshold}%</div>
            </div>
            <div className="summary-item">
              <div className="summary-label">AI Mode</div>
              <div className="summary-value">{aiEnabled ? 'Enabled' : 'Disabled'}</div>
            </div>
          </div>

          <button
            className="btn-primary btn-large"
            onClick={handleStartExecution}
            disabled={loading || selectedTestbeds.length < 2}
          >
            {loading ? 'Starting...' : `Start Execution on ${selectedTestbeds.length} Testbeds`}
          </button>

          {selectedTestbeds.length < 2 && (
            <p className="warning-text">
              ⚠️ Please select at least 2 testbeds to start multi-testbed execution
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default MultiTestbedConfigure;
