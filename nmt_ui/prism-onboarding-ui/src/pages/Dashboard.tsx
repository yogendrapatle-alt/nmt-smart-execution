import React, { useState } from 'react';
import RuleBuilder from '../components/RuleBuilder';
import type { RuleConfig } from '../types/onboarding';

const Dashboard: React.FC = () => {
  const [rules, setRules] = useState<RuleConfig[]>([]);

  const handleSaveRule = (rule: RuleConfig) => {
    setRules([...rules, rule]);
  };

  return (
    <div style={{ maxWidth: 800, margin: '2rem auto', padding: 24 }}>
      <h1>Dashboard</h1>
      <RuleBuilder onSave={handleSaveRule} />
      <div style={{ marginTop: 32 }}>
        <h3>Saved Rules</h3>
        <ul>
          {rules.map((rule, idx) => (
            <li key={idx}>
              <strong>{rule.namespace}</strong> | Pods: {rule.pods.join(', ')} | Metrics: {rule.metrics.map(m => m.name).join(', ')}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default Dashboard;
