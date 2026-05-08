import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader';
import { useToast } from '../context/ToastContext';
import MonitoringRulesEditor from '../components/MonitoringRulesEditor';
import type { MonitoringRule } from '../components/smart-execution/types';
import { getApiBase } from '../utils/backendUrl';

interface Testbed {
  unique_testbed_id: string;
  testbed_label?: string;
  pc_ip?: string;
  ncm_ip?: string;
  prometheus_url?: string;
  prometheus_endpoint?: string;
}

const MonitorOnlyConfigure: React.FC = () => {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [loadingTestbeds, setLoadingTestbeds] = useState(true);
  const [selectedTestbed, setSelectedTestbed] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pollIntervalS, setPollIntervalS] = useState(30);
  const [durationHours, setDurationHours] = useState(0);
  const [rules, setRules] = useState<MonitoringRule[]>([]);

  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);
  const [availablePods, setAvailablePods] = useState<string[]>([]);
  const [podsByNamespace, setPodsByNamespace] = useState<Record<string, string[]>>({});
  const [loadingPods, setLoadingPods] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Load testbeds on mount
  useEffect(() => {
    (async () => {
      setLoadingTestbeds(true);
      try {
        const res = await fetch(`${getApiBase()}/api/get-testbeds`);
        const data = await res.json();
        if (data?.success && Array.isArray(data.testbeds)) {
          setTestbeds(data.testbeds);
          if (data.testbeds.length === 1) {
            setSelectedTestbed(data.testbeds[0].unique_testbed_id);
          }
        }
      } catch {
        addToast('error', 'Failed to load testbeds');
      } finally {
        setLoadingTestbeds(false);
      }
    })();
  }, [addToast]);

  // Load namespaces/pods when testbed changes
  useEffect(() => {
    if (!selectedTestbed) {
      setAvailableNamespaces([]); setAvailablePods([]); setPodsByNamespace({});
      return;
    }
    setLoadingPods(true);
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/smart-execution/available-pods`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ testbed_id: selectedTestbed }),
        });
        const data = await res.json();
        if (data?.success) {
          setAvailableNamespaces(data.namespaces || []);
          setAvailablePods(data.pods || []);
          setPodsByNamespace(data.pods_by_namespace || {});
        }
      } catch {
        // leave dropdowns empty
      } finally {
        setLoadingPods(false);
      }
    })();

    // Pre-load saved monitoring rules from this testbed (so reusing is one click)
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/testbed/${selectedTestbed}/monitoring-rules`);
        if (res.ok) {
          const data = await res.json();
          if (data?.success && Array.isArray(data.monitoring_rules) && data.monitoring_rules.length > 0 && rules.length === 0) {
            setRules(data.monitoring_rules);
          }
        }
      } catch { /* ignore */ }
    })();
  }, [selectedTestbed]); // eslint-disable-line react-hooks/exhaustive-deps

  const enabledRules = rules.filter(r => r.enabled);
  const canStart = !!selectedTestbed && enabledRules.length > 0 && !submitting;

  const start = async () => {
    if (!canStart) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${getApiBase()}/api/monitor-only/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testbed_id: selectedTestbed,
          name: name.trim() || undefined,
          description: description.trim() || undefined,
          monitoring_rules: enabledRules,
          poll_interval_s: pollIntervalS,
          duration_hours: durationHours > 0 ? durationHours : null,
        }),
      });
      const data = await res.json();
      if (data?.success && data?.monitor) {
        addToast('success', `Monitor session started: ${data.monitor.monitor_id}`);
        if (data.prometheus_reachable === false) {
          addToast('warning', 'Started, but Prometheus did not respond to a probe — verify the testbed URL.');
        }
        navigate(`/monitor-only/run/${data.monitor.monitor_id}`);
      } else {
        addToast('error', data?.error || 'Failed to start monitor');
      }
    } catch (e: unknown) {
      addToast('error', `Network error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container-fluid py-3">
      <PageHeader
        icon="visibility"
        iconGradient="linear-gradient(135deg, #0ea5e9, #0369a1)"
        title="Monitor-Only Testbed"
        subtitle="Watch live Prometheus metrics on a testbed without generating any workload."
        actions={
          <button type="button" className="btn btn-outline-secondary"
            onClick={() => navigate('/monitor-only/sessions')}>
            <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>list</i>
            View running / past sessions
          </button>
        }
      />

      {/* Step 1: choose testbed */}
      <section className="config-section" style={{ marginBottom: 16 }}>
        <h2><i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle' }}>dns</i> 1. Select Testbed</h2>
        {loadingTestbeds ? (
          <div className="text-muted">Loading testbeds…</div>
        ) : testbeds.length === 0 ? (
          <div className="alert alert-warning mb-0">
            No testbeds onboarded yet. Go to <a href="#" onClick={e => { e.preventDefault(); navigate('/onboarding'); }}>Onboard</a> first.
          </div>
        ) : (
          <select className="form-select" value={selectedTestbed} onChange={e => setSelectedTestbed(e.target.value)} style={{ maxWidth: 540 }}>
            <option value="">— pick a testbed —</option>
            {testbeds.map(tb => (
              <option key={tb.unique_testbed_id} value={tb.unique_testbed_id}>
                {tb.testbed_label || tb.unique_testbed_id} {tb.pc_ip ? `(${tb.pc_ip})` : ''}
              </option>
            ))}
          </select>
        )}
      </section>

      {/* Step 2: rules */}
      <section className="config-section" style={{ marginBottom: 16 }}>
        <h2><i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle' }}>monitoring</i> 2. Monitoring Rules</h2>
        <p className="text-muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 12 }}>
          Add Pod / Node / Cluster rules. Use <strong>Add Custom Rule</strong> to combine multiple conditions with AND/OR.
        </p>
        {!selectedTestbed && <div className="text-muted" style={{ fontSize: 12 }}>Pick a testbed above first to populate Pod / Node pickers.</div>}
        {selectedTestbed && loadingPods && <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>Loading namespaces &amp; pods…</div>}
        <MonitoringRulesEditor
          rules={rules}
          onChange={setRules}
          availableNamespaces={availableNamespaces}
          availablePods={availablePods}
          podsByNamespace={podsByNamespace}
          testbedId={selectedTestbed || undefined}
          embedded
        />
      </section>

      {/* Step 3: timing */}
      <section className="config-section" style={{ marginBottom: 16 }}>
        <h2><i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle' }}>schedule</i> 3. Schedule</h2>
        <div className="row g-3" style={{ maxWidth: 720 }}>
          <div className="col-md-4">
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Name (optional)</label>
            <input type="text" className="form-control" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pre-prod soak watch" />
          </div>
          <div className="col-md-4">
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Poll interval (seconds)</label>
            <input type="number" className="form-control" min={10} max={600} value={pollIntervalS}
              onChange={e => setPollIntervalS(Math.max(10, Math.min(600, Number(e.target.value) || 30)))} />
            <small className="text-muted">10–600 seconds. Default 30s.</small>
          </div>
          <div className="col-md-4">
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Duration (hours, 0 = until stopped)</label>
            <input type="number" className="form-control" min={0} max={720} value={durationHours}
              onChange={e => setDurationHours(Math.max(0, Math.min(720, Number(e.target.value) || 0)))} />
          </div>
          <div className="col-12">
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Description (optional)</label>
            <textarea className="form-control" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
          </div>
        </div>
      </section>

      {/* Footer */}
      <div className="d-flex justify-content-between align-items-center" style={{ marginTop: 20 }}>
        <div className="text-muted" style={{ fontSize: 12 }}>
          <strong>{enabledRules.length}</strong> enabled rule{enabledRules.length !== 1 ? 's' : ''} · poll every <strong>{pollIntervalS}s</strong>
          {durationHours > 0 ? <> · stops after <strong>{durationHours}h</strong></> : <> · runs <strong>until stopped</strong></>}
        </div>
        <button type="button" className="btn btn-primary" onClick={start} disabled={!canStart}>
          {submitting && <span className="spinner-border spinner-border-sm me-2" />}
          <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>play_circle</i>
          Start Monitoring
        </button>
      </div>
    </div>
  );
};

export default MonitorOnlyConfigure;
