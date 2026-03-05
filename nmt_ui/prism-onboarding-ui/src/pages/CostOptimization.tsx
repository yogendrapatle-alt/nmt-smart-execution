import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import '../styles/CostOptimization.css';

interface Recommendation {
  type: string;
  message: string;
  savings: number;
  impact: 'low' | 'medium' | 'high';
}

const CostOptimization: React.FC = () => {
  const navigate = useNavigate();
  
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalSavings, setTotalSavings] = useState(0);

  useEffect(() => {
    loadRecommendations();
  }, []);

  const loadRecommendations = async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/costs/optimization-recommendations');
      if (response.data.success) {
        setRecommendations(response.data.recommendations);
        
        // Calculate total potential savings
        const total = response.data.recommendations.reduce(
          (sum: number, rec: Recommendation) => sum + rec.savings, 
          0
        );
        setTotalSavings(total);
      }
    } catch (error) {
      console.error('Failed to load recommendations:', error);
    } finally {
      setLoading(false);
    }
  };

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'high': return '#ef4444';
      case 'medium': return '#f59e0b';
      case 'low': return '#10b981';
      default: return '#6b7280';
    }
  };

  const getImpactIcon = (impact: string) => {
    switch (impact) {
      case 'high': return '🔴';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  };

  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };

  if (loading) {
    return (
      <div className="cost-optimization">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading recommendations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cost-optimization">
      <div className="page-header">
        <h1>💡 Cost Optimization</h1>
        <button className="btn-secondary" onClick={() => navigate('/cost-dashboard')}>
          ← Back to Dashboard
        </button>
      </div>

      {/* Savings Summary */}
      <div className="savings-summary">
        <div className="summary-card">
          <div className="summary-icon">💰</div>
          <div className="summary-content">
            <h2>Potential Monthly Savings</h2>
            <div className="savings-amount">{formatCurrency(totalSavings)}</div>
            <p>{recommendations.length} optimization opportunities found</p>
          </div>
        </div>
      </div>

      {/* Recommendations */}
      <div className="recommendations-section">
        <h2>Optimization Recommendations</h2>
        
        {recommendations.length === 0 ? (
          <div className="no-recommendations">
            <div className="success-icon">✅</div>
            <h3>Great job!</h3>
            <p>No optimization opportunities found. Your system is running efficiently.</p>
          </div>
        ) : (
          <div className="recommendations-list">
            {recommendations.map((rec, index) => (
              <div key={index} className="recommendation-card">
                <div className="rec-header">
                  <div className="rec-title">
                    <span className="impact-icon">{getImpactIcon(rec.impact)}</span>
                    <span className="rec-type">{rec.type.replace(/_/g, ' ').toUpperCase()}</span>
                  </div>
                  <div className="rec-savings" style={{ color: getImpactColor(rec.impact) }}>
                    {formatCurrency(rec.savings)} / month
                  </div>
                </div>
                
                <div className="rec-body">
                  <p className="rec-message">{rec.message}</p>
                  
                  <div className="rec-impact">
                    <span 
                      className={`impact-badge impact-${rec.impact}`}
                      style={{ borderColor: getImpactColor(rec.impact), color: getImpactColor(rec.impact) }}
                    >
                      {rec.impact.toUpperCase()} IMPACT
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Best Practices */}
      <div className="best-practices">
        <h2>💡 Cost Optimization Best Practices</h2>
        <div className="practices-grid">
          <div className="practice-card">
            <div className="practice-icon">🎯</div>
            <h3>Set Realistic Thresholds</h3>
            <p>Avoid setting CPU/Memory thresholds too high. Aim for 70-80% instead of 90%+.</p>
          </div>
          
          <div className="practice-card">
            <div className="practice-icon">⏰</div>
            <h3>Schedule Off-Peak Runs</h3>
            <p>Run non-urgent executions during off-peak hours when infrastructure costs are lower.</p>
          </div>
          
          <div className="practice-card">
            <div className="practice-icon">🔄</div>
            <h3>Reuse Resources</h3>
            <p>Clean up and reuse test resources instead of creating new ones for each execution.</p>
          </div>
          
          <div className="practice-card">
            <div className="practice-icon">📊</div>
            <h3>Monitor Regularly</h3>
            <p>Review cost reports weekly to identify trends and optimization opportunities early.</p>
          </div>
          
          <div className="practice-card">
            <div className="practice-icon">🚫</div>
            <h3>Avoid Failed Operations</h3>
            <p>Failed operations waste resources. Improve success rates through proper validation.</p>
          </div>
          
          <div className="practice-card">
            <div className="practice-icon">💵</div>
            <h3>Set Budget Limits</h3>
            <p>Configure budget limits per testbed to prevent cost overruns automatically.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CostOptimization;
