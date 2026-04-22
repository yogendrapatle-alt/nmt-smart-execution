import React from 'react';
import { getPhaseIcon, getPhaseColor, type SustainInfo } from './types';

interface Props {
  phase: string;
  status: string;
  iteration: number;
  totalOperations: number;
  sustain?: SustainInfo;
}

const PhaseBanner: React.FC<Props> = ({ phase, status, iteration, totalOperations, sustain }) => {
  const phaseNorm = (phase || status || '').toLowerCase();
  const color = getPhaseColor(phaseNorm);
  const isSustaining = sustain && (sustain.is_sustaining || phaseNorm === 'sustaining' || phaseNorm === 'longevity_sustaining');

  let sustainPct = 0;
  let sustainLabel = '';
  if (isSustaining) {
    const elapsed = sustain.sustain_elapsed_seconds || 0;
    const total = (sustain.sustain_minutes || 5) * 60;
    sustainPct = Math.min(100, Math.round((elapsed / total) * 100));
    sustainLabel = `${Math.floor(elapsed / 60)}m ${Math.floor(elapsed % 60)}s / ${sustain.sustain_minutes}m`;
  }

  return (
    <div className="monitor-phase-banner">
      <div className="phase-inner" style={{ background: `linear-gradient(135deg, ${color}ee, ${color}88)` }}>
        <div className="phase-label">
          <i className="material-icons-outlined" style={{ fontSize: 32 }}>{getPhaseIcon(phaseNorm)}</i>
          <div>
            <h5>{(phase || status || '').toUpperCase().replace(/_/g, ' ')}</h5>
            <span className="phase-sub">Iteration {iteration} &middot; {totalOperations} operations executed</span>
          </div>
        </div>

        {isSustaining && (
          <div style={{ textAlign: 'end' }}>
            <div className="phase-sub">{sustainLabel}</div>
            <div className="sustain-track">
              <div className="sustain-fill" style={{ width: `${sustainPct}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PhaseBanner;
