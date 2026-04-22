import React from 'react';
import type { MLRecommendation } from './types';

interface Props {
  recommendations: MLRecommendation[];
}

const MLRecommendationsPanel: React.FC<Props> = ({ recommendations }) => {
  if (!recommendations.length) return null;

  return (
    <div className="card border-0 rounded-4 shadow-sm mb-3">
      <div className="card-header bg-transparent border-0 pt-3 px-4">
        <h6 className="fw-semibold mb-0 d-flex align-items-center gap-2">
          <i className="material-icons-outlined" style={{ fontSize: 20 }}>lightbulb</i> ML Recommendations
        </h6>
      </div>
      <div className="card-body pt-0">
        <div className="table-responsive">
          <table className="table table-sm table-hover mb-0 small">
            <thead className="table-light">
              <tr>
                <th>#</th>
                <th>Entity</th>
                <th>Operation</th>
                <th className="text-end">CPU Impact</th>
                <th className="text-end">Memory Impact</th>
                <th className="text-end">Score</th>
                <th className="text-end">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {recommendations.slice(0, 5).map((rec, idx) => (
                <tr key={idx}>
                  <td className="text-muted">{idx + 1}</td>
                  <td className="fw-semibold">{rec.entity}</td>
                  <td><span className="badge bg-secondary bg-opacity-10 text-secondary rounded-pill">{rec.operation}</span></td>
                  <td className="text-end">+{rec.cpu_impact.toFixed(1)}%</td>
                  <td className="text-end">+{rec.memory_impact.toFixed(1)}%</td>
                  <td className="text-end fw-semibold">{rec.score.toFixed(2)}</td>
                  <td className="text-end">{(rec.confidence * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default MLRecommendationsPanel;
