import React, { useState } from 'react';
import { AVAILABLE_ENTITIES, getAvailableOperations } from './types';

interface StepEntitiesProps {
  selectedEntities: Record<string, string[]>;
  onToggleOperation: (entity: string, operation: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onSetEntityOps: (entity: string, ops: string[]) => void;
}

const StepEntities: React.FC<StepEntitiesProps> = ({
  selectedEntities, onToggleOperation, onSelectAll, onClearAll, onSetEntityOps,
}) => {
  const [filter, setFilter] = useState('');

  const filtered = filter
    ? AVAILABLE_ENTITIES.filter(e => e.replace(/_/g, ' ').toLowerCase().includes(filter.toLowerCase()))
    : AVAILABLE_ENTITIES;

  const totalOps = Object.values(selectedEntities).flat().length;

  return (
    <section className="config-section">
      <h2><i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle' }}>apps</i> Select Entities & Operations</h2>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Filter entities…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '2px solid var(--color-border)',
            fontSize: 'var(--text-sm)', flex: '1 1 200px', maxWidth: 280,
          }}
        />
        <button type="button" className="btn-secondary" style={{ padding: '6px 16px', fontSize: 13 }} onClick={onSelectAll}>
          Select All
        </button>
        <button type="button" className="btn-secondary" style={{ padding: '6px 16px', fontSize: 13 }} onClick={onClearAll}>
          Clear All
        </button>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginLeft: 'auto' }}>
          <strong>{Object.keys(selectedEntities).length}</strong> entities, <strong>{totalOps}</strong> operations
        </span>
      </div>

      <div className="entities-grid">
        {filtered.map(entity => {
          const ops = getAvailableOperations(entity);
          const selected = selectedEntities[entity] || [];
          const allSelected = ops.every(op => selected.includes(op));
          const someSelected = selected.length > 0 && !allSelected;

          return (
            <div key={entity} className="entity-card" style={{
              borderColor: someSelected ? 'var(--color-primary)' : allSelected ? 'var(--color-success)' : undefined,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>{entity.replace(/_/g, ' ').toUpperCase()}</h3>
                {selected.length > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                    background: allSelected ? 'var(--color-success-light)' : 'var(--color-primary-light)',
                    color: allSelected ? 'var(--color-success)' : 'var(--color-primary)',
                  }}>
                    {selected.length}/{ops.length}
                  </span>
                )}
              </div>
              <div className="operations-list">
                <label className="operation-checkbox" style={{ fontWeight: 'bold', borderBottom: '1px solid var(--color-border)', paddingBottom: 4, marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected; }}
                    onChange={() => {
                      if (allSelected) {
                        onSetEntityOps(entity, []);
                      } else {
                        onSetEntityOps(entity, ops);
                      }
                    }}
                  />
                  <span>Select All</span>
                </label>
                {ops.map(operation => (
                  <label key={operation} className="operation-checkbox">
                    <input
                      type="checkbox"
                      checked={selected.includes(operation)}
                      onChange={() => onToggleOperation(entity, operation)}
                    />
                    <span>{operation}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {totalOps > 0 && (
        <div className="selection-summary">
          <strong>Selected:</strong>{' '}
          {Object.entries(selectedEntities)
            .filter(([, ops]) => ops.length > 0)
            .map(([entity, ops]) => `${entity} (${ops.join(', ')})`)
            .join(' | ')}
        </div>
      )}
    </section>
  );
};

export default StepEntities;
