import React from 'react';
import type { Testbed, PresetConfig } from './types';
import PresetTemplates from './PresetTemplates';

interface StepIdentityProps {
  testbeds: Testbed[];
  selectedTestbed: string;
  onSelectTestbed: (id: string) => void;
  executionName: string;
  onNameChange: (name: string) => void;
  executionDescription: string;
  onDescriptionChange: (desc: string) => void;
  activePreset: string | null;
  onApplyPreset: (preset: PresetConfig) => void;
}

const StepIdentity: React.FC<StepIdentityProps> = ({
  testbeds, selectedTestbed, onSelectTestbed,
  executionName, onNameChange, executionDescription, onDescriptionChange,
  activePreset, onApplyPreset,
}) => {
  const selectedLabel = testbeds.find(t => t.unique_testbed_id === selectedTestbed)?.testbed_label;
  const placeholder = selectedLabel
    ? `${selectedLabel} - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : 'e.g. PE-173 Soak Run';

  return (
    <>
      <section className="config-section">
        <h2><i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle' }}>dns</i> Select Testbed</h2>
        <select value={selectedTestbed} onChange={e => onSelectTestbed(e.target.value)} className="testbed-select">
          <option value="">-- Select Testbed --</option>
          {testbeds.map(tb => (
            <option key={tb.unique_testbed_id} value={tb.unique_testbed_id}>
              {tb.testbed_label} ({tb.pc_ip})
            </option>
          ))}
        </select>
        {selectedTestbed && (
          <div style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {(() => {
              const tb = testbeds.find(t => t.unique_testbed_id === selectedTestbed);
              if (!tb) return null;
              return (
                <>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                    <strong>PC:</strong> <code>{tb.pc_ip}</code>
                  </span>
                  {tb.ncm_ip && (
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                      <strong>NCM:</strong> <code>{tb.ncm_ip}</code>
                    </span>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </section>

      <section className="config-section">
        <h2><i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle' }}>badge</i> Execution Identity</h2>
        <div className="threshold-grid">
          <div className="threshold-input" style={{ flex: 2 }}>
            <label>
              Execution Name (optional)
              <input
                type="text"
                value={executionName}
                onChange={e => onNameChange(e.target.value.slice(0, 60))}
                placeholder={placeholder}
                maxLength={60}
              />
            </label>
            <small style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>{executionName.length}/60 characters</small>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: 14, color: '#475569', marginBottom: 8 }}>
            Description / Notes (optional)
          </label>
          <textarea
            value={executionDescription}
            onChange={e => onDescriptionChange(e.target.value.slice(0, 500))}
            placeholder="Purpose of this run, e.g. Pre-upgrade soak test for AOS 6.8"
            maxLength={500}
            rows={2}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)',
              border: '2px solid var(--color-border)', fontSize: 'var(--text-base)', resize: 'vertical',
              fontFamily: 'var(--font-sans)',
            }}
          />
          <small style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>{executionDescription.length}/500 characters</small>
        </div>
      </section>

      <PresetTemplates activePreset={activePreset} onApplyPreset={onApplyPreset} />
    </>
  );
};

export default StepIdentity;
