import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import '../styles/BudgetConfiguration.css';
import { getApiBase } from '../utils/backendUrl';

interface Budget {
  id: number;
  budget_id: string;
  scope_type: string;
  scope_id: string | null;
  scope_name: string;
  limits: {
    daily_limit: number | null;
    weekly_limit: number | null;
    monthly_limit: number | null;
  };
  spending: {
    daily_spent: number;
    weekly_spent: number;
    monthly_spent: number;
  };
  thresholds: {
    alert_threshold: number;
    block_threshold: number;
  };
  status: {
    is_active: boolean;
    is_blocking: boolean;
  };
  budget_status: {
    daily: any;
    weekly: any;
    monthly: any;
  };
}

interface Testbed {
  unique_testbed_id: string;
  testbed_name?: string;
  pc_ip?: string;
}

const BudgetConfiguration: React.FC = () => {
  const navigate = useNavigate();
  
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    scope_type: 'testbed',
    scope_id: '',
    scope_name: '',
    daily_limit: '',
    weekly_limit: '',
    monthly_limit: '',
    alert_threshold: '80',
    block_threshold: '100'
  });

  useEffect(() => {
    loadBudgets();
    loadTestbeds();
  }, []);

  const loadBudgets = async () => {
    try {
      const response = await axios.get(`${getApiBase()}/api/budgets`);
      if (response.data.success) {
        setBudgets(response.data.budgets);
      }
    } catch (error) {
      console.error('Failed to load budgets:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTestbeds = async () => {
    try {
      const response = await axios.get(`${getApiBase()}/api/testbeds`);
      if (response.data.success) {
        setTestbeds(response.data.testbeds);
      }
    } catch (error) {
      console.error('Failed to load testbeds:', error);
    }
  };

  const openCreateModal = () => {
    setEditingBudget(null);
    setFormData({
      scope_type: 'testbed',
      scope_id: '',
      scope_name: '',
      daily_limit: '',
      weekly_limit: '',
      monthly_limit: '',
      alert_threshold: '80',
      block_threshold: '100'
    });
    setShowModal(true);
  };

  const openEditModal = (budget: Budget) => {
    setEditingBudget(budget);
    setFormData({
      scope_type: budget.scope_type,
      scope_id: budget.scope_id || '',
      scope_name: budget.scope_name,
      daily_limit: budget.limits.daily_limit?.toString() || '',
      weekly_limit: budget.limits.weekly_limit?.toString() || '',
      monthly_limit: budget.limits.monthly_limit?.toString() || '',
      alert_threshold: budget.thresholds.alert_threshold.toString(),
      block_threshold: budget.thresholds.block_threshold.toString()
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const payload = {
        scope_type: formData.scope_type,
        scope_id: formData.scope_id || null,
        scope_name: formData.scope_name,
        daily_limit: formData.daily_limit ? parseFloat(formData.daily_limit) : null,
        weekly_limit: formData.weekly_limit ? parseFloat(formData.weekly_limit) : null,
        monthly_limit: formData.monthly_limit ? parseFloat(formData.monthly_limit) : null,
        alert_threshold: parseFloat(formData.alert_threshold),
        block_threshold: parseFloat(formData.block_threshold),
        created_by: 'admin'
      };
      
      if (editingBudget) {
        // Update
        await axios.put(`${getApiBase()}/api/budgets/${editingBudget.budget_id}`, payload);
        alert('Budget updated successfully!');
      } else {
        // Create
        await axios.post(`${getApiBase()}/api/budgets`, payload);
        alert('Budget created successfully!');
      }
      
      setShowModal(false);
      loadBudgets();
      
    } catch (error) {
      console.error('Failed to save budget:', error);
      alert('Failed to save budget. Please try again.');
    }
  };

  const deleteBudget = async (budgetId: string) => {
    if (!confirm('Are you sure you want to delete this budget?')) {
      return;
    }
    
    try {
      await axios.delete(`${getApiBase()}/api/budgets/${budgetId}`);
      alert('Budget deleted successfully!');
      loadBudgets();
    } catch (error) {
      console.error('Failed to delete budget:', error);
      alert('Failed to delete budget. Please try again.');
    }
  };

  const getBudgetStatusColor = (status: string) => {
    switch (status) {
      case 'ok': return '#10b981';
      case 'warning': return '#f59e0b';
      case 'blocked': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };

  if (loading) {
    return (
      <div className="budget-configuration">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading budgets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="budget-configuration">
      <div className="page-header">
        <h1>💵 Budget Configuration</h1>
        <div className="header-actions">
          <button className="btn-secondary" onClick={() => navigate('/cost-dashboard')}>
            ← Back to Dashboard
          </button>
          <button className="btn-primary" onClick={openCreateModal}>
            + Create Budget
          </button>
        </div>
      </div>

      {/* Budgets List */}
      <div className="budgets-list">
        {budgets.length === 0 ? (
          <div className="no-budgets">
            <p>No budgets configured yet.</p>
            <button className="btn-primary" onClick={openCreateModal}>
              Create Your First Budget
            </button>
          </div>
        ) : (
          budgets.map((budget) => (
            <div key={budget.id} className="budget-card">
              <div className="budget-header">
                <div className="budget-title">
                  <h3>{budget.scope_name}</h3>
                  <span className="budget-type">{budget.scope_type}</span>
                </div>
                <div className="budget-actions">
                  <button className="btn-icon" onClick={() => openEditModal(budget)}>
                    ✏️
                  </button>
                  <button className="btn-icon" onClick={() => deleteBudget(budget.budget_id)}>
                    🗑️
                  </button>
                </div>
              </div>
              
              <div className="budget-limits">
                {budget.limits.daily_limit && (
                  <div className="limit-item">
                    <div className="limit-header">
                      <span>Daily Limit</span>
                      <span className="limit-value">{formatCurrency(budget.limits.daily_limit)}</span>
                    </div>
                    <div className="progress-bar">
                      <div 
                        className="progress-fill" 
                        style={{ 
                          width: `${budget.budget_status.daily.percentage}%`,
                          background: getBudgetStatusColor(budget.budget_status.daily.status)
                        }}
                      ></div>
                    </div>
                    <div className="limit-status">
                      <span>{formatCurrency(budget.spending.daily_spent)} spent</span>
                      <span>{budget.budget_status.daily.percentage}%</span>
                    </div>
                  </div>
                )}
                
                {budget.limits.weekly_limit && (
                  <div className="limit-item">
                    <div className="limit-header">
                      <span>Weekly Limit</span>
                      <span className="limit-value">{formatCurrency(budget.limits.weekly_limit)}</span>
                    </div>
                    <div className="progress-bar">
                      <div 
                        className="progress-fill" 
                        style={{ 
                          width: `${budget.budget_status.weekly.percentage}%`,
                          background: getBudgetStatusColor(budget.budget_status.weekly.status)
                        }}
                      ></div>
                    </div>
                    <div className="limit-status">
                      <span>{formatCurrency(budget.spending.weekly_spent)} spent</span>
                      <span>{budget.budget_status.weekly.percentage}%</span>
                    </div>
                  </div>
                )}
                
                {budget.limits.monthly_limit && (
                  <div className="limit-item">
                    <div className="limit-header">
                      <span>Monthly Limit</span>
                      <span className="limit-value">{formatCurrency(budget.limits.monthly_limit)}</span>
                    </div>
                    <div className="progress-bar">
                      <div 
                        className="progress-fill" 
                        style={{ 
                          width: `${budget.budget_status.monthly.percentage}%`,
                          background: getBudgetStatusColor(budget.budget_status.monthly.status)
                        }}
                      ></div>
                    </div>
                    <div className="limit-status">
                      <span>{formatCurrency(budget.spending.monthly_spent)} spent</span>
                      <span>{budget.budget_status.monthly.percentage}%</span>
                    </div>
                  </div>
                )}
              </div>
              
              {budget.status.is_blocking && (
                <div className="budget-warning">
                  ⚠️ Budget exceeded - new executions are blocked!
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingBudget ? 'Edit Budget' : 'Create Budget'}</h2>
              <button className="btn-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Scope Type</label>
                <select 
                  value={formData.scope_type}
                  onChange={(e) => setFormData({...formData, scope_type: e.target.value})}
                  required
                >
                  <option value="testbed">Testbed</option>
                  <option value="global">Global</option>
                </select>
              </div>
              
              {formData.scope_type === 'testbed' && (
                <div className="form-group">
                  <label>Testbed</label>
                  <select 
                    value={formData.scope_id}
                    onChange={(e) => {
                      const testbed = testbeds.find(t => t.unique_testbed_id === e.target.value);
                      setFormData({
                        ...formData, 
                        scope_id: e.target.value,
                        scope_name: testbed?.testbed_name || e.target.value
                      });
                    }}
                    required
                  >
                    <option value="">Select testbed...</option>
                    {testbeds.map(tb => (
                      <option key={tb.unique_testbed_id} value={tb.unique_testbed_id}>
                        {tb.testbed_name || tb.pc_ip}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              
              {formData.scope_type === 'global' && (
                <div className="form-group">
                  <label>Budget Name</label>
                  <input 
                    type="text"
                    value={formData.scope_name}
                    onChange={(e) => setFormData({...formData, scope_name: e.target.value})}
                    placeholder="e.g., Global Monthly Budget"
                    required
                  />
                </div>
              )}
              
              <div className="form-row">
                <div className="form-group">
                  <label>Daily Limit ($)</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={formData.daily_limit}
                    onChange={(e) => setFormData({...formData, daily_limit: e.target.value})}
                    placeholder="Optional"
                  />
                </div>
                
                <div className="form-group">
                  <label>Weekly Limit ($)</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={formData.weekly_limit}
                    onChange={(e) => setFormData({...formData, weekly_limit: e.target.value})}
                    placeholder="Optional"
                  />
                </div>
                
                <div className="form-group">
                  <label>Monthly Limit ($)</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={formData.monthly_limit}
                    onChange={(e) => setFormData({...formData, monthly_limit: e.target.value})}
                    placeholder="Optional"
                  />
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Alert Threshold (%)</label>
                  <input 
                    type="number"
                    min="0"
                    max="100"
                    value={formData.alert_threshold}
                    onChange={(e) => setFormData({...formData, alert_threshold: e.target.value})}
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label>Block Threshold (%)</label>
                  <input 
                    type="number"
                    min="0"
                    max="100"
                    value={formData.block_threshold}
                    onChange={(e) => setFormData({...formData, block_threshold: e.target.value})}
                    required
                  />
                </div>
              </div>
              
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingBudget ? 'Update' : 'Create'} Budget
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetConfiguration;
