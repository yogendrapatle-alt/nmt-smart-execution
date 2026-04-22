import React, { useState } from 'react';
import { PRESET_TEMPLATES, type PresetConfig } from './types';

interface PresetTemplatesProps {
  activePreset: string | null;
  onApplyPreset: (preset: PresetConfig) => void;
}

const PresetTemplates: React.FC<PresetTemplatesProps> = ({ activePreset, onApplyPreset }) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="config-section">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <i className="material-icons-outlined" style={{ fontSize: 20 }}>auto_awesome</i>
        Quick Start Presets
      </h2>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 16, marginTop: -8 }}>
        Choose a preset to auto-fill configuration, then customize as needed.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {PRESET_TEMPLATES.map(preset => {
          const isActive = activePreset === preset.id;
          const isHovered = hoveredId === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => onApplyPreset(preset)}
              onMouseEnter={() => setHoveredId(preset.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8,
                padding: 16, borderRadius: 'var(--radius-md)',
                background: isActive ? 'var(--color-primary-light)' : 'var(--color-surface)',
                border: `2px solid ${isActive ? 'var(--color-primary)' : isHovered ? 'var(--color-border-hover)' : 'var(--color-border)'}`,
                cursor: 'pointer', textAlign: 'left',
                transform: isHovered ? 'translateY(-2px)' : 'none',
                boxShadow: isHovered ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                transition: 'all var(--transition-fast)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: preset.gradient,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>{preset.icon}</i>
                </div>
                <span style={{ fontWeight: 700, fontSize: 'var(--text-base)', color: 'var(--color-text)' }}>
                  {preset.label}
                </span>
                {isActive && (
                  <i className="material-icons-outlined" style={{ fontSize: 18, color: 'var(--color-primary)', marginLeft: 'auto' }}>check_circle</i>
                )}
              </div>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                {preset.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PresetTemplates;
