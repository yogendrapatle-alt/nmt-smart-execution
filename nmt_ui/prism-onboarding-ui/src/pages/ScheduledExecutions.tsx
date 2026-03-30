/**
 * Scheduled Executions Management Page
 * 
 * Features:
 * - List all scheduled executions
 * - Create new schedules
 * - Edit existing schedules
 * - Pause/Resume schedules
 * - Delete schedules
 * - View execution history
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/ScheduledExecutions.css';
import { getApiBase } from '../utils/backendUrl';

interface Schedule {
  id: number;
  schedule_id: string;
  name: string;
  description?: string;
  schedule_type: string;
  schedule_config: any;
  next_run_time?: string;
  last_run_time?: string;
  testbed_id: string;
  is_active: boolean;
  is_paused: boolean;
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  created_at: string;
}

interface Testbed {
  unique_testbed_id: string;
  testbed_label: string;
  pc_ip: string;
}

const ScheduledExecutions: React.FC = () => {
  const navigate = useNavigate();
  
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  
  // Modal states
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  
  // Form states
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    schedule_type: 'interval',
    interval_type: 'hours',
    interval_value: '24',
    cron_hour: '2',
    cron_minute: '0',
    testbed_id: '',
    cpu_threshold: '80',
    memory_threshold: '75',
    notify_on_completion: false,
    notify_on_failure: true
  });

  useEffect(() => {
    fetchSchedules();
    fetchTestbeds();
  }, []);

  const fetchSchedules = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/scheduled-executions');
      const data = await response.json();
      
      if (data.success) {
        setSchedules(data.schedules);
      } else {
        setError(data.error || 'Failed to fetch schedules');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchTestbeds = async () => {
    try {
      const response = await fetch(`${getApiBase()}/api/get-testbeds`);
      const data = await response.json();
      
      if (data.success && data.testbeds) {
        setTestbeds(data.testbeds);
      }
    } catch (err: any) {
      console.error('Error fetching testbeds:', err);
    }
  };

  const handleCreateSchedule = () => {
    setEditingSchedule(null);
    setFormData({
      name: '',
      description: '',
      schedule_type: 'interval',
      interval_type: 'hours',
      interval_value: '24',
      cron_hour: '2',
      cron_minute: '0',
      testbed_id: testbeds[0]?.unique_testbed_id || '',
      cpu_threshold: '80',
      memory_threshold: '75',
      notify_on_completion: false,
      notify_on_failure: true
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      // Build schedule configuration
      let schedule_config: any = {};
      
      if (formData.schedule_type === 'interval') {
        schedule_config = {
          interval_type: formData.interval_type,
          interval_value: parseInt(formData.interval_value)
        };
      } else if (formData.schedule_type === 'cron') {
        schedule_config = {
          hour: parseInt(formData.cron_hour),
          minute: parseInt(formData.cron_minute)
        };
      }
      
      const payload = {
        name: formData.name,
        description: formData.description,
        schedule_type: formData.schedule_type,
        schedule_config: schedule_config,
        testbed_id: formData.testbed_id,
        target_config: {
          cpu_threshold: parseInt(formData.cpu_threshold),
          memory_threshold: parseInt(formData.memory_threshold),
          stop_condition: 'any'
        },
        entities_config: {
          vm: ['CREATE', 'DELETE'],
          blueprint_multi_vm: ['EXECUTE']
        },
        ai_settings: {
          enable_ai: true,
          enable_ml: true,
          data_collection: true
        },
        notify_on_completion: formData.notify_on_completion,
        notify_on_failure: formData.notify_on_failure
      };
      
      const url = editingSchedule 
        ? `/api/scheduled-executions/${editingSchedule.schedule_id}`
        : '/api/scheduled-executions';
      
      const method = editingSchedule ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (data.success) {
        setShowModal(false);
        fetchSchedules();
        alert(editingSchedule ? 'Schedule updated successfully!' : 'Schedule created successfully!');
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handlePauseResume = async (schedule: Schedule) => {
    try {
      const action = schedule.is_paused ? 'resume' : 'pause';
      const response = await fetch(`/api/scheduled-executions/${schedule.schedule_id}/${action}`, {
        method: 'POST'
      });
      
      const data = await response.json();
      
      if (data.success) {
        fetchSchedules();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleDelete = async (schedule: Schedule) => {
    if (!confirm(`Are you sure you want to delete "${schedule.name}"?`)) {
      return;
    }
    
    try {
      const response = await fetch(`/api/scheduled-executions/${schedule.schedule_id}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.success) {
        fetchSchedules();
        alert('Schedule deleted successfully');
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const formatDateTime = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  };

  const getScheduleDescription = (schedule: Schedule) => {
    const config = schedule.schedule_config;
    
    if (schedule.schedule_type === 'interval') {
      return `Every ${config.interval_value} ${config.interval_type}`;
    } else if (schedule.schedule_type === 'cron') {
      return `Daily at ${String(config.hour).padStart(2, '0')}:${String(config.minute).padStart(2, '0')}`;
    }
    return schedule.schedule_type;
  };

  if (loading) {
    return (
      <div className="scheduled-executions-page">
        <div className="loading">Loading schedules...</div>
      </div>
    );
  }

  return (
    <div className="scheduled-executions-page">
      {/* Header */}
      <div className="page-header">
        <div className="header-left">
          <h1>🕐 Scheduled Executions</h1>
          <p>Automate AI executions with flexible scheduling</p>
        </div>
        <div className="header-right">
          <button onClick={handleCreateSchedule} className="btn-primary">
            ➕ New Schedule
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">{error}</div>
      )}

      {/* Schedules List */}
      <div className="schedules-container">
        {schedules.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🕐</div>
            <h3>No Scheduled Executions</h3>
            <p>Create your first schedule to automate AI executions</p>
            <button onClick={handleCreateSchedule} className="btn-primary">
              Create Schedule
            </button>
          </div>
        ) : (
          <div className="schedules-grid">
            {schedules.map((schedule) => (
              <div key={schedule.schedule_id} className={`schedule-card ${!schedule.is_active ? 'inactive' : schedule.is_paused ? 'paused' : ''}`}>
                <div className="card-header">
                  <div>
                    <h3>{schedule.name}</h3>
                    <p className="schedule-description">{getScheduleDescription(schedule)}</p>
                  </div>
                  <div className="status-badges">
                    {!schedule.is_active && <span className="badge badge-inactive">Inactive</span>}
                    {schedule.is_paused && <span className="badge badge-paused">Paused</span>}
                    {schedule.is_active && !schedule.is_paused && <span className="badge badge-active">Active</span>}
                  </div>
                </div>

                {schedule.description && (
                  <p className="card-description">{schedule.description}</p>
                )}

                <div className="card-stats">
                  <div className="stat-item">
                    <span className="stat-label">Testbed</span>
                    <span className="stat-value">{schedule.testbed_id.substring(0, 12)}...</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Total Runs</span>
                    <span className="stat-value">{schedule.total_executions}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Success Rate</span>
                    <span className="stat-value">
                      {schedule.total_executions > 0 
                        ? `${Math.round((schedule.successful_executions / schedule.total_executions) * 100)}%`
                        : 'N/A'}
                    </span>
                  </div>
                </div>

                <div className="card-times">
                  <div className="time-item">
                    <span className="time-label">Next Run:</span>
                    <span className="time-value">{formatDateTime(schedule.next_run_time)}</span>
                  </div>
                  <div className="time-item">
                    <span className="time-label">Last Run:</span>
                    <span className="time-value">{formatDateTime(schedule.last_run_time)}</span>
                  </div>
                </div>

                <div className="card-actions">
                  <button 
                    onClick={() => handlePauseResume(schedule)}
                    className="btn-secondary btn-sm"
                    disabled={!schedule.is_active}
                  >
                    {schedule.is_paused ? '▶️ Resume' : '⏸️ Pause'}
                  </button>
                  <button 
                    onClick={() => navigate(`/scheduled-executions/${schedule.schedule_id}/history`)}
                    className="btn-secondary btn-sm"
                  >
                    📊 History
                  </button>
                  <button 
                    onClick={() => handleDelete(schedule)}
                    className="btn-danger btn-sm"
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingSchedule ? 'Edit Schedule' : 'Create New Schedule'}</h2>
              <button onClick={() => setShowModal(false)} className="modal-close">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="schedule-form">
              {/* Basic Info */}
              <div className="form-section">
                <h3>Basic Information</h3>
                
                <div className="form-group">
                  <label>Schedule Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    placeholder="e.g., Nightly Load Test"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    placeholder="Optional description"
                    rows={2}
                  />
                </div>

                <div className="form-group">
                  <label>Testbed *</label>
                  <select
                    value={formData.testbed_id}
                    onChange={(e) => setFormData({...formData, testbed_id: e.target.value})}
                    required
                  >
                    <option value="">Select Testbed</option>
                    {testbeds.map((tb) => (
                      <option key={tb.unique_testbed_id} value={tb.unique_testbed_id}>
                        {tb.testbed_label} ({tb.pc_ip})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Schedule Configuration */}
              <div className="form-section">
                <h3>Schedule Configuration</h3>
                
                <div className="form-group">
                  <label>Schedule Type *</label>
                  <select
                    value={formData.schedule_type}
                    onChange={(e) => setFormData({...formData, schedule_type: e.target.value})}
                  >
                    <option value="interval">Recurring Interval</option>
                    <option value="cron">Daily (Cron)</option>
                  </select>
                </div>

                {formData.schedule_type === 'interval' && (
                  <div className="form-row">
                    <div className="form-group">
                      <label>Interval Value *</label>
                      <input
                        type="number"
                        value={formData.interval_value}
                        onChange={(e) => setFormData({...formData, interval_value: e.target.value})}
                        min="1"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Interval Unit *</label>
                      <select
                        value={formData.interval_type}
                        onChange={(e) => setFormData({...formData, interval_type: e.target.value})}
                      >
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                      </select>
                    </div>
                  </div>
                )}

                {formData.schedule_type === 'cron' && (
                  <div className="form-row">
                    <div className="form-group">
                      <label>Hour (0-23) *</label>
                      <input
                        type="number"
                        value={formData.cron_hour}
                        onChange={(e) => setFormData({...formData, cron_hour: e.target.value})}
                        min="0"
                        max="23"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Minute (0-59) *</label>
                      <input
                        type="number"
                        value={formData.cron_minute}
                        onChange={(e) => setFormData({...formData, cron_minute: e.target.value})}
                        min="0"
                        max="59"
                        required
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Target Configuration */}
              <div className="form-section">
                <h3>Target Thresholds</h3>
                
                <div className="form-row">
                  <div className="form-group">
                    <label>CPU Threshold (%) *</label>
                    <input
                      type="number"
                      value={formData.cpu_threshold}
                      onChange={(e) => setFormData({...formData, cpu_threshold: e.target.value})}
                      min="1"
                      max="100"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Memory Threshold (%) *</label>
                    <input
                      type="number"
                      value={formData.memory_threshold}
                      onChange={(e) => setFormData({...formData, memory_threshold: e.target.value})}
                      min="1"
                      max="100"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Notifications */}
              <div className="form-section">
                <h3>Notifications</h3>
                
                <div className="form-checkbox">
                  <input
                    type="checkbox"
                    id="notify_completion"
                    checked={formData.notify_on_completion}
                    onChange={(e) => setFormData({...formData, notify_on_completion: e.target.checked})}
                  />
                  <label htmlFor="notify_completion">Notify on completion</label>
                </div>

                <div className="form-checkbox">
                  <input
                    type="checkbox"
                    id="notify_failure"
                    checked={formData.notify_on_failure}
                    onChange={(e) => setFormData({...formData, notify_on_failure: e.target.checked})}
                  />
                  <label htmlFor="notify_failure">Notify on failure</label>
                </div>
              </div>

              {/* Actions */}
              <div className="modal-actions">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingSchedule ? 'Update Schedule' : 'Create Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduledExecutions;
