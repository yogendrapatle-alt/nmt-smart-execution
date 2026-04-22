import React from 'react';

interface Step {
  label: string;
  icon: string;
}

interface WizardStepperProps {
  steps: Step[];
  currentStep: number;
  onStepClick: (index: number) => void;
}

const WizardStepper: React.FC<WizardStepperProps> = ({ steps, currentStep, onStepClick }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: 'var(--space-6)', padding: 'var(--space-4) 0', overflowX: 'auto' }}>
    {steps.map((step, idx) => {
      const isActive = idx === currentStep;
      const isCompleted = idx < currentStep;
      return (
        <React.Fragment key={idx}>
          {idx > 0 && (
            <div style={{
              width: 48, height: 2, flexShrink: 0,
              background: isCompleted || isActive ? 'var(--color-primary)' : 'var(--color-border)',
              transition: 'background var(--transition-normal)',
            }} />
          )}
          <button
            onClick={() => onStepClick(idx)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', cursor: 'pointer', padding: '4px 14px', minWidth: 80,
            }}
          >
            <div style={{
              width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isActive ? 'var(--color-primary)' : isCompleted ? 'var(--color-success)' : 'var(--color-surface-muted)',
              color: isActive || isCompleted ? 'white' : 'var(--color-text-muted)',
              boxShadow: isActive ? '0 0 0 4px var(--color-primary-light)' : 'none',
              transition: 'all var(--transition-normal)',
            }}>
              <i className="material-icons-outlined" style={{ fontSize: 20 }}>
                {isCompleted ? 'check' : step.icon}
              </i>
            </div>
            <span style={{
              fontSize: 'var(--text-xs)', fontWeight: isActive ? 700 : 500,
              color: isActive ? 'var(--color-primary)' : isCompleted ? 'var(--color-success)' : 'var(--color-text-muted)',
              transition: 'color var(--transition-fast)',
            }}>
              {step.label}
            </span>
          </button>
        </React.Fragment>
      );
    })}
  </div>
);

export default WizardStepper;
