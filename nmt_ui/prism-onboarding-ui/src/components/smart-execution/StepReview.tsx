import React from 'react';
import type { Testbed, AISettings } from './types';

interface StepReviewProps {
  testbeds: Testbed[];
  selectedTestbed: string;
  executionName: string;
  cpuThreshold: number;
  memoryThreshold: number;
  stopCondition: string;
  aiSettings: AISettings;
  workloadProfile: string;
  maxParallelOps: number;
  selectedEntities: Record<string, string[]>;
  longevityEnabled: boolean;
  longevityDuration: number;
  tags: string[];
  loading: boolean;
  onStartExecution: () => void;
  onRunPreCheck: () => void;
  runningPreCheck: boolean;
  preCheckResult: any;
  onViewHistory: () => void;
}

const StepReview: React.FC<StepReviewProps> = (props) => {
  const testbedLabel = props.testbeds.find(t => t.unique_testbed_id === props.selectedTestbed)?.testbed_label || '–';
  const totalEntities = Object.keys(props.selectedEntities).length;
  const totalOps = Object.values(props.selectedEntities).flat().length;
  const canStart = !!props.selectedTestbed && totalEntities > 0;

  return (
    <>
      <section className="config-section" style={{ background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 24 }}>
        <h2><i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle' }}>checklist</i> Review Configuration</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, fontSize: 'var(--text-sm)' }}>
          <ReviewItem label="Testbed" value={testbedLabel} />
          <ReviewItem label="Name" value={props.executionName || 'Auto-generated'} muted={!props.executionName} />
          <ReviewItem label="CPU Target" value={`${props.cpuThreshold}%`} />
          <ReviewItem label="Memory Target" value={`${props.memoryThreshold}%`} />
          <ReviewItem label="Stop Condition" value={props.stopCondition} />
          <ReviewItem label="AI Enabled" value={props.aiSettings.enable_ai ? 'Yes' : 'No'} />
          <ReviewItem label="ML Enabled" value={props.aiSettings.enable_ml ? 'Yes' : 'No'} />
          <ReviewItem label="Profile" value={props.workloadProfile} />
          <ReviewItem label="Max Parallel Ops" value={String(props.maxParallelOps)} />
          <ReviewItem label="Entities" value={`${totalEntities} types, ${totalOps} operations`} />
          {props.longevityEnabled && <ReviewItem label="Longevity" value={`${props.longevityDuration}h`} />}
          {props.tags.length > 0 && <ReviewItem label="Tags" value={props.tags.join(', ')} />}
        </div>

        {totalEntities > 0 && (
          <div style={{ marginTop: 16 }}>
            <strong style={{ fontSize: 'var(--text-sm)' }}>Selected Operations:</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {Object.entries(props.selectedEntities).map(([entity, ops]) => (
                <span key={entity} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px',
                  background: 'var(--color-primary-light)', borderRadius: 'var(--radius-full)',
                  fontSize: 'var(--text-xs)', color: 'var(--color-primary)', fontWeight: 600,
                }}>
                  {entity} <span style={{ fontWeight: 400, opacity: 0.8 }}>({ops.length})</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="action-buttons">
        <button onClick={props.onRunPreCheck} disabled={props.runningPreCheck || !props.selectedTestbed} className="btn-secondary">
          {props.runningPreCheck ? 'Checking…' : 'Pre-flight Check'}
        </button>
        <button onClick={props.onStartExecution} disabled={props.loading || !canStart} className="btn-primary">
          {props.loading ? 'Starting…' : props.aiSettings.enable_ai ? 'Start AI Execution' : 'Start Execution'}
        </button>
        <button onClick={props.onViewHistory} className="btn-secondary">View History</button>
      </section>

      {props.preCheckResult && (
        <section className="config-section" style={{ marginTop: 16, border: `2px solid ${props.preCheckResult.passed ? 'var(--color-success)' : 'var(--color-danger)'}` }}>
          <h2>
            {props.preCheckResult.passed ? (
              <><i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', color: 'var(--color-success)' }}>check_circle</i> Pre-check Passed</>
            ) : (
              <><i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', color: 'var(--color-danger)' }}>error</i> Pre-check Issues Found</>
            )}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <PreCheckCard label="Prometheus" passed={props.preCheckResult.prometheus}
              detail={props.preCheckResult.baseline_cpu !== undefined ? `CPU: ${props.preCheckResult.baseline_cpu?.toFixed(1)}% | Mem: ${props.preCheckResult.baseline_memory?.toFixed(1)}%` : undefined} />
            <PreCheckCard label="NCM API" passed={props.preCheckResult.ncm_api} warn />
            <PreCheckCard label="Resources" passed={props.preCheckResult.resources} warn
              detail={[props.preCheckResult.image && `Image: ${props.preCheckResult.image}`, props.preCheckResult.cluster && `Cluster: ${props.preCheckResult.cluster}`].filter(Boolean).join(' | ') || undefined} />
          </div>
          {props.preCheckResult.warnings?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {props.preCheckResult.warnings.map((w: string, i: number) => (
                <div key={i} style={{ padding: '6px 10px', background: 'var(--color-warning-light)', border: '1px solid var(--color-warning)', borderRadius: 'var(--radius-sm)', marginBottom: 4, fontSize: 'var(--text-xs)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="material-icons-outlined" style={{ fontSize: 16 }}>warning</i> {w}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
};

const ReviewItem: React.FC<{ label: string; value: string; muted?: boolean }> = ({ label, value, muted }) => (
  <div>
    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 2 }}>{label}</div>
    <div style={{ fontWeight: 500, color: muted ? 'var(--color-text-muted)' : 'var(--color-text)' }}>{value}</div>
  </div>
);

const PreCheckCard: React.FC<{ label: string; passed: boolean; warn?: boolean; detail?: string }> = ({ label, passed, warn, detail }) => (
  <div style={{ padding: 10, borderRadius: 'var(--radius-sm)', background: passed ? 'var(--color-success-light)' : 'var(--color-danger-light)' }}>
    <strong style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <i className="material-icons-outlined" style={{ fontSize: 16, color: passed ? 'var(--color-success)' : warn ? 'var(--color-warning)' : 'var(--color-danger)' }}>
        {passed ? 'check_circle' : warn ? 'warning' : 'cancel'}
      </i>
      {label}
    </strong>
    {detail && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 4 }}>{detail}</div>}
  </div>
);

export default StepReview;
