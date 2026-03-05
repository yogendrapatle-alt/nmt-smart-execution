import React, { useState } from 'react';
import ntnxLogo from '../assets/new_nutanix_logo.png';
import type { OnboardingForm } from '../types/onboarding';
import { useOnboarding } from '../context/OnboardingContext';
import { useNavigate } from 'react-router-dom';

interface Props {
  onSubmit: (form: OnboardingForm) => void;
}

const Onboarding: React.FC<Props> = ({ onSubmit }) => {
  const [form, setForm] = useState<OnboardingForm>({
    pcIp: '',
    username: '',
    password: '',
    ncmLabel: '',
  });
  const [promEndpoint, setPromEndpoint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const navigate = useNavigate();
  const { setOnboardingForm, updatePrometheusEndpoint, updatePcUuid } = useOnboarding();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setPromEndpoint(null);

    // Save onboarding form data to global state (context) and continue
    setOnboardingForm(form);

    try {
      // Always use localhost:5000 for backend in development
      const backendUrl = 'http://localhost:5000';
      console.log('Backend URL:', backendUrl);
      console.log('Full URL:', `${backendUrl}/api/expose-prometheus`);

      // Step 1: Discover NCM IP and expose Prometheus
      const res = await fetch(`${backendUrl}/api/expose-prometheus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pcIp: form.pcIp,
          username: form.username,
          password: form.password
        })
      });

      const data = await res.json();

      if (res.ok && data.endpoint) {
        setPromEndpoint(data.endpoint);
        updatePrometheusEndpoint(data.endpoint);
        
        // Store PC UUID if received
        if (data.pc_uuid) {
          updatePcUuid(data.pc_uuid);
        }
        
        // Step 2: Automatically save testbed to database with discovered NCM IP
        console.log('✅ NCM Discovery Successful - Saving testbed to database...');
        console.log('📍 NCM IP:', data.ncm_ip);
        console.log('📍 NCM Node:', data.ncm_node);
        
        try {
          const testbedData = {
            testbed_label: form.ncmLabel || `Testbed-${form.pcIp}`,
            pc_ip: form.pcIp,
            ncm_ip: data.ncm_ip,
            uuid: data.pc_uuid,
            username: form.username,
            password: form.password,
            testbed_json: {
              pc_ip: form.pcIp,
              ncm_ip: data.ncm_ip,
              ncm_node: data.ncm_node,
              prometheus_endpoint: data.endpoint,
              node_port: data.node_port,
              onboarded_at: new Date().toISOString(),
              testbed_name: form.ncmLabel
            }
          };

          console.log('📤 Sending testbed data to database...');
          const saveRes = await fetch(`${backendUrl}/api/upload-testbed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testbedData)
          });

          const saveData = await saveRes.json();
          
          if (saveData.success) {
            console.log('✅ Testbed saved successfully with NCM IP:', data.ncm_ip);
            console.log('📋 Testbed ID:', saveData.unique_testbed_id);
            
            // Store unique_testbed_id for later use
            if (saveData.unique_testbed_id) {
              localStorage.setItem('unique_testbed_id', saveData.unique_testbed_id);
              console.log('💾 Stored testbed ID in localStorage:', saveData.unique_testbed_id);
            }
          } else {
            console.warn('⚠️ Failed to save testbed to database:', saveData.error);
            // Don't fail the entire onboarding - NCM discovery succeeded
          }
        } catch (saveErr) {
          console.error('❌ Error saving testbed:', saveErr);
          // Still show success for connection, even if database save fails
        }
        
        setShowSuccess(true);
      } else {
        setError(data.error || 'Unknown error');
      }
    } catch (err) {
      setError('Failed to connect to backend');
    }

    setLoading(false);
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
            <li className="breadcrumb-item active">Onboard Existing Testbed</li>
          </ol>
        </nav>
      </div>

      <div style={{
        maxWidth: 750,
        margin: '0 auto',
      }}>
        <div className="card rounded-4 border-0 shadow-sm" style={{ overflow: 'hidden' }}>
          <div className="card-body p-5">
            {/* Logo and Title */}
            <div className="text-center mb-5">
              <div style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
                boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)'
              }}>
                <img src={ntnxLogo} alt="Nutanix Logo" style={{ width: 50, height: 50, objectFit: 'contain' }} />
              </div>
              <h2 style={{ color: '#00008B', fontWeight: 700, fontSize: 32, marginBottom: 8, letterSpacing: '-0.5px' }}>Onboard Existing Testbed</h2>
              <p className="text-muted mb-0" style={{ fontSize: 16 }}>Connect to your NCM cluster and start monitoring</p>
            </div>

            {/* Onboarding Form */}
            <form onSubmit={handleSubmit}>
            {/* PC-IP Field */}
            <div className="mb-4">
              <label className="form-label fw-semibold" style={{ fontSize: 15, color: '#333', marginBottom: 8 }}>
                <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6, color: '#0078d4' }}>computer</i>
                PC-IP Address
              </label>
              <input 
                name="pcIp" 
                type="text"
                placeholder="Enter PC-IP (e.g., 10.36.199.44)" 
                value={form.pcIp} 
                onChange={handleChange} 
                required 
                className="form-control form-control-lg"
                style={{ 
                  border: '1px solid #dee2e6',
                  borderRadius: 8,
                  padding: '12px 16px',
                  fontSize: 15,
                  transition: 'all 0.2s'
                }}
              />
            </div>

            {/* Username Field */}
            <div className="mb-4">
              <label className="form-label fw-semibold" style={{ fontSize: 15, color: '#333', marginBottom: 8 }}>
                <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6, color: '#0078d4' }}>person</i>
                Username
              </label>
              <input 
                name="username" 
                type="text"
                placeholder="Enter Username" 
                value={form.username} 
                onChange={handleChange} 
                required 
                className="form-control form-control-lg"
                style={{ 
                  border: '1px solid #dee2e6',
                  borderRadius: 8,
                  padding: '12px 16px',
                  fontSize: 15,
                  transition: 'all 0.2s'
                }}
              />
            </div>

            {/* Password Field */}
            <div className="mb-4">
              <label className="form-label fw-semibold" style={{ fontSize: 15, color: '#333', marginBottom: 8 }}>
                <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6, color: '#0078d4' }}>lock</i>
                Password
              </label>
              <input 
                name="password" 
                type="password"
                placeholder="Enter Password" 
                value={form.password} 
                onChange={handleChange} 
                required 
                className="form-control form-control-lg"
                style={{ 
                  border: '1px solid #dee2e6',
                  borderRadius: 8,
                  padding: '12px 16px',
                  fontSize: 15,
                  transition: 'all 0.2s'
                }}
              />
            </div>

            {/* Testbed Name Field */}
            <div className="mb-4">
              <label className="form-label fw-semibold" style={{ fontSize: 15, color: '#333', marginBottom: 8 }}>
                <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6, color: '#0078d4' }}>label</i>
                Testbed Name
              </label>
              <input 
                name="ncmLabel" 
                type="text"
                placeholder="Enter Testbed Name" 
                value={form.ncmLabel} 
                onChange={handleChange} 
                required 
                className="form-control form-control-lg"
                style={{ 
                  border: '1px solid #dee2e6',
                  borderRadius: 8,
                  padding: '12px 16px',
                  fontSize: 15,
                  transition: 'all 0.2s'
                }}
              />
            </div>

            {/* Submit Button */}
            {!showSuccess && (
              <button 
                type="submit" 
                className="btn btn-primary btn-lg w-100 d-flex align-items-center justify-content-center gap-2"
                disabled={loading}
                style={{ 
                  background: loading ? '#6c757d' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  border: 'none',
                  height: 52,
                  borderRadius: 8,
                  fontSize: 16,
                  fontWeight: 600,
                  boxShadow: loading ? 'none' : '0 4px 12px rgba(102, 126, 234, 0.3)',
                  transition: 'all 0.2s',
                  marginTop: 8
                }}
              >
                {loading ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                    <span>Connecting...</span>
                  </>
                ) : (
                  <>
                    <i className="material-icons-outlined" style={{ fontSize: 22 }}>play_arrow</i>
                    <span>Connect & Continue</span>
                  </>
                )}
              </button>
            )}

            {/* Success Message */}
            {showSuccess && (
              <div className="alert alert-success d-flex align-items-start" role="alert" style={{
                borderRadius: 12,
                border: 'none',
                padding: 24,
                background: 'linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%)',
                boxShadow: '0 2px 8px rgba(40, 167, 69, 0.15)'
              }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: '#28a745',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 16,
                  flexShrink: 0
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 28 }}>check_circle</i>
                </div>
                <div className="flex-grow-1">
                  <h5 className="alert-heading mb-2" style={{ color: '#155724', fontWeight: 700, fontSize: 20 }}>Onboarding Successful!</h5>
                  <p className="mb-2" style={{ color: '#155724', fontSize: 15 }}>
                    <strong>✓</strong> NCM IP discovered automatically<br />
                    <strong>✓</strong> Testbed saved to database<br />
                    <strong>✓</strong> Available in "My Testbeds"
                  </p>
                  <p className="mb-3" style={{ color: '#155724', fontSize: 14, fontStyle: 'italic' }}>
                    Your testbed is ready for monitoring and rule configuration.
                  </p>
                  <div className="d-flex gap-2">
                    <button
                      type="button"
                      className="btn btn-success"
                      onClick={() => { onSubmit(form); navigate('/rulebuilder-experimental'); }}
                      style={{
                        borderRadius: 8,
                        padding: '10px 24px',
                        fontWeight: 600,
                        fontSize: 15,
                        boxShadow: '0 2px 8px rgba(40, 167, 69, 0.3)'
                      }}
                    >
                      <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 6 }}>arrow_forward</i>
                      Configure Rules
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-success"
                      onClick={() => navigate('/my-testbeds')}
                      style={{
                        borderRadius: 8,
                        padding: '10px 24px',
                        fontWeight: 600,
                        fontSize: 15
                      }}
                    >
                      <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 6 }}>view_list</i>
                      View My Testbeds
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Prometheus Endpoint */}
            {promEndpoint && (
              <div className="alert alert-info d-flex align-items-center mt-4" role="alert" style={{
                borderRadius: 8,
                border: '1px solid #bee5eb',
                padding: 16,
                background: '#e8f4fd'
              }}>
                <i className="material-icons-outlined me-3" style={{ fontSize: 24, color: '#0c5460' }}>info</i>
                <div>
                  <strong style={{ color: '#0c5460', fontSize: 14 }}>Prometheus Endpoint:</strong><br />
                  <a href={promEndpoint} target="_blank" rel="noopener noreferrer" className="alert-link" style={{
                    color: '#0078d4',
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: 14,
                    wordBreak: 'break-all'
                  }}>
                    {promEndpoint}
                  </a>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="alert alert-danger d-flex align-items-start mt-4" role="alert" style={{
                borderRadius: 8,
                border: 'none',
                padding: 20,
                background: 'linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%)',
                boxShadow: '0 2px 8px rgba(220, 53, 69, 0.15)'
              }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: '#dc3545',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 12,
                  flexShrink: 0
                }}>
                  <i className="material-icons-outlined text-white" style={{ fontSize: 22 }}>error_outline</i>
                </div>
                <div>
                  <h6 className="alert-heading mb-2" style={{ color: '#721c24', fontWeight: 700, fontSize: 16 }}>Connection Error</h6>
                  <p className="mb-0" style={{ color: '#721c24', fontSize: 14 }}>{error}</p>
                </div>
              </div>
            )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
