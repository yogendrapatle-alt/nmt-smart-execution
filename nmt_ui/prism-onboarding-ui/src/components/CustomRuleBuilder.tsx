import React from 'react';

interface CustomRuleBuilderProps {
  ruleBook: any[];
  setRuleBook: React.Dispatch<React.SetStateAction<any[]>>;
  nodeRuleBook: any[];
  setNodeRuleBook: React.Dispatch<React.SetStateAction<any[]>>;
  handleDeleteRule: (ruleIdx: number) => void;
  handleDeleteNodeRule: (ruleIdx: number) => void;
}

const CustomRuleBuilder: React.FC<CustomRuleBuilderProps> = ({
  ruleBook,
  setRuleBook,
  nodeRuleBook,
  setNodeRuleBook,
  handleDeleteRule,
  handleDeleteNodeRule,
}) => {
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

  const handleAddCustomPodRule = () => {
    setRuleBook(prev => [
      ...prev,
      {
        conditions: [],
        severity: 'Moderate',
        useCustomQuery: true,
        customQueryText: '',
        collectLogs: true,
        logDurationHours: 1
      }
    ]);
  };

  const handleAddCustomNodeRule = () => {
    setNodeRuleBook(prev => [
      ...prev,
      {
        conditions: [],
        severity: 'Moderate',
        useCustomQuery: true,
        customQueryText: '',
        collectLogs: true,
        logDurationHours: 1
      }
    ]);
  };

  const handlePodRuleChange = (ruleIdx: number, field: string, value: any) => {
    setRuleBook(prev => prev.map((rule, idx) => 
      idx === ruleIdx ? { ...rule, [field]: value } : rule
    ));
  };

  const handleNodeRuleChange = (ruleIdx: number, field: string, value: any) => {
    setNodeRuleBook(prev => prev.map((rule, idx) => 
      idx === ruleIdx ? { ...rule, [field]: value } : rule
    ));
  };

  return (
    <div style={{ marginTop: 24 }}>
      {/* Pod Rules Section */}
      <div style={{ marginTop: 32, padding: 16, border: '1px solid #eee', borderRadius: 8, background: '#f8fafd' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: '#0078d4', fontWeight: 600 }}>Pod Rules (Custom Queries Only)</h3>
          <button
            onClick={handleAddCustomPodRule}
            style={{
              background: '#0078d4',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '8px 16px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            + Add Custom Pod Rule
          </button>
        </div>

        {ruleBook.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#666', padding: 20, fontStyle: 'italic' }}>
            No pod rules defined. Click "Add Custom Pod Rule" to create one.
          </div>
        ) : (
          ruleBook.map((rule, ruleIdx) => (
            <div
              key={ruleIdx}
              style={{
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: 16,
                marginBottom: 16,
                background: '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, color: '#333', fontSize: 16 }}>Pod Rule {ruleIdx + 1}</h4>
                <button
                  onClick={() => handleDeleteRule(ruleIdx)}
                  style={{
                    background: '#dc3545',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    padding: '6px 12px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
              </div>

              {/* Severity */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: 4 }}>Severity</label>
                <select
                  value={rule.severity || 'Moderate'}
                  onChange={(e) => handlePodRuleChange(ruleIdx, 'severity', e.target.value)}
                  style={{ ...inputStyle, width: 'auto', minWidth: 120 }}
                >
                  <option value="Low">Low</option>
                  <option value="Moderate">Moderate</option>
                  <option value="Critical">Critical</option>
                </select>
              </div>

              {/* Description */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: 4 }}>Description</label>
                <input
                  type="text"
                  value={rule.description || ''}
                  onChange={(e) => handlePodRuleChange(ruleIdx, 'description', e.target.value)}
                  placeholder="Enter rule description..."
                  style={inputStyle}
                />
              </div>

              {/* Custom Query */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: 4 }}>Custom Query</label>
                <textarea
                  value={rule.customQueryText || ''}
                  onChange={(e) => handlePodRuleChange(ruleIdx, 'customQueryText', e.target.value)}
                  placeholder="Enter your custom Prometheus query..."
                  rows={4}
                  style={{
                    ...inputStyle,
                    fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                    fontSize: 12,
                    resize: 'vertical',
                  }}
                />
              </div>

              {/* Log Collection Options */}
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={rule.collectLogs !== false}
                    onChange={(e) => handlePodRuleChange(ruleIdx, 'collectLogs', e.target.checked)}
                  />
                  Collect Logs
                </label>
                {rule.collectLogs !== false && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontWeight: 500 }}>Duration (hours):</label>
                    <input
                      type="number"
                      min="1"
                      value={rule.logDurationHours || 1}
                      onChange={(e) => handlePodRuleChange(ruleIdx, 'logDurationHours', parseInt(e.target.value) || 1)}
                      style={{ ...inputStyle, width: 80 }}
                    />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Node Rules Section */}
      <div style={{ marginTop: 32, padding: 16, border: '1px solid #eee', borderRadius: 8, background: '#f8fafd' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: '#0078d4', fontWeight: 600 }}>Node Rules (Custom Queries Only)</h3>
          <button
            onClick={handleAddCustomNodeRule}
            style={{
              background: '#0078d4',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '8px 16px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            + Add Custom Node Rule
          </button>
        </div>

        {nodeRuleBook.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#666', padding: 20, fontStyle: 'italic' }}>
            No node rules defined. Click "Add Custom Node Rule" to create one.
          </div>
        ) : (
          nodeRuleBook.map((rule, ruleIdx) => (
            <div
              key={ruleIdx}
              style={{
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: 16,
                marginBottom: 16,
                background: '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, color: '#333', fontSize: 16 }}>Node Rule {ruleIdx + 1}</h4>
                <button
                  onClick={() => handleDeleteNodeRule(ruleIdx)}
                  style={{
                    background: '#dc3545',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    padding: '6px 12px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
              </div>

              {/* Severity */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: 4 }}>Severity</label>
                <select
                  value={rule.severity || 'Moderate'}
                  onChange={(e) => handleNodeRuleChange(ruleIdx, 'severity', e.target.value)}
                  style={{ ...inputStyle, width: 'auto', minWidth: 120 }}
                >
                  <option value="Low">Low</option>
                  <option value="Moderate">Moderate</option>
                  <option value="Critical">Critical</option>
                </select>
              </div>

              {/* Description */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: 4 }}>Description</label>
                <input
                  type="text"
                  value={rule.description || ''}
                  onChange={(e) => handleNodeRuleChange(ruleIdx, 'description', e.target.value)}
                  placeholder="Enter rule description..."
                  style={inputStyle}
                />
              </div>

              {/* Custom Query */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: 4 }}>Custom Query</label>
                <textarea
                  value={rule.customQueryText || ''}
                  onChange={(e) => handleNodeRuleChange(ruleIdx, 'customQueryText', e.target.value)}
                  placeholder="Enter your custom Prometheus query..."
                  rows={4}
                  style={{
                    ...inputStyle,
                    fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                    fontSize: 12,
                    resize: 'vertical',
                  }}
                />
              </div>

              {/* Log Collection Options */}
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={rule.collectLogs !== false}
                    onChange={(e) => handleNodeRuleChange(ruleIdx, 'collectLogs', e.target.checked)}
                  />
                  Collect Logs
                </label>
                {rule.collectLogs !== false && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontWeight: 500 }}>Duration (hours):</label>
                    <input
                      type="number"
                      min="1"
                      value={rule.logDurationHours || 1}
                      onChange={(e) => handleNodeRuleChange(ruleIdx, 'logDurationHours', parseInt(e.target.value) || 1)}
                      style={{ ...inputStyle, width: 80 }}
                    />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CustomRuleBuilder;
