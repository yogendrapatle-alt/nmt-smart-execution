import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ntnxLogo from '../assets/new_nutanix_logo.png';
import { IS_FAKE_MODE } from '../config/fakeMode';
import { getFakeTestbeds, getFakeExecutions, getFakeExecutionById } from '../fake-data';
import { getApiBase } from '../utils/backendUrl';

interface Testbed {
  id: number;
  unique_testbed_id: string;
  testbed_label: string;
  pc_ip: string | null;
  ncm_ip: string | null;
  uuid: string | null;
}

interface EntityOperation {
  count: number;
  interval?: number;
}

interface EntityConfig {
  entity: string;
  operations: {
    create: EntityOperation;
    update: EntityOperation;
    delete: EntityOperation;
    execute?: EntityOperation;
    launch?: EntityOperation;
    run?: EntityOperation;
    plays?: EntityOperation;
    resend?: EntityOperation;
    trigger?: EntityOperation;
  };
}

interface WorkloadConfig {
  name: string;
  entities: EntityConfig[];
  duration: number;
  parallel: number;
  distribution: string;
}

interface ExecutionStatus {
  success: boolean;
  execution_id: string;
  status: string;
  progress: number;
  stats: {
    total_operations: number;
    completed_operations: number;
    successful_operations: number;
    failed_operations: number;
    pending_operations: number;
    progress_percentage: number;
  };
  duration_minutes?: number;
  estimated_end?: string;
  last_error?: string;
}

interface ExecutionHistoryItem {
  execution_id: string;
  testbed_id: string;
  status: string;
  progress: number;
  start_time: string;
  end_time?: string;
  completed_operations: number;
  total_operations: number;
}

