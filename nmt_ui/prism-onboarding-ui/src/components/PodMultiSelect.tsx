import React, { useMemo, useRef, useState, useEffect } from 'react';

/**
 * Pod multi-select with namespace grouping, search, "select all" per group,
 * and an "Add manually" escape hatch for the (common) case where Prometheus
 * discovery returns nothing.
 *
 * The component is dependency-free (no react-select) so the editor stays
 * portable and identical to the rest of the codebase styling.
 */
interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** All pods, ungrouped — used as fallback if `podsByNamespace` is empty. */
  allPods: string[];
  /** Map of namespace → pods inside it. When provided, pods are grouped under
   *  collapsible namespace headers in the dropdown. */
  podsByNamespace?: Record<string, string[]>;
  /** Filter pods by these namespaces. Empty array = no filter. */
  namespacesFilter?: string[];
  placeholder?: string;
  size?: 'sm' | 'md';
  inputCss?: React.CSSProperties;
}

const PodMultiSelect: React.FC<Props> = ({
  value, onChange, allPods, podsByNamespace, namespacesFilter, placeholder, size = 'sm', inputCss,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [manual, setManual] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const groups = useMemo(() => {
    // If we have ns→pods, use it; else stuff everything under "all".
    const src = podsByNamespace && Object.keys(podsByNamespace).length > 0
      ? podsByNamespace
      : { '': allPods };
    const filteredNs = namespacesFilter && namespacesFilter.length > 0
      ? Object.fromEntries(Object.entries(src).filter(([ns]) => namespacesFilter.includes(ns)))
      : src;
    const lower = search.trim().toLowerCase();
    const out: Array<[string, string[]]> = [];
    Object.entries(filteredNs).forEach(([ns, pods]) => {
      const matched = (pods || []).filter(p => !lower || p.toLowerCase().includes(lower));
      if (matched.length > 0) out.push([ns, matched.sort()]);
    });
    return out;
  }, [podsByNamespace, allPods, namespacesFilter, search]);

  const togglePod = (pod: string) => {
    if (value.includes(pod)) onChange(value.filter(p => p !== pod));
    else onChange([...value, pod]);
  };
  const toggleGroup = (pods: string[]) => {
    const allSelected = pods.every(p => value.includes(p));
    if (allSelected) onChange(value.filter(p => !pods.includes(p)));
    else onChange(Array.from(new Set([...value, ...pods])));
  };

  const addManual = () => {
    const trimmed = manual.trim();
    if (!trimmed) return;
    if (!value.includes(trimmed)) onChange([...value, trimmed]);
    setManual('');
  };

  const ic: React.CSSProperties = inputCss || {
    width: '100%', padding: '8px 10px',
    border: '1px solid var(--color-border, #d1d5db)',
    borderRadius: 6, fontSize: size === 'sm' ? 12 : 13,
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ ...ic, cursor: 'pointer', minHeight: 32, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {value.length === 0 && (
          <span style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{placeholder || 'All pods (no filter)'}</span>
        )}
        {value.map(p => (
          <span key={p} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px',
            background: 'var(--color-primary-light, #eff6ff)', color: 'var(--color-primary, #1e40af)',
            borderRadius: 4, fontSize: 11, fontFamily: 'monospace',
          }}>
            {p}
            <span onClick={(e) => { e.stopPropagation(); togglePod(p); }}
              style={{ cursor: 'pointer', fontWeight: 700 }}>×</span>
          </span>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted, #6b7280)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: 'white', border: '1px solid var(--color-border, #d1d5db)',
          borderRadius: 6, marginTop: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          maxHeight: 320, overflowY: 'auto', minWidth: 260,
        }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--color-border, #e5e7eb)' }}>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search pods…" style={{ ...ic, padding: '4px 8px', fontSize: 11 }} />
          </div>

          {groups.length === 0 && (
            <div style={{ padding: 12, color: 'var(--color-text-muted, #6b7280)', fontSize: 12 }}>
              No pods match. Use "Add manually" below if Prometheus discovery is unreachable.
            </div>
          )}

          {groups.map(([ns, pods]) => {
            const groupAll = pods.every(p => value.includes(p));
            const groupSome = !groupAll && pods.some(p => value.includes(p));
            return (
              <div key={ns}>
                <div style={{
                  padding: '4px 8px', background: 'var(--color-surface-muted, #f9fafb)',
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#475569',
                }}>
                  <input type="checkbox"
                    checked={groupAll}
                    ref={el => { if (el) el.indeterminate = groupSome; }}
                    onChange={() => toggleGroup(pods)} />
                  <span>{ns || '(no namespace)'} ({pods.length})</span>
                </div>
                {pods.map(p => (
                  <label key={p} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontFamily: 'monospace',
                    background: value.includes(p) ? '#eff6ff' : 'white',
                  }}>
                    <input type="checkbox" checked={value.includes(p)} onChange={() => togglePod(p)} />
                    {p}
                  </label>
                ))}
              </div>
            );
          })}

          <div style={{ padding: 8, borderTop: '1px solid var(--color-border, #e5e7eb)', display: 'flex', gap: 4 }}>
            <input type="text" value={manual} onChange={e => setManual(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } }}
              placeholder="Add pod name manually…" style={{ ...ic, padding: '4px 8px', fontSize: 11, flex: 1 }} />
            <button type="button" onClick={addManual}
              style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600,
                background: 'var(--color-primary, #3b82f6)', color: 'white',
                border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              Add
            </button>
          </div>

          {value.length > 0 && (
            <div style={{ padding: '6px 8px', borderTop: '1px solid #e5e7eb', textAlign: 'right' }}>
              <button type="button" onClick={() => onChange([])}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-danger, #ef4444)', fontSize: 11 }}>
                Clear all ({value.length})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PodMultiSelect;
