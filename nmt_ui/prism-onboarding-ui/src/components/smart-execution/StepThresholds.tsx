import React from 'react';
import type { AISettings } from './types';

interface StepThresholdsProps {
  cpuThreshold: number;
  onCpuChange: (v: number) => void;
  memoryThreshold: number;
  onMemoryChange: (v: number) => void;
  stopCondition: string;
  onStopConditionChange: (v: string) => void;
  aiSettings: AISettings;
  onAISettingsChange: (s: AISettings) => void;
  selectedTestbed: string;
  mlRecommendations: any[];
  loadingRecommendations: boolean;
  onFetchRecommendations: () => void;
  onApplyRecommendations: () => void;
}

const StepThresholds: React.FC<StepThresholdsProps> = ({
  cpuThreshold, onCpuChange, memoryThreshold, onMemoryChange,
  stopCondition, onStopConditionChange, aiSettings, onAISettingsChange,
  selectedTestbed, mlRecommendations, loadingRecommendations,
  onFetchRecommendations, onApplyRecommendations,
}) => (
  <>
    <section className="config-section">
      <h2><i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle' }}>tune</i> Target Thresholds</h2>
      <div className="threshold-grid">
        <div className="threshold-input">
          <label>
            CPU Threshold (%)
            <input type="number" min={10} max={100} value={cpuThreshold} onChange={e => onCpuChange(Number(e.target.value))} />
          </label>
          <div className="threshold-bar">
            <div className="threshold-fill" style={{ width: `${cpuThreshold}%` }} />
          </div>
          <small style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginTop: 4, display: 'block' }}>
            {cpuThreshold >= 85 ? 'High — may trigger throttling' : cpuThreshold >= 60 ? 'Moderate load target' : 'Light load'}
          </small>
        </div>

        <div className="threshold-input">
          <label>
            Memory Threshold (%)
            <input type="number" min={10} max={100} value={memoryThreshold} onChange={e => onMemoryChange(Number(e.target.value))} />
          </label>
          <div className="threshold-bar">
            <div className="threshold-fill memory" style={{ width: `${memoryThreshold}%` }} />
          </div>
          <small style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginTop: 4, display: 'block' }}>
            {memoryThreshold >= 85 ? 'High — risk of OOM' : memoryThreshold >= 60 ? 'Moderate memory pressure' : 'Light memory usage'}
          </small>
        </div>

        <div className="threshold-input">
          <label>
            Stop Condition
            <select value={stopCondition} onChange={e => onStopConditionChange(e.target.value)}>
              <option value="any">Any threshold reached</option>
              <option value="all">All thresholds reached</option>
              <option value="cpu">CPU threshold only</option>
              <option value="memory">Memory threshold only</option>
            </select>
          </label>
        </div>
      </div>
    </section>

    <section className="config-section ai-settings">
      <h2><i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle' }}>psychology</i> AI/ML Settings</h2>
      <div className="ai-toggles">
        <label className="toggle-switch">
          <input type="checkbox" checked={aiSettings.enable_ai}
            onChange={e => onAISettingsChange({ ...aiSettings, enable_ai: e.target.checked })} />
          <span className="toggle-slider" />
          <span className="toggle-label">Enable AI Control (PID-based adaptive load)</span>
        </label>
        <label className="toggle-switch">
          <input type="checkbox" checked={aiSettings.enable_ml}
            onChange={e => onAISettingsChange({ ...aiSettings, enable_ml: e.target.checked })}
            disabled={!aiSettings.enable_ai} />
          <span className="toggle-slider" />
          <span className="toggle-label">Enable ML Predictions (operation recommendations)</span>
        </label>
        <label className="toggle-switch">
          <input type="checkbox" checked={aiSettings.data_collection}
            onChange={e => onAISettingsChange({ ...aiSettings, data_collection: e.target.checked })} />
          <span className="toggle-slider" />
          <span className="toggle-label">Collect training data for ML model improvement</span>
        </label>
      </div>

      {aiSettings.enable_ai && (
        <div className="ml-recommendations-section">
          <button onClick={onFetchRecommendations} disabled={loadingRecommendations || !selectedTestbed} className="btn-secondary">
            {loadingRecommendations ? 'Loading...' : 'Get ML Recommendations'}
          </button>

          {mlRecommendations.length > 0 && (
            <div className="recommendations-box">
              <h3>Top ML Recommendations:</h3>
              <div className="recommendations-list">
                {mlRecommendations.slice(0, 5).map((rec, idx) => (
                  <div key={idx} className="recommendation-item">
                    <span className="rec-rank">#{idx + 1}</span>
                    <span className="rec-entity">{rec.entity}</span>
                    <span className="rec-operation">{rec.operation}</span>
                    <span className="rec-impact">CPU: +{rec.cpu_impact.toFixed(1)}%, Mem: +{rec.memory_impact.toFixed(1)}%</span>
                    <span className="rec-score">Score: {rec.score.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <button onClick={onApplyRecommendations} className="btn-secondary">Apply Recommendations</button>
            </div>
          )}
        </div>
      )}
    </section>
  </>
);

export default StepThresholds;