const ExecutionWorkloadManager: React.FC = () => {
  const navigate = useNavigate();
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // State
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [selectedTestbed, setSelectedTestbed] = useState<string>('');
  
  // Workload Configuration
  const [workloadConfig, setWorkloadConfig] = useState<WorkloadConfig>({
    name: '',
    entities: [
      {
        entity: 'vm',
        operations: {
          create: { count: 1, interval: 60 },
          update: { count: 0, interval: 60 },
          delete: { count: 0, interval: 60 },
          execute: { count: 0, interval: 60 }
        }
      }
    ],
    duration: 5,
    parallel: 1,
    distribution: 'LINEAR'
  });
  
  // Execution State
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  
  // Execution History
  const [executionHistory, setExecutionHistory] = useState<ExecutionHistoryItem[]>([]);
  const [testbedNameMap, setTestbedNameMap] = useState<Record<string, string>>({});
  const [deletingExecution, setDeletingExecution] = useState<string | null>(null);
  
  // UI State
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [expandedEntities, setExpandedEntities] = useState<Set<number>>(new Set([0])); // First entity expanded by default
  const [testbedSearchTerm, setTestbedSearchTerm] = useState<string>('');

  // Fetch testbeds on mount
  useEffect(() => {
    fetchTestbeds();
    fetchExecutionHistory();
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const fetchTestbeds = async () => {
    try {
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const data = getFakeTestbeds();
        setTestbeds(data.testbeds || []);
        
        const nameMap: Record<string, string> = {};
        (data.testbeds || []).forEach((tb: Testbed) => {
          nameMap[tb.unique_testbed_id] = tb.testbed_label;
        });
        setTestbedNameMap(nameMap);
        return;
      }

      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/get-testbeds`);
      const data = await response.json();
      
      if (data.success) {
        setTestbeds(data.testbeds || []);
        
        const nameMap: Record<string, string> = {};
        (data.testbeds || []).forEach((tb: Testbed) => {
          nameMap[tb.unique_testbed_id] = tb.testbed_label;
        });
        setTestbedNameMap(nameMap);
      }
    } catch (error) {
      console.error('Error fetching testbeds:', error);
    }
  };

  const fetchExecutionHistory = async () => {
    try {
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const data = getFakeExecutions(50);
        setExecutionHistory(data.executions || []);
        return;
      }

      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/executions?limit=10`);
      const data = await response.json();
      
      if (data.success) {
        setExecutionHistory(data.executions || []);
      }
    } catch (error) {
      console.error('Error fetching execution history:', error);
    }
  };

  const calculateTotalOperations = () => {
    return workloadConfig.entities.reduce((sum, entity) => {
      return sum + 
        entity.operations.create.count + 
        entity.operations.update.count + 
        entity.operations.delete.count +
        (entity.operations.execute?.count || 0) +
        (entity.operations.launch?.count || 0) +
        (entity.operations.run?.count || 0) +
        (entity.operations.plays?.count || 0) +
        (entity.operations.resend?.count || 0) +
        (entity.operations.trigger?.count || 0);
    }, 0);
  };

  const handleStartExecution = async () => {
    if (!selectedTestbed) {
      showError('Please select a testbed');
      return;
    }
    
    if (!workloadConfig.name.trim()) {
      showError('Please enter a workload name');
      return;
    }
    
    const totalOps = calculateTotalOperations();
    if (totalOps === 0) {
      showError('Please configure at least one operation');
      return;
    }
    
    setLoading(true);
    
    try {
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 800));
        const fakeExecs = getFakeExecutions();
        const runningExecution = fakeExecs.executions.find(ex => ex.status === 'RUNNING' && ex.testbed_id === selectedTestbed);
        
        if (runningExecution) {
          setExecutionId(runningExecution.execution_id);
          setIsExecuting(true);
          showSuccess(`Execution started (DEMO): ${runningExecution.execution_id}`);
          startStatusPolling(runningExecution.execution_id);
        } else {
          showError('No running demo execution available for this testbed');
        }
        setLoading(false);
        return;
      }

      const backendUrl = getApiBase();
      
      const transformedConfig = {
        ...workloadConfig,
        entities: workloadConfig.entities.map(entity => ({
          type: entity.entity,
          operations: {
            create: entity.operations.create?.count || 0,
            update: entity.operations.update?.count || 0,
            delete: entity.operations.delete?.count || 0,
            execute: entity.operations.execute?.count || 0,
            launch: entity.operations.launch?.count || 0,
            run: entity.operations.run?.count || 0,
            plays: entity.operations.plays?.count || 0,
            resend: entity.operations.resend?.count || 0,
            trigger: entity.operations.trigger?.count || 0
          }
        }))
      };
      
      const response = await fetch(`${backendUrl}/api/start-execution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unique_testbed_id: selectedTestbed,
          testbed_filepath: `/workloads/${workloadConfig.name}.json`,
          total_operations: totalOps,
          workload_type: 'custom',
          config: transformedConfig
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        setExecutionId(result.execution_id);
        setIsExecuting(true);
        showSuccess(`Execution started: ${result.execution_id}`);
        startStatusPolling(result.execution_id);
      } else {
        showError(result.error || 'Failed to start execution');
      }
    } catch (error) {
      console.error('Error starting execution:', error);
      showError('Failed to start execution');
    } finally {
      setLoading(false);
    }
  };

  const startStatusPolling = (execId: string) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    
    fetchExecutionStatus(execId);
    
    pollIntervalRef.current = setInterval(() => {
      fetchExecutionStatus(execId);
    }, 2000);
  };

  const fetchExecutionStatus = async (execId: string) => {
    try {
      if (IS_FAKE_MODE) {
        const statusData = getFakeExecutionById(execId);
        setExecutionStatus(statusData as ExecutionStatus);
        
        if (statusData.status && ['COMPLETED', 'FAILED', 'STOPPED', 'ERROR'].includes(statusData.status)) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setIsExecuting(false);
          fetchExecutionHistory();
        }
        return;
      }

      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/execution-status/${execId}`);
      const status = await response.json();
      
      setExecutionStatus(status);
      
      if (status.status && ['COMPLETED', 'FAILED', 'STOPPED', 'ERROR'].includes(status.status)) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setIsExecuting(false);
        fetchExecutionHistory();
      }
    } catch (error) {
      console.error('Error fetching execution status:', error);
    }
  };

  const handleStopExecution = async () => {
    if (!executionId) return;
    
    try {
      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/stop-execution/${executionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'User requested stop' })
      });
      
      const result = await response.json();
      if (result.success) {
        showSuccess('Execution stopped');
      }
    } catch (error) {
      console.error('Error stopping execution:', error);
      showError('Failed to stop execution');
    }
  };

  const handleDeleteExecution = async (execId: string) => {
    if (!confirm(`Are you sure you want to delete execution ${execId}?\n\nThis will permanently remove the execution record and all associated operation metrics.`)) {
      return;
    }
    
    setDeletingExecution(execId);
    
    try {
      if (IS_FAKE_MODE) {
        await new Promise(resolve => setTimeout(resolve, 500));
        setExecutionHistory(executionHistory.filter(ex => ex.execution_id !== execId));
        showSuccess(`Execution deleted (DEMO mode)`);
        setDeletingExecution(null);
        return;
      }

      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/delete-execution/${execId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const result = await response.json();
      
      if (result.success) {
        showSuccess(`Execution deleted (${result.operations_deleted || 0} operations removed)`);
        fetchExecutionHistory();
      } else {
        showError(result.error || 'Failed to delete execution');
      }
    } catch (error) {
      showError('Failed to delete execution');
      console.error('Error deleting execution:', error);
    } finally {
      setDeletingExecution(null);
    }
  };

  const handlePauseExecution = async () => {
    if (!executionId) return;
    
    try {
      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/pause-execution/${executionId}`, {
        method: 'POST'
      });
      
      const result = await response.json();
      if (result.success) {
        showSuccess('Execution paused');
      }
    } catch (error) {
      console.error('Error pausing execution:', error);
      showError('Failed to pause execution');
    }
  };

  const handleResumeExecution = async () => {
    if (!executionId) return;
    
    try {
      const backendUrl = getApiBase();
      const response = await fetch(`${backendUrl}/api/resume-execution/${executionId}`, {
        method: 'POST'
      });
      
      const result = await response.json();
      if (result.success) {
        showSuccess('Execution resumed');
      }
    } catch (error) {
      console.error('Error resuming execution:', error);
      showError('Failed to resume execution');
    }
  };

  const addEntity = () => {
    const newIndex = workloadConfig.entities.length;
    setWorkloadConfig({
      ...workloadConfig,
      entities: [
        ...workloadConfig.entities,
        {
          entity: 'vm',
          operations: {
            create: { count: 0, interval: 60 },
            update: { count: 0, interval: 60 },
            delete: { count: 0, interval: 60 },
            execute: { count: 0, interval: 60 }
          }
        }
      ]
    });
    // Expand the newly added entity
    setExpandedEntities(new Set([...expandedEntities, newIndex]));
  };

  const toggleEntity = (index: number) => {
    const newExpanded = new Set(expandedEntities);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedEntities(newExpanded);
  };

  const removeEntity = (index: number) => {
    const newEntities = workloadConfig.entities.filter((_, i) => i !== index);
    setWorkloadConfig({ ...workloadConfig, entities: newEntities });
    
    // Update expanded entities indices
    const newExpanded = new Set<number>();
    expandedEntities.forEach(idx => {
      if (idx < index) {
        newExpanded.add(idx);
      } else if (idx > index) {
        newExpanded.add(idx - 1);
      }
    });
    setExpandedEntities(newExpanded);
  };

  const updateEntityType = (index: number, entityType: string) => {
    const newEntities = [...workloadConfig.entities];
    newEntities[index].entity = entityType;
    setWorkloadConfig({ ...workloadConfig, entities: newEntities });
  };

  const updateOperation = (entityIndex: number, opType: 'create' | 'update' | 'delete' | 'execute' | 'launch' | 'run' | 'plays' | 'resend' | 'trigger', field: 'count' | 'interval', value: number) => {
    const newEntities = [...workloadConfig.entities];
    
    if (!newEntities[entityIndex].operations[opType]) {
      newEntities[entityIndex].operations[opType] = { count: 0, interval: 60 };
    }
    
    newEntities[entityIndex].operations[opType]![field] = value;
    setWorkloadConfig({ ...workloadConfig, entities: newEntities });
  };

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setErrorMessage('');
    setTimeout(() => setSuccessMessage(''), 5000);
  };

  const showError = (message: string) => {
    setErrorMessage(message);
    setSuccessMessage('');
    setTimeout(() => setErrorMessage(''), 5000);
  };

  const getStatusColor = (status: string) => {
    const colors: { [key: string]: string } = {
      'PENDING': '#6c757d',
      'STARTING': '#17a2b8',
      'RUNNING': '#007bff',
      'PAUSED': '#ffc107',
      'STOPPING': '#fd7e14',
      'STOPPED': '#6c757d',
      'COMPLETED': '#28a745',
      'FAILED': '#dc3545',
      'ERROR': '#dc3545'
    };
    return colors[status] || '#6c757d';
  };

  const calculateDuration = (exec: ExecutionHistoryItem) => {
    if (!exec.start_time) return 'N/A';
    const start = new Date(exec.start_time);
    const end = exec.end_time ? new Date(exec.end_time) : new Date();
    const diff = end.getTime() - start.getTime();
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  const selectedTestbedData = testbeds.find(tb => tb.unique_testbed_id === selectedTestbed);

  return (
    <div className="main-content">
      {/* Breadcrumb */}
      <div className="d-flex align-items-center mb-4">
        <nav aria-label="breadcrumb">
          <ol className="breadcrumb mb-0">
            <li className="breadcrumb-item">
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }}>
                <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle' }}>home</i>
              </a>
            </li>
            <li className="breadcrumb-item active">Execution Workload Manager</li>
          </ol>
        </nav>
      </div>

      {/* Page Header */}
      <div className="mb-4">
        <h2 className="fw-bold mb-2 d-flex align-items-center gap-2">
          <i className="material-icons-outlined text-primary" style={{ fontSize: 32 }}>trending_up</i>
          Execution Workload Manager
        </h2>
        <p className="text-muted mb-0">Configure and execute load generation workloads on your testbeds</p>
      </div>

      {/* Messages */}
      {successMessage && (
        <div className="alert alert-success alert-dismissible fade show rounded-4 d-flex align-items-center mb-4" role="alert">
          <i className="material-icons-outlined me-2">check_circle</i>
          <div className="flex-grow-1">{successMessage}</div>
          <button type="button" className="btn-close" onClick={() => setSuccessMessage('')} aria-label="Close"></button>
        </div>
      )}
      
      {errorMessage && (
        <div className="alert alert-danger alert-dismissible fade show rounded-4 d-flex align-items-center mb-4" role="alert">
          <i className="material-icons-outlined me-2">error_outline</i>
          <div className="flex-grow-1">{errorMessage}</div>
          <button type="button" className="btn-close" onClick={() => setErrorMessage('')} aria-label="Close"></button>
        </div>
      )}

      <div className="container-fluid">
        <div className="row">
          <div className="col-12">
            {/* Testbed Selection Card - Compact */}
            <div className="card rounded-4 shadow-none border mb-4">
              <div className="card-body p-4">
                <h5 className="card-title d-flex align-items-center gap-2 mb-3">
                  <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                    width: 40,
                    height: 40,
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                  }}>
                    <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>dns</i>
                  </div>
                  <span className="fw-semibold">Select Testbed</span>
                </h5>
                
                {testbeds.length === 0 ? (
                  <div className="text-center py-3">
                    <i className="material-icons-outlined text-muted" style={{ fontSize: 48 }}>inbox</i>
                    <p className="text-muted mt-2 mb-0">No testbeds available. Please deploy a testbed first.</p>
                  </div>
                ) : (
                  <div>
                    {/* Search Input */}
                    {testbeds.length > 5 && (
                      <div className="mb-3">
                        <div className="position-relative">
                          <i className="material-icons-outlined position-absolute translate-middle-y" style={{ left: 12, top: '50%', fontSize: 20, color: '#6c757d' }}>search</i>
                          <input
                            type="text"
                            className="form-control rounded-3 ps-5"
                            placeholder="Search testbeds..."
                            value={testbedSearchTerm}
                            onChange={(e) => setTestbedSearchTerm(e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                    
                    {/* Compact Select Dropdown */}
                    <select
                      value={selectedTestbed}
                      onChange={(e) => setSelectedTestbed(e.target.value)}
                      disabled={isExecuting}
                      className="form-select form-select-lg rounded-3"
                    >
                      <option value="">-- Select a Testbed --</option>
                      {testbeds
                        .filter(tb => 
                          !testbedSearchTerm || 
                          tb.testbed_label.toLowerCase().includes(testbedSearchTerm.toLowerCase()) ||
                          tb.ncm_ip?.toLowerCase().includes(testbedSearchTerm.toLowerCase()) ||
                          tb.pc_ip?.toLowerCase().includes(testbedSearchTerm.toLowerCase())
                        )
                        .map(tb => (
                          <option key={tb.unique_testbed_id} value={tb.unique_testbed_id}>
                            {tb.testbed_label} {tb.ncm_ip ? `(NCM: ${tb.ncm_ip})` : ''} {tb.pc_ip ? `(PC: ${tb.pc_ip})` : ''}
                          </option>
                        ))}
                    </select>
                    
                    {/* Selected Testbed Details */}
                    {selectedTestbedData && (
                      <div className="mt-3 p-3 bg-light rounded-3 border">
                        <div className="d-flex align-items-center gap-2 mb-2">
                          <i className="material-icons-outlined text-primary" style={{ fontSize: 20 }}>info</i>
                          <strong className="small">Selected Testbed Details</strong>
                        </div>
                        <div className="small">
                          <div className="d-flex align-items-center gap-2 mb-1">
                            <i className="material-icons-outlined" style={{ fontSize: 16 }}>label</i>
                            <span><strong>Name:</strong> {selectedTestbedData.testbed_label}</span>
                          </div>
                          {selectedTestbedData.ncm_ip && (
                            <div className="d-flex align-items-center gap-2 mb-1">
                              <i className="material-icons-outlined" style={{ fontSize: 16 }}>cloud</i>
                              <span><strong>NCM IP:</strong> {selectedTestbedData.ncm_ip}</span>
                            </div>
                          )}
                          {selectedTestbedData.pc_ip && (
                            <div className="d-flex align-items-center gap-2">
                              <i className="material-icons-outlined" style={{ fontSize: 16 }}>computer</i>
                              <span><strong>PC IP:</strong> {selectedTestbedData.pc_ip}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Workload Configuration */}
            {selectedTestbed && !isExecuting && (
              <div className="card rounded-4 shadow-none border mb-4">
                <div className="card-body p-4">
                  <h5 className="card-title d-flex align-items-center gap-2 mb-4">
                    <div className="d-inline-flex align-items-center justify-content-center rounded-3" style={{
                      width: 40,
                      height: 40,
                      background: 'linear-gradient(135deg, #0078d4 0%, #005a9e 100%)'
                    }}>
                      <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>settings</i>
                    </div>
                    <span className="fw-semibold">Configure Workload</span>
                  </h5>

                  {/* Workload Name */}
                  <div className="mb-4">
                    <label className="form-label fw-semibold mb-2">
                      <i className="material-icons-outlined me-1" style={{ fontSize: 18, verticalAlign: 'middle' }}>label</i>
                      Workload Name
                    </label>
                    <input
                      type="text"
                      className="form-control form-control-lg rounded-3"
                      placeholder="Enter a descriptive name for this workload"
                      value={workloadConfig.name}
                      onChange={(e) => setWorkloadConfig({ ...workloadConfig, name: e.target.value })}
                    />
                  </div>

                  {/* Entities Configuration - Collapsible Accordion */}
                  <div className="mb-4">
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <label className="form-label fw-semibold mb-0">
                        <i className="material-icons-outlined me-1" style={{ fontSize: 18, verticalAlign: 'middle' }}>category</i>
                        Entities & Operations
                        <span className="badge bg-primary ms-2">{workloadConfig.entities.length}</span>
                      </label>
                      <button
                        onClick={addEntity}
                        className="btn btn-success btn-sm rounded-3"
                      >
                        <i className="material-icons-outlined me-1" style={{ fontSize: 18, verticalAlign: 'middle' }}>add</i>
                        Add Entity
                      </button>
                    </div>

                    <div className="accordion" id="entitiesAccordion">
                      {workloadConfig.entities.map((entity, idx) => {
                        const isExpanded = expandedEntities.has(idx);
                        const totalOps = entity.operations.create.count + 
                                        entity.operations.update.count + 
                                        entity.operations.delete.count +
                                        (entity.operations.execute?.count || 0);
                        
                        return (
                          <div key={idx} className="accordion-item rounded-4 mb-2 border">
                            <h2 className="accordion-header" id={`heading${idx}`}>
                              <button
                                className={`accordion-button ${isExpanded ? '' : 'collapsed'} rounded-4`}
                                type="button"
                                onClick={() => toggleEntity(idx)}
                                aria-expanded={isExpanded}
                                aria-controls={`collapse${idx}`}
                              >
                                <div className="d-flex align-items-center justify-content-between w-100 me-3">
                                  <div className="d-flex align-items-center gap-3">
                                    <select
                                      className="form-select form-select-sm rounded-3"
                                      value={entity.entity}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        updateEntityType(idx, e.target.value);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      style={{ width: 200 }}
                                    >
                                      <optgroup label="Infrastructure">
                                        <option value="vm">VM</option>
                                        <option value="image">Image</option>
                                        <option value="subnet">Subnet</option>
                                        <option value="cluster">Cluster</option>
                                        <option value="user">User</option>
                                      </optgroup>
                                      <optgroup label="Self-Service (Calm)">
                                        <option value="project">Project</option>
                                        <option value="blueprint">Blueprint</option>
                                        <option value="application">Application</option>
                                        <option value="endpoint">Endpoint</option>
                                        <option value="runbook">Runbook</option>
                                        <option value="library_variable">Library Variable</option>
                                        <option value="marketplace_item">Marketplace Item</option>
                                      </optgroup>
                                      <optgroup label="AIOps">
                                        <option value="playbook">Playbook</option>
                                        <option value="uda_policy">UDA Policy</option>
                                        <option value="alert">Alert</option>
                                        <option value="analysis_session">Analysis Session</option>
                                        <option value="scenario">Scenario</option>
                                      </optgroup>
                                      <optgroup label="Reporting">
                                        <option value="report_config">Report Config</option>
                                        <option value="report_instance">Report Instance</option>
                                      </optgroup>
                                      <optgroup label="Cloud Governance">
                                        <option value="business_unit">Business Unit</option>
                                        <option value="cost_center">Cost Center</option>
                                        <option value="budget">Budget</option>
                                        <option value="tco_direct_cost">TCO Direct Cost</option>
                                        <option value="tco_indirect_cost">TCO Indirect Cost</option>
                                        <option value="rate_card">Rate Card</option>
                                      </optgroup>
                                      <optgroup label="System">
                                        <option value="directory_service">Directory Service</option>
                                      </optgroup>
                                    </select>
                                    <div className="d-flex align-items-center gap-2">
                                      {totalOps > 0 ? (
                                        <>
                                          {entity.operations.create.count > 0 && (
                                            <span className="badge bg-success rounded-pill small">+{entity.operations.create.count}</span>
                                          )}
                                          {entity.operations.update.count > 0 && (
                                            <span className="badge bg-primary rounded-pill small">↻{entity.operations.update.count}</span>
                                          )}
                                          {entity.operations.delete.count > 0 && (
                                            <span className="badge bg-danger rounded-pill small">×{entity.operations.delete.count}</span>
                                          )}
                                          {(entity.operations.execute?.count || 0) > 0 && (
                                            <span className="badge bg-warning rounded-pill small">▶{(entity.operations.execute?.count || 0)}</span>
                                          )}
                                        </>
                                      ) : (
                                        <span className="badge bg-secondary rounded-pill small">No ops</span>
                                      )}
                                    </div>
                                  </div>
                                  {workloadConfig.entities.length > 1 && (
                                    <button
                                      className="btn btn-outline-danger btn-sm rounded-3"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        removeEntity(idx);
                                      }}
                                    >
                                      <i className="material-icons-outlined" style={{ fontSize: 18 }}>delete</i>
                                    </button>
                                  )}
                                </div>
                              </button>
                            </h2>
                            <div
                              id={`collapse${idx}`}
                              className={`accordion-collapse collapse ${isExpanded ? 'show' : ''}`}
                              aria-labelledby={`heading${idx}`}
                              data-bs-parent="#entitiesAccordion"
                            >
                              <div className="accordion-body">
                                {/* Operations Grid */}
                                <div className="row g-3">
                                  <div className="col-md-3">
                                    <div className="card rounded-3 shadow-none border border-success">
                                      <div className="card-body p-3">
                                        <label className="form-label fw-semibold small text-success mb-2">
                                          <i className="material-icons-outlined me-1" style={{ fontSize: 16, verticalAlign: 'middle' }}>add_circle</i>
                                          Create
                                        </label>
                                        <input
                                          type="number"
                                          className="form-control rounded-3"
                                          min="0"
                                          placeholder="Count"
                                          value={entity.operations.create.count}
                                          onChange={(e) => updateOperation(idx, 'create', 'count', parseInt(e.target.value) || 0)}
                                        />
                                      </div>
                                    </div>
                                  </div>

                                  <div className="col-md-3">
                                    <div className="card rounded-3 shadow-none border border-primary">
                                      <div className="card-body p-3">
                                        <label className="form-label fw-semibold small text-primary mb-2">
                                          <i className="material-icons-outlined me-1" style={{ fontSize: 16, verticalAlign: 'middle' }}>edit</i>
                                          Update
                                        </label>
                                        <input
                                          type="number"
                                          className="form-control rounded-3"
                                          min="0"
                                          placeholder="Count"
                                          value={entity.operations.update.count}
                                          onChange={(e) => updateOperation(idx, 'update', 'count', parseInt(e.target.value) || 0)}
                                        />
                                      </div>
                                    </div>
                                  </div>

                                  <div className="col-md-3">
                                    <div className="card rounded-3 shadow-none border border-danger">
                                      <div className="card-body p-3">
                                        <label className="form-label fw-semibold small text-danger mb-2">
                                          <i className="material-icons-outlined me-1" style={{ fontSize: 16, verticalAlign: 'middle' }}>delete</i>
                                          Delete
                                        </label>
                                        <input
                                          type="number"
                                          className="form-control rounded-3"
                                          min="0"
                                          placeholder="Count"
                                          value={entity.operations.delete.count}
                                          onChange={(e) => updateOperation(idx, 'delete', 'count', parseInt(e.target.value) || 0)}
                                        />
                                      </div>
                                    </div>
                                  </div>

                                  <div className="col-md-3">
                                    <div className="card rounded-3 shadow-none border border-warning">
                                      <div className="card-body p-3">
                                        <label className="form-label fw-semibold small text-warning mb-2">
                                          <i className="material-icons-outlined me-1" style={{ fontSize: 16, verticalAlign: 'middle' }}>play_arrow</i>
                                          Execute
                                        </label>
                                        <input
                                          type="number"
                                          className="form-control rounded-3"
                                          min="0"
                                          placeholder="Count"
                                          value={entity.operations.execute?.count || 0}
                                          onChange={(e) => updateOperation(idx, 'execute', 'count', parseInt(e.target.value) || 0)}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Execution Parameters */}
                  <div className="row g-3 mb-4">
                    <div className="col-md-4">
                      <label className="form-label fw-semibold mb-2">
                        <i className="material-icons-outlined me-1" style={{ fontSize: 18, verticalAlign: 'middle' }}>schedule</i>
                        Duration (minutes)
                      </label>
                      <input
                        type="number"
                        className="form-control rounded-3"
                        min="1"
                        value={workloadConfig.duration}
                        onChange={(e) => setWorkloadConfig({ ...workloadConfig, duration: parseInt(e.target.value) || 60 })}
                      />
                    </div>

                    <div className="col-md-4">
                      <label className="form-label fw-semibold mb-2">
                        <i className="material-icons-outlined me-1" style={{ fontSize: 18, verticalAlign: 'middle' }}>speed</i>
                        Parallel Operations
                      </label>
                      <input
                        type="number"
                        className="form-control rounded-3"
                        min="1"
                        value={workloadConfig.parallel}
                        onChange={(e) => setWorkloadConfig({ ...workloadConfig, parallel: parseInt(e.target.value) || 5 })}
                      />
                    </div>

                    <div className="col-md-4">
                      <label className="form-label fw-semibold mb-2">
                        <i className="material-icons-outlined me-1" style={{ fontSize: 18, verticalAlign: 'middle' }}>timeline</i>
                        Distribution
                      </label>
                      <select
                        className="form-select rounded-3"
                        value={workloadConfig.distribution}
                        onChange={(e) => setWorkloadConfig({ ...workloadConfig, distribution: e.target.value })}
                      >
                        <option value="LINEAR">Linear</option>
                        <option value="BURST">Burst</option>
                        <option value="RANDOM">Random</option>
                      </select>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="alert alert-info rounded-4 mb-4 d-flex align-items-center" role="alert">
                    <i className="material-icons-outlined me-2" style={{ fontSize: 24 }}>info</i>
                    <div>
                      <strong>Summary:</strong> Total <strong>{calculateTotalOperations()}</strong> operations will be executed over <strong>{workloadConfig.duration}</strong> minutes
                    </div>
                  </div>

                  {/* Start Button */}
                  <button
                    onClick={handleStartExecution}
                    disabled={loading}
                    className="btn btn-primary btn-lg rounded-4 w-100"
                  >
                    {loading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                        Starting Execution...
                      </>
                    ) : (
                      <>
                        <i className="material-icons-outlined me-2" style={{ fontSize: 20, verticalAlign: 'middle' }}>rocket_launch</i>
                        Start Execution
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Execution Control & Progress */}
            {isExecuting && executionStatus && (
              <div className="card rounded-4 shadow-none border mb-4">
                <div className="card-body p-4">
                  <h5 className="card-title d-flex align-items-center gap-2 mb-4">
                    <div className="d-inline-flex align-items-center justify-content-center rounded-3 bg-success" style={{ width: 40, height: 40 }}>
                      <i className="material-icons-outlined text-white" style={{ fontSize: 20 }}>play_circle</i>
                    </div>
                    <span className="fw-semibold">Execution in Progress</span>
                  </h5>

                  {/* Execution Info */}
                  <div className="row g-3 mb-4">
                    <div className="col-md-6">
                      <div className="card rounded-3 shadow-none border bg-light">
                        <div className="card-body p-3">
                          <label className="form-label small text-muted mb-1">Execution ID</label>
                          <div className="font-monospace small">{executionId}</div>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="card rounded-3 shadow-none border bg-light">
                        <div className="card-body p-3">
                          <label className="form-label small text-muted mb-1">Status</label>
                          <div>
                            <span
                              className="badge rounded-pill px-3 py-2"
                              style={{
                                backgroundColor: getStatusColor(executionStatus.status),
                                color: 'white',
                                fontSize: '0.875rem'
                              }}
                            >
                              {executionStatus.status}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-4">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span className="fw-semibold">Progress</span>
                      <span className="fw-bold">{(executionStatus.progress || 0).toFixed(1)}%</span>
                    </div>
                    <div className="progress rounded-4" style={{ height: 32 }}>
                      <div
                        className="progress-bar progress-bar-striped progress-bar-animated"
                        role="progressbar"
                        style={{
                          width: `${executionStatus.progress || 0}%`,
                          backgroundColor: '#007bff'
                        }}
                      >
                        {(executionStatus.progress || 0) > 10 && `${(executionStatus.progress || 0).toFixed(1)}%`}
                      </div>
                    </div>
                  </div>

                  {/* Operation Stats */}
                  <div className="row g-3 mb-4">
                    {[
                      { label: 'Total', value: executionStatus.stats?.total_operations || 0, color: '#6c757d', icon: 'list' },
                      { label: 'Completed', value: executionStatus.stats?.completed_operations || 0, color: '#17a2b8', icon: 'check_circle' },
                      { label: 'Successful', value: executionStatus.stats?.successful_operations || 0, color: '#28a745', icon: 'done' },
                      { label: 'Failed', value: executionStatus.stats?.failed_operations || 0, color: '#dc3545', icon: 'error' },
                      { label: 'Pending', value: executionStatus.stats?.pending_operations || 0, color: '#ffc107', icon: 'schedule' }
                    ].map((stat, idx) => (
                      <div key={idx} className="col-md-4 col-lg">
                        <div className="card rounded-3 shadow-none border" style={{ borderLeft: `4px solid ${stat.color}` }}>
                          <div className="card-body p-3 text-center">
                            <div className="d-flex align-items-center justify-content-center gap-2 mb-2">
                              <i className="material-icons-outlined" style={{ fontSize: 20, color: stat.color }}>{stat.icon}</i>
                              <div className="h4 mb-0 fw-bold" style={{ color: stat.color }}>
                                {stat.value}
                              </div>
                            </div>
                            <div className="small text-muted">{stat.label}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Control Buttons */}
                  <div className="d-flex gap-2 mb-3">
                    {executionStatus.status === 'RUNNING' && (
                      <button
                        onClick={handlePauseExecution}
                        className="btn btn-warning rounded-4 flex-fill"
                      >
                        <i className="material-icons-outlined me-2" style={{ fontSize: 18, verticalAlign: 'middle' }}>pause</i>
                        Pause
                      </button>
                    )}
                    {executionStatus.status === 'PAUSED' && (
                      <button
                        onClick={handleResumeExecution}
                        className="btn btn-success rounded-4 flex-fill"
                      >
                        <i className="material-icons-outlined me-2" style={{ fontSize: 18, verticalAlign: 'middle' }}>play_arrow</i>
                        Resume
                      </button>
                    )}
                    <button
                      onClick={handleStopExecution}
                      className="btn btn-danger rounded-4 flex-fill"
                    >
                      <i className="material-icons-outlined me-2" style={{ fontSize: 18, verticalAlign: 'middle' }}>stop</i>
                      Stop
                    </button>
                  </div>

                  {/* Duration & Estimated End */}
                  {executionStatus.duration_minutes != null && (
                    <div className="card rounded-3 shadow-none border bg-light">
                      <div className="card-body p-3">
                        <div className="small">
                          <strong>Duration:</strong> {executionStatus.duration_minutes.toFixed(1)} minutes
                        </div>
                        {executionStatus.estimated_end && (
                          <div className="small mt-1">
                            <strong>Estimated End:</strong> {new Date(executionStatus.estimated_end).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Error Display */}
                  {executionStatus.last_error && (
                    <div className="alert alert-danger rounded-4 mt-3" role="alert">
                      <i className="material-icons-outlined me-2">error</i>
                      <strong>Error:</strong> {executionStatus.last_error}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Execution History */}
            <div className="card rounded-4 shadow-none border">
              <div className="card-body p-4">
                <div className="d-flex justify-content-between align-items-center mb-4">
                  <h5 className="card-title mb-0 d-flex align-items-center gap-2">
                    <i className="material-icons-outlined text-primary" style={{ fontSize: 24 }}>history</i>
                    <span className="fw-semibold">Execution History</span>
                  </h5>
                  <button
                    onClick={fetchExecutionHistory}
                    className="btn btn-outline-secondary btn-sm rounded-3"
                  >
                    <i className="material-icons-outlined me-1" style={{ fontSize: 18, verticalAlign: 'middle' }}>refresh</i>
                    Refresh
                  </button>
                </div>

                {executionHistory.length === 0 ? (
                  <div className="text-center py-5">
                    <i className="material-icons-outlined text-muted" style={{ fontSize: 64 }}>inbox</i>
                    <p className="text-muted mt-3 mb-0">No execution history yet</p>
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover align-middle">
                      <thead>
                        <tr>
                          <th>Execution ID</th>
                          <th>Testbed</th>
                          <th className="text-center">Status</th>
                          <th className="text-center">Progress</th>
                          <th className="text-center">Operations</th>
                          <th>Start Time</th>
                          <th className="text-center">Duration</th>
                          <th className="text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {executionHistory.map(exec => (
                          <tr key={exec.execution_id}>
                            <td>
                              <code className="small">{exec.execution_id.substring(0, 20)}...</code>
                            </td>
                            <td>
                              <div className="fw-semibold">{testbedNameMap[exec.testbed_id] || 'Unknown'}</div>
                              <code className="small text-muted">{exec.testbed_id ? exec.testbed_id.substring(0, 8) + '...' : 'N/A'}</code>
                            </td>
                            <td className="text-center">
                              <span
                                className="badge rounded-pill px-3"
                                style={{
                                  backgroundColor: getStatusColor(exec.status),
                                  color: 'white'
                                }}
                              >
                                {exec.status}
                              </span>
                            </td>
                            <td className="text-center">{exec.progress}%</td>
                            <td className="text-center">
                              <span className="fw-semibold">{exec.completed_operations}</span>
                              <span className="text-muted">/{exec.total_operations}</span>
                            </td>
                            <td>{new Date(exec.start_time).toLocaleString()}</td>
                            <td className="text-center">{calculateDuration(exec)}</td>
                            <td className="text-center">
                              <button
                                className="btn btn-sm btn-outline-danger rounded-3"
                                onClick={() => handleDeleteExecution(exec.execution_id)}
                                disabled={deletingExecution === exec.execution_id}
                                title="Delete Execution"
                              >
                                {deletingExecution === exec.execution_id ? (
                                  <span className="spinner-border spinner-border-sm" role="status"></span>
                                ) : (
                                  <i className="material-icons-outlined" style={{ fontSize: 18 }}>delete</i>
                                )}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExecutionWorkloadManager;
