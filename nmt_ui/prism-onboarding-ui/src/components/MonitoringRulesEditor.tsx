import React, { useEffect, useMemo, useState } from 'react';
import type {
  MonitoringRule,
  RuleCondition,
  RuleScope,
  ComparisonOperator,
  LogicalOperator,
  MetricUnit,
} from './smart-execution/types';
import { QUICK_RULE_TEMPLATES, getDefaultUnit, getAllowedUnits, validateThreshold } from './smart-execution/types';
import { getApiBase } from '../utils/backendUrl';
import PodMultiSelect from './PodMultiSelect';

const SEVERITY_COLORS: Record<string, string> = {
  Critical: '#ef4444',
  Moderate: '#f59e0b',
  Low: '#22c55e',
};

const SCOPE_LABELS: Record<RuleScope, string> = {
  pod: 'Pod',
  node: 'Node',
  cluster: 'Cluster',
};

const SCOPE_COLORS: Record<RuleScope, string> = {
  pod: '#3b82f6',
  node: '#8b5cf6',
  cluster: '#0ea5e9',
};

interface MonitoringRulesEditorProps {
  rules: MonitoringRule[];
  onChange: (rules: MonitoringRule[]) => void;
  availableNamespaces: string[];
  availablePods: string[];
  /** Optional namespace → pods map for grouped multi-select. */
  podsByNamespace?: Record<string, string[]>;
  availableNodes?: string[];
  /** Lazy-fetch nodes from /available-nodes if testbed is known. */
  testbedId?: string;
  embedded?: boolean;
}

