import React from 'react';
import type { RecentOperation } from './types';

interface Props {
  operations: RecentOperation[];
}

const OperationsFeed: React.FC<Props> = ({ operations }) => {
  if (!operations.length) return null;

  return (
    <div className="card border-0 rounded-4 shadow-sm mb-3">
      <div className="card-header bg-transparent border-0 pt-3 px-4">
        <h6 className="fw-semibold mb-0 d-flex align-items-center gap-2">
          <i className="material-icons-outlined" style={{ fontSize: 20 }}>receipt_long</i> Recent Operations
        </h6>
      </div>
      <div className="card-body pt-0 monitor-ops-feed">
        {operations.slice().reverse().map((op, idx) => (
          <div key={idx} className="op-row">
            <i className="material-icons-outlined" style={{ fontSize: 14, color: op.success ? '#22c55e' : '#ef4444' }}>
              {op.success ? 'check_circle' : 'cancel'}
            </i>
            <span className="op-entity">{op.entity_type}</span>
            <span className="op-badge">{op.operation}</span>
            {op.duration != null && <span className="op-duration">{op.duration.toFixed(1)}s</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

export default OperationsFeed;
