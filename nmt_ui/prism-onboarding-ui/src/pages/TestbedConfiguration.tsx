
import React, { useState, useEffect } from 'react';
import Select from 'react-select';
import { useNavigate } from 'react-router-dom';
import JSONPreviewModal from '../components/JSONPreviewModal';
import ntnxLogo from '../assets/new_nutanix_logo.png';
import { getApiBase } from '../utils/backendUrl';

const TestbedConfiguration: React.FC = () => {
  const navigate = useNavigate();

  // Dynamically import all JSON files in workload_profiles
  const envJsonModules = import.meta.glob('../workload_profiles/*.json', { eager: true });
  const [environmentFiles, setEnvironmentFiles] = useState<{ label: string; value: string; json: any }[]>([]);
  const [selectedEnv, setSelectedEnv] = useState<{ label: string; value: string; json: any } | null>(null);

  useEffect(() => {
    // Build options from imported modules
    const files = Object.entries(envJsonModules).map(([path, mod]) => {
      // Extract filename for label
      const match = path.match(/workload_profiles\/(.*)\.json$/) || path.match(/workload_profiles\/(.*)\.json$/);
      const filename = match ? match[1] : path;
      return {
        label: filename.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        value: path,
        json: (mod && typeof mod === 'object' && 'default' in mod) ? mod.default : mod
      };
    });
    setEnvironmentFiles(files);
  }, []);

  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveCompleted, setSaveCompleted] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [jitaExecuting, setJitaExecuting] = useState(false);
  const [jitaStatus, setJitaStatus] = useState<string | null>(null);

  // State for Testbed fields
  const [homePC, setHomePC] = useState({ buildUrl: '', type: '', hostPEIP: '' });
  const [remotePC, setRemotePC] = useState({ buildUrl: '', type: '', hostPEIP: '', clusterCount: '' });
  const [ncmVersion, setNcmVersion] = useState('');
  const [ncmUrl, setNcmUrl] = useState('');
  const [useNcmUrl, setUseNcmUrl] = useState(false);
  const [testbedName, setTestbedName] = useState('');

  // Output JSON generation
  const generateOutputJSON = () => {
    return {
      'Home PC': {
        'Build URL': homePC.buildUrl,
        'Type': homePC.type,
        'Host PE-IP': homePC.hostPEIP
      },
      'Remote PC': {
        'Build URL': remotePC.buildUrl,
        'Type': remotePC.type,
        'Host PE-IP': remotePC.hostPEIP,
        'Cluster Count': remotePC.clusterCount
      },
      'NCM Version': ncmVersion,
      'NCM URL': ncmUrl,
      'Testbed Name': testbedName
    };
  };

  // Download JSON utility
  const downloadJSON = (data: any, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Save testbed configuration to backend
  const handleSaveTestbed = async () => {
    try {
      const testbedData = generateOutputJSON();
      const backendUrl = getApiBase();
      const res = await fetch(
        `${backendUrl}/api/upload-testbed`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testbedData),
        }
      );
  
      if (res.ok) {
        const result = await res.json();
        console.log('Testbed saved successfully:', result.filename);
  
        localStorage.setItem('filename', result.filename);
        localStorage.setItem('testbed_filepath', result.filepath);
        localStorage.setItem('unique_testbed_id', result.unique_testbed_id);
  
        return {
          success: true,
          unique_testbed_id: result.unique_testbed_id,
          filepath: result.filepath,
        };
      } else {
        console.error('Failed to save testbed');
        return { success: false };
      }
    } catch (err) {
      console.error('Error saving testbed:', err);
      return { success: false, error: err };
    }
  };

  // Run Jita jobs
  const handleRunJitaJobs = async (filepath: string, unique_testbed_id: string) => {
    setJitaExecuting(true);
    setJitaStatus('Executing JITA jobs...');
  
    try {
      const backendUrl = getApiBase();
      const res = await fetch(`${backendUrl}/api/run-jita-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testbed_filepath: filepath, unique_testbed_id })
      });
  
      const result = await res.json();
      if (res.ok && result.success) {
        setJitaStatus('JITA jobs executed successfully!');
        return true;
      } else {
        setJitaStatus(`JITA execution failed: ${result.error || 'Unknown error'}`);
        return false;
      }
    } catch (err) {
      setJitaStatus(`Error running JITA jobs: ${err}`);
      return false;
    } finally {
      setJitaExecuting(false);
    }
  };

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
            <li className="breadcrumb-item active">Deploy New Testbed</li>
          </ol>
        </nav>
      </div>

      <div className="container-fluid">
        <div className="row justify-content-center">
          <div className="col-12 col-xl-10">
            {/* Main Card */}
            <div className="card rounded-4 shadow-none border">
              <div className="card-body p-4 p-lg-5">
                {/* Header Section */}
                <div className="text-center mb-4 mb-lg-5">
                  <div className="d-inline-flex align-items-center justify-content-center mb-3" style={{
                    width: 100,
                    height: 100,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)'
                  }}>
                    <img src={ntnxLogo} alt="Nutanix Logo" style={{ width: 60, height: 60, objectFit: 'contain' }} />
                  </div>
                  <h2 className="mb-2 fw-bold">Deploy New Testbed</h2>
                  <p className="text-muted mb-0">Configure and deploy a new NCM testbed with JITA automation</p>
                </div>

                {/* Toggle Button */}
                <div className="text-center mb-4">
                  <button
                    className={`btn ${showConfig ? 'btn-outline-primary' : 'btn-primary'} btn-lg rounded-4 px-4`}
                    onClick={() => setShowConfig((prev) => !prev)}
                  >
                    <i className="material-icons-outlined me-2" style={{ fontSize: 20, verticalAlign: 'middle' }}>
                      {showConfig ? 'visibility_off' : 'rocket_launch'}
                    </i>
                    {showConfig ? 'Hide Configuration' : 'Start Configuration'}
                  </button>
                </div>

                {/* Configuration Section */}
                {showConfig && (
                  <div className="mt-4">
                    {/* Section Header */}
                    <div className="text-center mb-4">
                      <div className="d-inline-flex align-items-center justify-content-center mb-3" style={{
                        width: 64,
                        height: 64,
                        borderRadius: 16,
                        background: 'linear-gradient(135deg, #0078d4 0%, #005a9e 100%)',
                        boxShadow: '0 2px 8px rgba(0, 120, 212, 0.3)'
                      }}>
                        <i className="material-icons-outlined text-white" style={{ fontSize: 32 }}>dns</i>
                      </div>
                      <h4 className="mb-2 fw-bold">Testbed Details</h4>
                      <p className="text-muted mb-0">Configure your Home PC, Remote PC, and NCM deployment settings</p>
                    </div>

                    {/* Home PC Card */}
                    <div className="card rounded-4 shadow-none border mb-3">
                      <div className="card-body p-4">
                        <h5 className="card-title d-flex align-items-center gap-2 mb-4">
                          <i className="material-icons-outlined text-primary" style={{ fontSize: 24 }}>home</i>
                          <span className="fw-semibold">Home PC</span>
                        </h5>
                        <div className="row g-3">
                          <div className="col-md-4">
                            <label className="form-label fw-semibold small">Build URL</label>
                            <input
                              type="text"
                              className="form-control rounded-3"
                              placeholder="Build URL"
                              value={homePC.buildUrl}
                              onChange={e => setHomePC(prev => ({ ...prev, buildUrl: e.target.value }))}
                            />
                          </div>
                          <div className="col-md-4">
                            <label className="form-label fw-semibold small">Type</label>
                            <select
                              className="form-select rounded-3"
                              value={homePC.type}
                              onChange={e => setHomePC(prev => ({ ...prev, type: e.target.value }))}
                            >
                              <option value="">Select Type</option>
                              <option value="3 Node large">3 Node large</option>
                              <option value="3 Node small">3 Node small</option>
                              <option value="1 Node large">1 Node large</option>
                              <option value="1 Node small">1 Node small</option>
                            </select>
                          </div>
                          <div className="col-md-4">
                            <label className="form-label fw-semibold small">Host PE-IP</label>
                            <input
                              type="text"
                              className="form-control rounded-3"
                              placeholder="Host PE-IP"
                              value={homePC.hostPEIP}
                              onChange={e => setHomePC(prev => ({ ...prev, hostPEIP: e.target.value }))}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Remote PC Card */}
                    <div className="card rounded-4 shadow-none border mb-3">
                      <div className="card-body p-4">
                        <h5 className="card-title d-flex align-items-center gap-2 mb-4">
                          <i className="material-icons-outlined text-primary" style={{ fontSize: 24 }}>cloud</i>
                          <span className="fw-semibold">Remote PC</span>
                        </h5>
                        <div className="row g-3">
                          <div className="col-md-3">
                            <label className="form-label fw-semibold small">Build URL</label>
                            <input
                              type="text"
                              className="form-control rounded-3"
                              placeholder="Build URL"
                              value={remotePC.buildUrl}
                              onChange={e => setRemotePC(prev => ({ ...prev, buildUrl: e.target.value }))}
                            />
                          </div>
                          <div className="col-md-3">
                            <label className="form-label fw-semibold small">Type</label>
                            <select
                              className="form-select rounded-3"
                              value={remotePC.type}
                              onChange={e => setRemotePC(prev => ({ ...prev, type: e.target.value }))}
                            >
                              <option value="">Select Type</option>
                              <option value="3 Node large">3 Node large</option>
                              <option value="3 Node small">3 Node small</option>
                              <option value="1 Node large">1 Node large</option>
                              <option value="1 Node small">1 Node small</option>
                            </select>
                          </div>
                          <div className="col-md-3">
                            <label className="form-label fw-semibold small">Host PE-IP</label>
                            <input
                              type="text"
                              className="form-control rounded-3"
                              placeholder="Host PE-IP"
                              value={remotePC.hostPEIP}
                              onChange={e => setRemotePC(prev => ({ ...prev, hostPEIP: e.target.value }))}
                            />
                          </div>
                          <div className="col-md-3">
                            <label className="form-label fw-semibold small">Cluster Count</label>
                            <input
                              type="number"
                              className="form-control rounded-3"
                              placeholder="Count"
                              min={1}
                              value={remotePC.clusterCount}
                              onChange={e => setRemotePC(prev => ({ ...prev, clusterCount: e.target.value }))}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* NCM Details Card */}
                    <div className="card rounded-4 shadow-none border mb-3">
                      <div className="card-body p-4">
                        <h5 className="card-title d-flex align-items-center gap-2 mb-4">
                          <i className="material-icons-outlined text-primary" style={{ fontSize: 24 }}>settings</i>
                          <span className="fw-semibold">NCM Details</span>
                        </h5>
                        <div className="row g-3 align-items-end">
                          {!useNcmUrl ? (
                            <>
                              <div className="col-md-8">
                                <label className="form-label fw-semibold small">NCM Version</label>
                                <select
                                  className="form-select rounded-3"
                                  value={ncmVersion}
                                  onChange={e => setNcmVersion(e.target.value)}
                                >
                                  <option value="">Select Version</option>
                                  <option value="2.0">2.0</option>
                                </select>
                              </div>
                              <div className="col-md-4">
                                <button
                                  type="button"
                                  className="btn btn-outline-primary w-100 rounded-3"
                                  onClick={() => setUseNcmUrl(true)}
                                >
                                  Use URL Instead
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="col-md-8">
                                <label className="form-label fw-semibold small">NCM Build URL</label>
                                <input
                                  type="text"
                                  className="form-control rounded-3"
                                  placeholder="NCM Build URL"
                                  value={ncmUrl}
                                  onChange={e => setNcmUrl(e.target.value)}
                                />
                              </div>
                              <div className="col-md-4">
                                <button
                                  type="button"
                                  className="btn btn-outline-primary w-100 rounded-3"
                                  onClick={() => setUseNcmUrl(false)}
                                >
                                  Use Version Instead
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Testbed Name Card */}
                    <div className="card rounded-4 shadow-none border mb-3">
                      <div className="card-body p-4">
                        <h5 className="card-title d-flex align-items-center gap-2 mb-3">
                          <i className="material-icons-outlined text-primary" style={{ fontSize: 24 }}>label</i>
                          <span className="fw-semibold">Testbed Name</span>
                        </h5>
                        <input
                          type="text"
                          className="form-control form-control-lg rounded-3"
                          placeholder="Provide a descriptive name for your Testbed..."
                          value={testbedName}
                          onChange={e => setTestbedName(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Workload Profile Card */}
                    <div className="card rounded-4 shadow-none border mb-4">
                      <div className="card-body p-4">
                        <h5 className="card-title d-flex align-items-center gap-2 mb-4">
                          <i className="material-icons-outlined text-primary" style={{ fontSize: 24 }}>work</i>
                          <span className="fw-semibold">Workload Profile</span>
                        </h5>
                        
                        {/* Upload Profile JSON */}
                        <div className="mb-3">
                          <label className="form-label fw-semibold small d-flex align-items-center gap-2">
                            <i className="material-icons-outlined text-success" style={{ fontSize: 20 }}>upload_file</i>
                            Upload Profile JSON
                          </label>
                          <label className="btn btn-outline-success rounded-3 px-4">
                            <i className="material-icons-outlined me-2" style={{ fontSize: 18, verticalAlign: 'middle' }}>attach_file</i>
                            Choose File
                            <input
                              type="file"
                              accept="application/json"
                              style={{ display: 'none' }}
                              onChange={async (e) => {
                                const file = e.target.files && e.target.files[0];
                                if (file) {
                                  try {
                                    const text = await file.text();
                                    const json = JSON.parse(text);
                                    setSelectedEnv({ label: file.name.replace(/\.json$/i, ''), value: 'uploaded', json });
                                  } catch (err) {
                                    alert('Invalid JSON file.');
                                  }
                                  e.target.value = '';
                                }
                              }}
                            />
                          </label>
                        </div>

                        <p className="text-muted small mb-3">Select predefined workload settings for your testbed</p>
                        
                        <div className="d-flex gap-2 align-items-start">
                          <div className="flex-grow-1">
                            <Select
                              options={environmentFiles}
                              value={selectedEnv}
                              onChange={setSelectedEnv}
                              placeholder="Select workload profile..."
                              isSearchable
                              styles={{
                                option: (provided: any, state: any) => ({
                                  ...provided,
                                  backgroundColor: state.isSelected
                                    ? '#0078d4'
                                    : state.isFocused
                                    ? '#e6f0fa'
                                    : '#fff',
                                  color: state.isSelected ? '#fff' : '#333',
                                  fontWeight: state.isSelected ? 600 : 400,
                                  padding: 10,
                                }),
                                control: (provided: any) => ({
                                  ...provided,
                                  borderColor: '#dee2e6',
                                  borderRadius: 12,
                                  boxShadow: 'none',
                                  fontSize: 14,
                                  minHeight: 48,
                                  '&:hover': {
                                    borderColor: '#0078d4'
                                  }
                                }),
                                singleValue: (provided: any) => ({
                                  ...provided,
                                  color: '#000',
                                }),
                              }}
                            />
                          </div>
                          <button
                            onClick={() => setPreviewOpen(true)}
                            disabled={!selectedEnv}
                            className="btn btn-outline-primary rounded-3 px-3"
                            title="Preview JSON"
                            style={{ minWidth: 48, height: 48 }}
                          >
                            <i className="material-icons-outlined" style={{ fontSize: 20 }}>visibility</i>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="d-flex flex-column gap-3 align-items-center">
                      {!saveCompleted ? (
                        <button
                          onClick={async () => {
                            if (selectedEnv) {
                              setSaveStatus(null);
                              setJitaStatus(null);
                              try {
                                const testbedSaved = await handleSaveTestbed();
                                if (!testbedSaved.success) {
                                  setSaveStatus('Failed to save testbed configuration.');
                                  return;
                                }
                                
                                const backendUrl = getApiBase();
                                await fetch(`${backendUrl}/api/save-environment`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify(selectedEnv.json)
                                });
                                
                                const jitaSuccess = await handleRunJitaJobs(testbedSaved.filepath!, testbedSaved.unique_testbed_id!);
                                if (jitaSuccess) {
                                  setSaveStatus('Environment, testbed, and JITA jobs completed successfully!');
                                  setSaveCompleted(true);
                                } else {
                                  setSaveStatus('Environment and testbed saved, but JITA job execution failed.');
                                }
                              } catch (err) {
                                setSaveStatus('Failed to complete the operation.');
                                console.error('Error in save and continue:', err);
                              }
                            }
                          }}
                          disabled={!selectedEnv || jitaExecuting}
                          className="btn btn-primary btn-lg rounded-4 px-5 w-100"
                          style={{ maxWidth: 400 }}
                        >
                          {jitaExecuting ? (
                            <>
                              <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                              Executing JITA Jobs...
                            </>
                          ) : (
                            <>
                              <i className="material-icons-outlined me-2" style={{ fontSize: 20, verticalAlign: 'middle' }}>save</i>
                              Save and Continue
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={() => navigate('/rulebuilder-experimental')}
                          className="btn btn-success btn-lg rounded-4 px-5 w-100"
                          style={{ maxWidth: 400 }}
                        >
                          <i className="material-icons-outlined me-2" style={{ fontSize: 20, verticalAlign: 'middle' }}>arrow_forward</i>
                          Continue to Rule Builder
                        </button>
                      )}
                      
                      {/* Download Output JSON Button */}
                      <button
                        type="button"
                        onClick={() => downloadJSON(generateOutputJSON(), 'testbed_config.json')}
                        className="btn btn-outline-primary rounded-4 px-4 w-100"
                        style={{ maxWidth: 400 }}
                      >
                        <i className="material-icons-outlined me-2" style={{ fontSize: 18, verticalAlign: 'middle' }}>download</i>
                        Download Output JSON
                      </button>

                      {/* Status Messages */}
                      {(saveStatus || jitaStatus) && (
                        <div className="text-center w-100" style={{ maxWidth: 400 }}>
                          {saveStatus && (
                            <div className={`alert ${saveStatus.includes('success') ? 'alert-success' : 'alert-danger'} rounded-4 mb-2`} role="alert">
                              {saveStatus}
                            </div>
                          )}
                          {jitaStatus && (
                            <div className={`alert ${
                              jitaStatus.includes('success') 
                                ? 'alert-success' 
                                : jitaStatus.includes('Executing') 
                                ? 'alert-info' 
                                : 'alert-danger'
                            } rounded-4 mb-2`} role="alert">
                              {jitaStatus}
                            </div>
                          )}
                          {saveCompleted && (
                            <button
                              onClick={() => {
                                setSaveCompleted(false);
                                setSaveStatus(null);
                                setJitaStatus(null);
                              }}
                              className="btn btn-outline-primary btn-sm rounded-3 mt-2"
                            >
                              Make Changes & Save Again
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* JSON Preview Modal */}
      <JSONPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        jsonData={selectedEnv?.json}
        title={selectedEnv ? `Preview: ${selectedEnv.label}` : 'JSON Preview'}
      />
    </div>
  );
};

export default TestbedConfiguration;