const newRuleId = () => `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const blankCondition = (scope: RuleScope = 'pod'): RuleCondition => ({
  scope, query: '', queryMode: 'quick', operator: '>', threshold: 80, unit: 'Percentage',
});

const ruleHasComposite = (rule: MonitoringRule): boolean =>
  Array.isArray(rule.conditions) && rule.conditions.length > 0;

/** Coerce arbitrary single-pod / multi-pod fields into the modern array form. */
const coercePods = (rule: Partial<MonitoringRule | RuleCondition>): string[] => {
  if (Array.isArray((rule as MonitoringRule).podNames) && (rule as MonitoringRule).podNames!.length > 0) {
    return (rule as MonitoringRule).podNames!;
  }
  if (rule.podName) return [rule.podName];
  return [];
};
const coerceNs = (rule: Partial<MonitoringRule | RuleCondition>): string[] => {
  if (Array.isArray((rule as MonitoringRule).namespaces) && (rule as MonitoringRule).namespaces!.length > 0) {
    return (rule as MonitoringRule).namespaces!;
  }
  if (rule.namespace) return [rule.namespace];
  return [];
};

/** Render a small chip describing the rule (for the summary table). */
const RuleSummary: React.FC<{ rule: MonitoringRule }> = ({ rule }) => {
  if (ruleHasComposite(rule)) {
    const op = rule.logicalOperator || 'AND';
    return (
      <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', whiteSpace: 'normal', wordBreak: 'break-word' }}>
        {rule.conditions!.map((c, i) => {
          const pods = coercePods(c);
          const ns = coerceNs(c);
          const target = pods.length > 0 ? pods.join(',')
            : c.nodeInstance || (c.nodeInstances || []).join(',')
            || ns.join(',') || '*';
          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <span style={{ margin: '0 4px', padding: '0 4px', background: '#e0e7ff', color: '#4338ca', borderRadius: 3, fontWeight: 700 }}>
                  {op}
                </span>
              )}
              <span>
                {(c.scope || 'pod').toUpperCase()}:{target} {c.query} {c.operator} {c.threshold}{c.unit === 'Percentage' ? '%' : ''}
              </span>
            </React.Fragment>
          );
        })}
      </span>
    );
  }
  const pods = coercePods(rule);
  const ns = coerceNs(rule);
  const target = pods.length > 0 ? pods.join(',')
    : (rule.nodeInstances && rule.nodeInstances.length > 0) ? rule.nodeInstances.join(',')
    : rule.nodeInstance || ns.join(',') || '*';
  const targetLabel = (rule.scope === 'cluster') ? '' : ` @ ${target}`;
  return (
    <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--color-primary, #1e40af)' }}>
      {rule.query} {rule.operator} {rule.threshold}{rule.unit === 'Percentage' ? '%' : ''}
      <span style={{ color: '#6b7280' }}>{targetLabel}</span>
    </span>
  );
};

const inputCss: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  border: '1px solid var(--color-border, #d1d5db)',
  borderRadius: 6, fontSize: 12,
};
const labelCss: React.CSSProperties = { fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 };

const MonitoringRulesEditor: React.FC<MonitoringRulesEditorProps> = ({
  rules, onChange, availableNamespaces, availablePods, podsByNamespace,
  availableNodes: availableNodesProp, testbedId, embedded,
}) => {
  const [draftRule, setDraftRule] = useState<MonitoringRule | null>(null);
  /** When set, we're editing an existing rule (id). null = closed; '' = new. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [availableNodes, setAvailableNodes] = useState<string[]>(availableNodesProp || []);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [manualNode, setManualNode] = useState('');
  /** True when the user clicks "Test now" on the draft. Holds last result text. */
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => { if (availableNodesProp) setAvailableNodes(availableNodesProp); }, [availableNodesProp]);

  const fetchNodes = React.useCallback(async () => {
    if (!testbedId || availableNodesProp) return;
    setLoadingNodes(true);
    try {
      const res = await fetch(`${getApiBase()}/api/smart-execution/available-nodes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testbed_id: testbedId }),
      });
      const data = await res.json();
      if (data?.success && Array.isArray(data.nodes)) setAvailableNodes(data.nodes);
    } catch (err) {
      console.warn('Failed to fetch available nodes:', err);
    } finally {
      setLoadingNodes(false);
    }
  }, [testbedId, availableNodesProp]);

  useEffect(() => {
    if (testbedId && !availableNodesProp && availableNodes.length === 0) fetchNodes();
  }, [testbedId, availableNodesProp, availableNodes.length, fetchNodes]);

  // ── Quick-add: open editor pre-filled (so user can scope it before saving). ─
  const startQuick = (template: typeof QUICK_RULE_TEMPLATES[0]) => {
    const unit = getDefaultUnit(template.query);
    setDraftRule({
      ...template, id: newRuleId(), enabled: true, queryMode: 'quick',
      unit, schemaVersion: 2,
    });
    setEditingId(''); setTestResult(null);
  };

  const startCustom = () => {
    setDraftRule({
      id: newRuleId(), name: '', query: '', queryMode: 'quick',
      operator: '>', threshold: 80, severity: 'Moderate',
      scope: 'pod', enabled: true, conditions: [], logicalOperator: 'AND',
      unit: 'Percentage', schemaVersion: 2,
    });
    setEditingId(''); setTestResult(null);
  };

  const startEdit = (rule: MonitoringRule) => {
    // Clone the rule into the draft so we can cancel without mutating state.
    setDraftRule(JSON.parse(JSON.stringify(rule)));
    setEditingId(rule.id); setTestResult(null);
  };

  const cancelDraft = () => { setDraftRule(null); setEditingId(null); setTestResult(null); };

  const validateDraft = (d: MonitoringRule): string | null => {
    if (!d.name.trim()) return 'Rule name is required';
    if (ruleHasComposite(d)) {
      if ((d.conditions || []).length === 0) return 'Add at least one condition';
      for (const c of d.conditions || []) {
        if (!c.query.trim()) return 'Each condition needs a query';
        const v = validateThreshold(Number(c.threshold), c.unit);
        if (v) return v;
      }
    } else {
      if (!d.query.trim()) return 'Query is required';
      const v = validateThreshold(Number(d.threshold), d.unit);
      if (v) return v;
    }
    // Smart dedup: only block exact-name dupes (not query+scope, since two rules
    // with the same query but different pods/thresholds are legitimate).
    const conflict = rules.find(r => r.id !== d.id && r.name.trim().toLowerCase() === d.name.trim().toLowerCase());
    if (conflict) return `A rule named "${d.name}" already exists`;
    return null;
  };

  const draftError = useMemo(() => (draftRule ? validateDraft(draftRule) : null), [draftRule, rules]);

  const saveDraft = () => {
    if (!draftRule || draftError) return;
    const stamped: MonitoringRule = { ...draftRule, schemaVersion: 2 };
    if (editingId && editingId !== '') {
      onChange(rules.map(r => (r.id === editingId ? stamped : r)));
    } else {
      onChange([...rules, stamped]);
    }
    cancelDraft();
  };

  const removeRule = (id: string) => {
    onChange(rules.filter(r => r.id !== id));
    if (editingId === id) cancelDraft();
  };
  const toggleRule = (id: string) => onChange(rules.map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  const updateRuleField = (id: string, field: keyof MonitoringRule, value: unknown) =>
    onChange(rules.map(r => (r.id === id ? { ...r, [field]: value } : r)));

  // ── Draft helpers ──────────────────────────────────────────────
  const updateDraft = (patch: Partial<MonitoringRule>) =>
    setDraftRule(d => (d ? { ...d, ...patch } : d));
  const addCondition = () =>
    setDraftRule(d => d ? { ...d, conditions: [...(d.conditions || []), blankCondition(d.scope || 'pod')] } : d);
  const updateCondition = (idx: number, patch: Partial<RuleCondition>) =>
    setDraftRule(d => {
      if (!d || !d.conditions) return d;
      return { ...d, conditions: d.conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)) };
    });
  const removeCondition = (idx: number) =>
    setDraftRule(d => d && d.conditions ? { ...d, conditions: d.conditions.filter((_, i) => i !== idx) } : d);

  // ── Optional Test-now button ─────────────────────────────────
  const runTestQuery = async () => {
    if (!draftRule || !testbedId) return;
    setTestResult('Running…');
    try {
      const composite = ruleHasComposite(draftRule);
      const probeQuery = composite ? draftRule.conditions![0].query : draftRule.query;
      const probeMode = composite ? draftRule.conditions![0].queryMode : draftRule.queryMode;
      const res = await fetch(`${getApiBase()}/api/smart-execution/test-rule-query`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testbed_id: testbedId, query: probeQuery, query_mode: probeMode,
          scope: draftRule.scope, namespace: draftRule.namespace,
          pod_names: coercePods(draftRule), node_instance: draftRule.nodeInstance,
        }),
      });
      const data = await res.json();
      if (data?.success) {
        setTestResult(`✓ Returned ${data.series_count ?? 0} series; max value=${data.max_value ?? 'n/a'}`);
      } else {
        setTestResult(`✗ ${data?.error || 'No data returned'}`);
      }
    } catch (err) {
      setTestResult(`✗ ${(err as Error).message}`);
    }
  };

  // ── Render: scope-specific selectors ─────────────────────────
  const renderTargetSelectors = (
    src: { scope?: RuleScope; namespace?: string; podName?: string; nodeInstance?: string;
           namespaces?: string[]; podNames?: string[]; nodeInstances?: string[] },
    onChangeFn: (patch: Partial<typeof src>) => void,
  ) => {
    const scope = src.scope || 'pod';
    const podArr = coercePods(src);
    const nsArr = coerceNs(src);
    const nodeArr: string[] = src.nodeInstances && src.nodeInstances.length > 0
      ? src.nodeInstances : src.nodeInstance ? [src.nodeInstance] : [];

    if (scope === 'pod') {
      return (
        <>
          <div>
            <label style={labelCss}>Namespace(s)</label>
            <select multiple value={nsArr}
              onChange={e => {
                const sel = Array.from(e.target.selectedOptions).map(o => o.value);
                onChangeFn({ namespaces: sel, namespace: undefined });
              }}
              style={{ ...inputCss, minHeight: 70, padding: '4px 6px' }}>
              {availableNamespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
            </select>
            <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>Hold ⌘/Ctrl to select multiple. Empty = all.</div>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={labelCss}>Pod(s)</label>
            <PodMultiSelect
              value={podArr}
              onChange={(next) => onChangeFn({ podNames: next, podName: undefined })}
              allPods={availablePods}
              podsByNamespace={podsByNamespace}
              namespacesFilter={nsArr}
              placeholder="All pods (no filter)" />
          </div>
        </>
      );
    }
    if (scope === 'node') {
      return (
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelCss}>Node instance(s) {loadingNodes && <span style={{ color: '#6b7280' }}>(loading…)</span>}</label>
          <select multiple value={nodeArr}
            onChange={e => {
              const sel = Array.from(e.target.selectedOptions).map(o => o.value);
              onChangeFn({ nodeInstances: sel, nodeInstance: undefined });
            }}
            style={{ ...inputCss, minHeight: 70, padding: '4px 6px' }}>
            {availableNodes.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input type="text" value={manualNode} onChange={e => setManualNode(e.target.value)}
              placeholder="…or add a node IP/hostname manually"
              style={{ ...inputCss, padding: '4px 8px' }} />
            <button type="button"
              onClick={() => {
                const t = manualNode.trim();
                if (!t) return;
                if (!nodeArr.includes(t)) onChangeFn({ nodeInstances: [...nodeArr, t], nodeInstance: undefined });
                setManualNode('');
              }}
              style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600,
                background: 'var(--color-primary, #3b82f6)', color: 'white',
                border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              Add
            </button>
          </div>
          {availableNodes.length === 0 && !loadingNodes && (
            <div style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', padding: '4px 8px', borderRadius: 4, marginTop: 6 }}>
              ⚠ No nodes discovered from Prometheus. Use manual entry above.
            </div>
          )}
        </div>
      );
    }
    return (
      <div style={{ gridColumn: '1 / -1', padding: '8px 10px', background: '#f0f9ff', borderRadius: 6, fontSize: 11, color: '#075985' }}>
        Cluster-scoped — the query is evaluated as a single aggregate (no namespace / pod / node filter).
      </div>
    );
  };

  const renderConditionEditor = (cond: RuleCondition, idx: number, isFirst: boolean) => {
    const scope = cond.scope || 'pod';
    const allowedUnits = getAllowedUnits(cond.query);
    const unit = cond.unit || getDefaultUnit(cond.query);
    const tErr = validateThreshold(Number(cond.threshold), unit);
    return (
      <div key={idx} style={{
        border: '1px solid #d1d5db', borderLeft: `4px solid ${SCOPE_COLORS[scope]}`,
        background: 'white', padding: 12, borderRadius: 6, marginTop: isFirst ? 0 : 8,
      }}>
        {!isFirst && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12 }}>
            <span style={{ color: '#6b7280' }}>combined with</span>
            <select value={draftRule?.logicalOperator || 'AND'}
              onChange={e => updateDraft({ logicalOperator: e.target.value as LogicalOperator })}
              style={{ ...inputCss, width: 80, padding: '4px 8px', fontWeight: 700 }}>
              <option value="AND">AND</option>
              <option value="OR">OR</option>
            </select>
            <span style={{ color: '#6b7280' }}>previous condition</span>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <div>
            <label style={labelCss}>Scope</label>
            <select value={scope} onChange={e => updateCondition(idx, { scope: e.target.value as RuleScope })} style={inputCss}>
              <option value="pod">Pod</option>
              <option value="node">Node</option>
              <option value="cluster">Cluster (aggregate)</option>
            </select>
          </div>
          {renderTargetSelectors(cond, (patch) => updateCondition(idx, patch))}
          <div>
            <label style={labelCss}>Mode</label>
            <select value={cond.queryMode || 'quick'}
              onChange={e => updateCondition(idx, { queryMode: e.target.value as 'quick' | 'raw' })} style={inputCss}>
              <option value="quick">Templated (named)</option>
              <option value="raw">Raw PromQL</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelCss}>{cond.queryMode === 'raw' ? 'PromQL expression *' : 'Named query *'}</label>
            <input type="text" value={cond.query}
              onChange={e => {
                const q = e.target.value;
                const allowed = getAllowedUnits(q);
                const wantUnit = allowed.includes(cond.unit as MetricUnit) ? cond.unit : getDefaultUnit(q);
                updateCondition(idx, { query: q, unit: wantUnit });
              }}
              placeholder={cond.queryMode === 'raw' ? 'e.g. node_filesystem_avail_bytes / 1e9' : 'e.g. PodCPUUsage'}
              style={{ ...inputCss, fontFamily: 'monospace' }} />
          </div>
          <div>
            <label style={labelCss}>Op</label>
            <select value={cond.operator}
              onChange={e => updateCondition(idx, { operator: e.target.value as ComparisonOperator })} style={inputCss}>
              <option value=">">&gt;</option>
              <option value="<">&lt;</option>
              <option value=">=">&gt;=</option>
              <option value="<=">&lt;=</option>
              <option value="==">==</option>
              <option value="!=">!=</option>
            </select>
          </div>
          <div>
            <label style={labelCss}>Threshold</label>
            <input type="number" value={cond.threshold}
              onChange={e => updateCondition(idx, { threshold: Number(e.target.value) })}
              style={{ ...inputCss, ...(tErr ? { borderColor: '#ef4444' } : {}) }} />
            {tErr && <div style={{ fontSize: 10, color: '#ef4444', marginTop: 2 }}>{tErr}</div>}
          </div>
          <div>
            <label style={labelCss}>Unit</label>
            <select value={unit} onChange={e => updateCondition(idx, { unit: e.target.value as MetricUnit })} style={inputCss}>
              {allowedUnits.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            {!isFirst && (
              <button type="button" onClick={() => removeCondition(idx)}
                style={{ padding: '6px 10px', background: 'none', border: '1px solid #ef4444', color: '#ef4444',
                  borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderDraft = () => {
    if (!draftRule) return null;
    const composite = ruleHasComposite(draftRule);
    const primaryScope = draftRule.scope || 'pod';
    const primaryMode = draftRule.queryMode || 'quick';
    const allowedUnits = getAllowedUnits(draftRule.query);
    const unit = draftRule.unit || getDefaultUnit(draftRule.query);
    const tErr = !composite ? validateThreshold(Number(draftRule.threshold), unit) : null;

    return (
      <div style={{
        border: '2px solid var(--color-primary, #3b82f6)', background: '#eff6ff',
        borderRadius: 8, padding: 16, marginTop: 12,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: 14 }}>{editingId ? `Edit Rule — ${draftRule.name || 'unnamed'}` : 'New Custom Rule'}</strong>
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            {composite ? `Composite (${(draftRule.conditions || []).length} conditions, ${draftRule.logicalOperator || 'AND'})` : 'Single condition'}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={labelCss}>Rule Name *</label>
            <input type="text" value={draftRule.name} onChange={e => updateDraft({ name: e.target.value })}
              placeholder="e.g. Critical pod CPU + restarts" style={inputCss} />
          </div>
          <div>
            <label style={labelCss}>Severity</label>
            <select value={draftRule.severity}
              onChange={e => updateDraft({ severity: e.target.value as MonitoringRule['severity'] })} style={inputCss}>
              <option value="Critical">Critical</option>
              <option value="Moderate">Moderate</option>
              <option value="Low">Low</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelCss}>Description (optional)</label>
            <input type="text" value={draftRule.description || ''}
              onChange={e => updateDraft({ description: e.target.value })}
              placeholder="What this alert means / how to react" style={inputCss} />
          </div>
        </div>

        {!composite && (
          <div style={{ border: '1px solid #d1d5db', borderLeft: `4px solid ${SCOPE_COLORS[primaryScope]}`,
            background: 'white', padding: 12, borderRadius: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <div>
                <label style={labelCss}>Scope</label>
                <select value={primaryScope} onChange={e => updateDraft({ scope: e.target.value as RuleScope })} style={inputCss}>
                  <option value="pod">Pod</option>
                  <option value="node">Node</option>
                  <option value="cluster">Cluster (aggregate)</option>
                </select>
              </div>
              {renderTargetSelectors(draftRule, updateDraft)}
              <div>
                <label style={labelCss}>Mode</label>
                <select value={primaryMode} onChange={e => updateDraft({ queryMode: e.target.value as 'quick' | 'raw' })} style={inputCss}>
                  <option value="quick">Templated (named)</option>
                  <option value="raw">Raw PromQL</option>
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelCss}>{primaryMode === 'raw' ? 'PromQL expression *' : 'Named query *'}</label>
                <input type="text" value={draftRule.query}
                  onChange={e => {
                    const q = e.target.value;
                    const allowed = getAllowedUnits(q);
                    const wantUnit = allowed.includes(unit) ? unit : getDefaultUnit(q);
                    updateDraft({ query: q, unit: wantUnit });
                  }}
                  placeholder={primaryMode === 'raw' ? 'e.g. node_filesystem_avail_bytes / 1e9' : 'e.g. PodCPUUsage'}
                  style={{ ...inputCss, fontFamily: 'monospace' }} />
              </div>
              <div>
                <label style={labelCss}>Trigger when result</label>
                <select value={draftRule.operator}
                  onChange={e => updateDraft({ operator: e.target.value as ComparisonOperator })} style={inputCss}>
                  <option value=">">&gt;</option>
                  <option value="<">&lt;</option>
                  <option value=">=">&gt;=</option>
                  <option value="<=">&lt;=</option>
                  <option value="==">==</option>
                  <option value="!=">!=</option>
                </select>
              </div>
              <div>
                <label style={labelCss}>… than</label>
                <input type="number" value={draftRule.threshold}
                  onChange={e => updateDraft({ threshold: Number(e.target.value) })}
                  style={{ ...inputCss, ...(tErr ? { borderColor: '#ef4444' } : {}) }} />
                {tErr && <div style={{ fontSize: 10, color: '#ef4444', marginTop: 2 }}>{tErr}</div>}
              </div>
              <div>
                <label style={labelCss}>Unit</label>
                <select value={unit} onChange={e => updateDraft({ unit: e.target.value as MetricUnit })} style={inputCss}>
                  {allowedUnits.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelCss}>
                  <input type="checkbox" checked={!!draftRule.collectLogs}
                    onChange={e => updateDraft({ collectLogs: e.target.checked })} />{' '}
                  Collect logs from PC/CVM when this rule fires
                  {draftRule.collectLogs && (
                    <input type="number" min={0.5} max={24} step={0.5}
                      value={draftRule.logDurationHours ?? 1}
                      onChange={e => updateDraft({ logDurationHours: Number(e.target.value) })}
                      style={{ ...inputCss, width: 80, padding: '2px 6px', fontSize: 11, marginLeft: 8 }} />
                  )}{' '}
                  {draftRule.collectLogs && <span style={{ fontSize: 10, color: '#6b7280' }}>hours of recent logs</span>}
                </label>
              </div>
            </div>
          </div>
        )}

        {composite && (
          <div>
            {(draftRule.conditions || []).map((c, i) => renderConditionEditor(c, i, i === 0))}
          </div>
        )}

        {/* Inline error banner */}
        {draftError && (
          <div style={{ marginTop: 8, padding: '6px 10px', background: '#fef2f2', color: '#991b1b',
            border: '1px solid #fecaca', borderRadius: 6, fontSize: 12 }}>
            ⚠ {draftError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => {
            setDraftRule(d => {
              if (!d) return d;
              if (ruleHasComposite(d)) {
                const first = d.conditions![0];
                return { ...d, conditions: [],
                  scope: first.scope, query: first.query, queryMode: first.queryMode,
                  operator: first.operator, threshold: first.threshold, unit: first.unit,
                  namespace: first.namespace, namespaces: first.namespaces,
                  podName: first.podName, podNames: first.podNames,
                  nodeInstance: first.nodeInstance, nodeInstances: first.nodeInstances };
              }
              const seed: RuleCondition = {
                scope: d.scope || 'pod', query: d.query, queryMode: d.queryMode || 'quick',
                operator: d.operator, threshold: d.threshold, unit: d.unit,
                namespace: d.namespace, namespaces: d.namespaces,
                podName: d.podName, podNames: d.podNames,
                nodeInstance: d.nodeInstance, nodeInstances: d.nodeInstances,
              };
              return { ...d, conditions: [seed, blankCondition(d.scope || 'pod')], logicalOperator: 'AND' };
            });
          }}
            style={{ padding: '6px 12px', background: 'white', border: '1px solid #3b82f6', color: '#3b82f6',
              borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            {composite ? '← Switch to single condition' : '+ Combine multiple conditions (AND/OR)'}
          </button>

          {composite && (
            <button type="button" onClick={addCondition}
              style={{ padding: '6px 12px', background: 'white', border: '1px dashed #3b82f6', color: '#3b82f6',
                borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
              + Add another condition
            </button>
          )}

          {testbedId && (
            <button type="button" onClick={runTestQuery}
              style={{ padding: '6px 12px', background: 'white', border: '1px solid #14b8a6', color: '#0f766e',
                borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
              Test query against Prometheus
            </button>
          )}

          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button type="button" onClick={cancelDraft}
              style={{ padding: '6px 14px', background: 'white', border: '1px solid #d1d5db',
                borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="button" onClick={saveDraft} disabled={!!draftError}
              style={{ padding: '6px 14px', background: '#3b82f6', color: 'white', border: 'none',
                borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: draftError ? 'not-allowed' : 'pointer',
                opacity: draftError ? 0.5 : 1 }}>
              {editingId && editingId !== '' ? 'Save Changes' : 'Add Rule'}
            </button>
          </div>
        </div>

        {testResult && (
          <div style={{ marginTop: 8, padding: '6px 10px', background: testResult.startsWith('✓') ? '#ecfdf5' : '#fef2f2',
            color: testResult.startsWith('✓') ? '#065f46' : '#991b1b',
            border: `1px solid ${testResult.startsWith('✓') ? '#a7f3d0' : '#fecaca'}`,
            borderRadius: 6, fontSize: 12, fontFamily: 'monospace' }}>
            {testResult}
          </div>
        )}
      </div>
    );
  };

  const groupedTemplates = useMemo(() => {
    const groups: Record<RuleScope, typeof QUICK_RULE_TEMPLATES> = { pod: [], node: [], cluster: [] };
    QUICK_RULE_TEMPLATES.forEach(t => { groups[(t.scope || 'pod') as RuleScope].push(t); });
    return groups;
  }, []);

  // ── Import / Export ───────────────────────────────────────────
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const exportConfig = () => {
    const payload = {
      schema_version: 2,
      exported_at: new Date().toISOString(),
      monitoring_rules: rules.map(r => ({ ...r, schemaVersion: 2 })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `monitoring-rules-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /** Normalise a legacy rule shape into the modern MonitoringRule. */
  const adaptLegacyRule = (raw: Record<string, unknown>): MonitoringRule => {
    // Best-effort field migration. Each branch is wrapped in a guard so we
    // never overwrite a modern field that's already present.
    const out: MonitoringRule = {
      id: (raw.id as string) || newRuleId(),
      name: (raw.name as string) || (raw.alert_name as string) || (raw.rule_name as string) || 'Imported rule',
      query: (raw.query as string) || (raw.metric as string) || (raw.expr as string) || '',
      operator: (raw.operator as MonitoringRule['operator']) || (raw.comparison as MonitoringRule['operator']) || '>',
      threshold: Number((raw.threshold ?? raw.value ?? 0) as number),
      severity: (raw.severity as MonitoringRule['severity']) || 'Moderate',
      enabled: raw.enabled !== false,
      description: (raw.description as string) || (raw.summary as string) || undefined,
      scope: (raw.scope as MonitoringRule['scope']) || undefined,
      queryMode: (raw.queryMode as 'quick' | 'raw') || (raw.query_mode as 'quick' | 'raw') || 'quick',
      unit: (raw.unit as MonitoringRule['unit']) || undefined,
      // pod / namespace / node — singular and plural forms
      namespace: (raw.namespace as string) || undefined,
      namespaces: (raw.namespaces as string[]) || (raw.namespace_list as string[]) || undefined,
      podName: (raw.podName as string) || (raw.pod_name as string) || undefined,
      podNames: (raw.podNames as string[]) || (raw.pod_names as string[]) || (raw.pods as string[]) || undefined,
      nodeInstance: (raw.nodeInstance as string) || (raw.node_instance as string) || undefined,
      nodeInstances: (raw.nodeInstances as string[]) || (raw.node_instances as string[]) || undefined,
      // composite
      conditions: Array.isArray(raw.conditions) ? (raw.conditions as MonitoringRule['conditions']) : undefined,
      logicalOperator: (raw.logicalOperator as MonitoringRule['logicalOperator'])
        || (raw.logical_operator as MonitoringRule['logicalOperator']) || undefined,
      // log-collection
      collectLogs: (raw.collectLogs as boolean) || (raw.collect_logs as boolean) || false,
      logDurationHours: (raw.logDurationHours as number) || (raw.log_duration_hours as number) || undefined,
      schemaVersion: 2,
    };
    return out;
  };

  const importFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const parsed = JSON.parse(text);
        // Accept either a wrapped { monitoring_rules: [...] } or a bare array
        const incoming = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.monitoring_rules) ? parsed.monitoring_rules
          : Array.isArray(parsed?.rules) ? parsed.rules
          : null;
        if (!incoming) throw new Error('JSON must contain an array of rules (or { monitoring_rules: [...] }).');

        const adapted: MonitoringRule[] = (incoming as Record<string, unknown>[]).map(adaptLegacyRule);
        const valid: MonitoringRule[] = adapted.filter((r: MonitoringRule) => !!r.name && !!r.query);
        const dropped = adapted.length - valid.length;
        // Merge by name: replace existing same-name rules, append the rest
        const byName = new Map<string, MonitoringRule>(rules.map(r => [r.name.trim().toLowerCase(), r]));
        valid.forEach((r: MonitoringRule) => byName.set(r.name.trim().toLowerCase(), { ...r, id: newRuleId() }));
        onChange(Array.from(byName.values()));
        setImportMessage(`Imported ${valid.length} rule(s).${dropped > 0 ? ` ${dropped} skipped (missing name or query).` : ''}`);
        setTimeout(() => setImportMessage(null), 6000);
      } catch (err) {
        setImportMessage(`Import failed: ${(err as Error).message}`);
        setTimeout(() => setImportMessage(null), 8000);
      }
    };
    reader.readAsText(file);
  };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) importFromFile(f);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div>
      {!embedded && (
        <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="material-icons-outlined" style={{ fontSize: 20, color: '#3b82f6' }}>monitoring</i>
          Monitoring Rules
        </h3>
      )}

      {/* Quick-add chips, grouped by scope */}
      {(['pod', 'node', 'cluster'] as RuleScope[]).map(scope => (
        <div key={scope} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: SCOPE_COLORS[scope], textTransform: 'uppercase',
            letterSpacing: '0.05em', marginBottom: 6 }}>
            {SCOPE_LABELS[scope]} rules
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {groupedTemplates[scope].map(tpl => {
              // Smart dedup: only mark a quick-chip "added" if a rule with this
              // EXACT name exists; otherwise let the user add a customised copy.
              const existingByName = rules.find(r => r.name === tpl.name);
              return (
                <button key={tpl.name + scope} type="button" onClick={() => startQuick(tpl)}
                  title={tpl.description}
                  style={{
                    padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500,
                    cursor: 'pointer', border: existingByName ? '1px solid #22c55e' : 'none',
                    background: existingByName ? '#f0fdf4' : `${SEVERITY_COLORS[tpl.severity]}1a`,
                    color: existingByName ? '#166534' : SEVERITY_COLORS[tpl.severity],
                  }}>
                  {existingByName ? '✓ ' : '+ '}{tpl.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Active rules table */}
      {rules.length > 0 && (
        <div style={{ border: '1px solid #d1d5db', borderRadius: 8, overflow: 'hidden', marginTop: 16, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ padding: '8px', textAlign: 'left', width: 40 }}>On</th>
                <th style={{ padding: '8px', textAlign: 'left' }}>Rule</th>
                <th style={{ padding: '8px', textAlign: 'left', width: 90 }}>Scope</th>
                <th style={{ padding: '8px', textAlign: 'left' }}>Condition(s)</th>
                <th style={{ padding: '8px', textAlign: 'center', width: 90 }}>Severity</th>
                <th style={{ padding: '8px', textAlign: 'center', width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => {
                const composite = ruleHasComposite(rule);
                const scope: RuleScope = rule.scope || 'pod';
                return (
                  <React.Fragment key={rule.id}>
                    <tr style={{ borderTop: '1px solid #d1d5db', opacity: rule.enabled ? 1 : 0.5,
                      background: editingId === rule.id ? '#eff6ff' : 'transparent' }}>
                      <td style={{ padding: '6px 8px' }}>
                        <input type="checkbox" checked={rule.enabled} onChange={() => toggleRule(rule.id)} />
                      </td>
                      <td style={{ padding: '6px 8px', fontWeight: 500 }}>
                        {rule.name}
                        {rule.collectLogs && (
                          <span title="Will collect logs on violation"
                            style={{ marginLeft: 6, padding: '1px 5px', background: '#fef3c7', color: '#92400e',
                              borderRadius: 3, fontSize: 10, fontWeight: 700 }}>LOG</span>
                        )}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                          background: `${SCOPE_COLORS[scope]}1a`, color: SCOPE_COLORS[scope],
                          fontSize: 11, fontWeight: 600 }}>
                          {composite ? 'COMPOSITE' : SCOPE_LABELS[scope].toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '6px 8px' }}><RuleSummary rule={rule} /></td>
                      <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                        <select value={rule.severity}
                          onChange={e => updateRuleField(rule.id, 'severity', e.target.value)}
                          style={{ padding: '2px 6px', border: 'none', borderRadius: 999, fontSize: 11, fontWeight: 600,
                            background: `${SEVERITY_COLORS[rule.severity]}26`, color: SEVERITY_COLORS[rule.severity] }}>
                          <option value="Critical">Critical</option>
                          <option value="Moderate">Moderate</option>
                          <option value="Low">Low</option>
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button type="button" onClick={() => startEdit(rule)} title="Edit rule"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', marginRight: 4 }}>
                          <i className="material-icons-outlined" style={{ fontSize: 18 }}>edit</i>
                        </button>
                        <button type="button" onClick={() => removeRule(rule.id)} title="Delete rule"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                          <i className="material-icons-outlined" style={{ fontSize: 18 }}>delete_outline</i>
                        </button>
                      </td>
                    </tr>
                    {editingId === rule.id && draftRule && (
                      <tr><td colSpan={6} style={{ padding: 0, background: '#f8fafc' }}>{renderDraft()}</td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add custom rule + import / export */}
      <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {(editingId === null || editingId === '') && draftRule ? null : (
          <>
            <button type="button" onClick={startCustom}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                border: '2px dashed #d1d5db', borderRadius: 8, background: 'none', cursor: 'pointer',
                color: '#3b82f6', fontSize: 12, fontWeight: 600 }}>
              <i className="material-icons-outlined" style={{ fontSize: 18 }}>add</i>
              Add Custom Rule (single or composite AND/OR)
            </button>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => fileInputRef.current?.click()}
              title="Import rules from a JSON file (legacy & modern formats supported)"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                border: '1px solid #d1d5db', borderRadius: 6, background: 'white', cursor: 'pointer',
                color: '#1e293b', fontSize: 12 }}>
              <i className="material-icons-outlined" style={{ fontSize: 16 }}>file_upload</i>
              Import
            </button>
            <button type="button" onClick={exportConfig} disabled={rules.length === 0}
              title="Download current rules as JSON"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                border: '1px solid #d1d5db', borderRadius: 6,
                background: rules.length === 0 ? '#f3f4f6' : 'white',
                cursor: rules.length === 0 ? 'not-allowed' : 'pointer',
                color: rules.length === 0 ? '#9ca3af' : '#1e293b', fontSize: 12 }}>
              <i className="material-icons-outlined" style={{ fontSize: 16 }}>file_download</i>
              Export
            </button>
            <input ref={fileInputRef} type="file" accept="application/json,.json"
              onChange={onFileChosen} style={{ display: 'none' }} />
          </>
        )}
        {(editingId === null || editingId === '') && draftRule && renderDraft()}
      </div>

      {importMessage && (
        <div style={{ marginTop: 10, padding: '8px 12px',
          background: importMessage.startsWith('Import failed') ? '#fef2f2' : '#ecfdf5',
          color: importMessage.startsWith('Import failed') ? '#991b1b' : '#065f46',
          border: `1px solid ${importMessage.startsWith('Import failed') ? '#fecaca' : '#a7f3d0'}`,
          borderRadius: 6, fontSize: 12 }}>
          {importMessage}
        </div>
      )}

      {rules.length > 0 && (
        <div style={{ marginTop: 12, padding: '8px 12px', background: '#eff6ff', borderRadius: 6,
          border: '1px solid #bfdbfe', fontSize: 11, color: '#1e40af' }}>
          <i className="material-icons-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }}>info</i>
          Rules are evaluated against Prometheus on every poll. Click <strong>edit</strong> to modify any rule, or click a Quick chip to start with a template.
        </div>
      )}
    </div>
  );
};

export default MonitoringRulesEditor;
