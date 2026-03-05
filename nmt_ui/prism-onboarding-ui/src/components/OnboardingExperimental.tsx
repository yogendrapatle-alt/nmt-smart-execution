import React, { useState } from 'react';
import ntnxLogo from '../assets/ntnx_logo.png';
// import { saveAs } from 'file-saver';
import type { OnboardingForm } from '../types/onboarding';
import { useOnboarding } from '../context/OnboardingContext';
import { useNavigate } from 'react-router-dom';

interface Props {
  onSubmit: (form: OnboardingForm) => void;
}

const OnboardingExperimental: React.FC<Props> = ({ onSubmit }) => {
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
  const { setOnboardingForm, updatePrometheusEndpoint } = useOnboarding();

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
      
      const res = await fetch(`${backendUrl}/api/expose-prometheus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          pcIp: form.pcIp,
          username: form.username,    // FIXED: Added username parameter (was missing, causing "Failed to connect to backend")
          password: form.password     // FIXED: Added password parameter (was missing, causing "Failed to connect to backend")
        })
      });

      const data = await res.json();

      if (res.ok && data.endpoint) {
        setPromEndpoint(data.endpoint);
        updatePrometheusEndpoint(data.endpoint);  // UPDATE PROMETHEUS ENDPOINT
        setShowSuccess(true);
        // Do not auto-redirect. Wait for user action.
        // onSubmit(form); // Optionally call this if you want to save state
      } else {
        setError(data.error || 'Unknown error');
      }
    } catch (err) {
      setError('Failed to connect to backend');
    }

    setLoading(false);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 0px',
    border: '1px solid #ccc',
    borderRadius: 4,
    fontSize: 14,
    marginTop: 4,
    backgroundColor: '#fff', // makes the input field white
    color: '#000' // ensures the text inside is black
  };


  const labelStyle: React.CSSProperties = {
    color: '#333',
    fontWeight: 500,
    display: 'block',
    marginBottom: 4
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
            <li className="breadcrumb-item active">Onboard Testbed</li>
          </ol>
        </nav>
      </div>

      <div style={{
        maxWidth: 700,
        margin: '0 auto',
      }}>
      <form onSubmit={handleSubmit} className="card rounded-4 border-0 shadow-sm" style={{
        padding: 32,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src={ntnxLogo} alt="Nutanix Logo" style={{ width: 100, margin: '0 auto 16px', display: 'block' }} />
          <h2 style={{ color: '#00008B', fontWeight: 700, fontSize: 28, marginBottom: 8 }}>Onboard Testbed</h2>
          <p className="text-muted mb-0">Experimental Onboarding Flow</p>
        </div>

        {/* PC-IP Field */}
        <div className="mb-3">
          <label className="form-label fw-semibold">
            <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>computer</i>
            PC-IP
          </label>
          <input 
            name="pcIp" 
            placeholder="Enter PC-IP (e.g., 10.36.199.44)" 
            value={form.pcIp} 
            onChange={handleChange} 
            required 
            className="form-control form-control-lg"
          />
        </div>

        {/* Username Field */}
        <div className="mb-3">
          <label className="form-label fw-semibold">
            <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>person</i>
            Username
          </label>
          <input 
            name="username" 
            placeholder="Enter Username" 
            value={form.username} 
            onChange={handleChange} 
            required 
            className="form-control form-control-lg"
          />
        </div>

        {/* Password Field */}
        <div className="mb-3">
          <label className="form-label fw-semibold">
            <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>lock</i>
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
          />
        </div>

        {/* Testbed Name Field */}
        <div className="mb-3">
          <label className="form-label fw-semibold">
            <i className="material-icons-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>label</i>
            Testbed Name
          </label>
          <input 
            name="ncmLabel" 
            placeholder="Enter Testbed Name" 
            value={form.ncmLabel} 
            onChange={handleChange} 
            required 
            className="form-control form-control-lg"
          />
        </div>

        {/* Section 3: Prometheus Endpoint
        <div>
          <h4 style={{ marginBottom: 8, color: '#444' }}>NCM-Prometheus Endpoint</h4>
          <p style={{ fontSize: 14, color: '#777', marginBottom: 8 }}>
            This will be automatically exposed after connection.
          </p>
        </div> */}

        {/* Advanced Options removed */}

        {/* Submit Button */}
        {!showSuccess && (
          <button 
            type="submit" 
            className="btn btn-primary btn-lg w-100 mt-3"
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {loading && <span className="spinner-border spinner-border-sm" role="status"></span>}
            <span>{loading ? 'Connecting...' : 'Continue'}</span>
          </button>
        )}

        {/* Success Message */}
        {showSuccess && (
          <div className="alert alert-success d-flex align-items-start mt-3" role="alert">
            <i className="material-icons-outlined me-3" style={{ fontSize: 32, color: '#28a745' }}>check_circle</i>
            <div className="flex-grow-1">
              <h5 className="alert-heading">Onboarding Successful!</h5>
              <p className="mb-3">Your testbed has been connected successfully.</p>
              <button
                type="button"
                className="btn btn-success"
                onClick={() => { onSubmit(form); navigate('/rulebuilder-experimental'); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <i className="material-icons-outlined" style={{ fontSize: 18 }}>arrow_forward</i>
                <span>Proceed to Rule Builder</span>
              </button>
            </div>
          </div>
        )}
        
        {/* Prometheus Endpoint */}
        {promEndpoint && (
          <div className="alert alert-info mt-3" role="alert">
            <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 8 }}>link</i>
            <strong>Prometheus Endpoint:</strong>{' '}
            <a href={promEndpoint} target="_blank" rel="noopener noreferrer" className="alert-link">
              {promEndpoint}
            </a>
          </div>
        )}
        {error && (
          <div className="alert alert-danger mt-3" role="alert">
            <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 8 }}>error_outline</i>
            Error: {error}
          </div>
        )}
      </form>
      </div>
    </div>
  );
};

export default OnboardingExperimental;
