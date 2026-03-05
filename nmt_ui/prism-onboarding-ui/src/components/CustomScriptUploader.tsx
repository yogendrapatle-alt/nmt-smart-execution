import React, { useState } from 'react';

interface CustomScriptUploaderProps {
  onScriptUploaded: (script: any) => void;
  isActive: boolean;
}

interface ScriptData {
  label: string;
  json: any;
}

const CustomScriptUploader: React.FC<CustomScriptUploaderProps> = ({
  onScriptUploaded,
  isActive
}) => {
  const [uploadedScript, setUploadedScript] = useState<ScriptData | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const scriptData: ScriptData = {
          label: file.name.replace(/\.json$/i, ''),
          json
        };
        setUploadedScript(scriptData);
        onScriptUploaded(json);
      } catch (err) {
        alert('Invalid JSON file. Please upload a valid JSON script.');
      }
      // Reset input so the same file can be uploaded again if needed
      event.target.value = '';
    }
  };

  const formatJsonForPreview = (obj: any): string => {
    return JSON.stringify(obj, null, 2);
  };

  return (
    <>
      {/* Custom Script Upload Section */}
      {isActive && (
        <div
          style={{
            background: '#f8fafd',
            border: '1px solid #e0e6ef',
            borderRadius: 8,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <h4
            style={{
              margin: '0 0 16px 0',
              color: '#0078d4',
              fontWeight: 600,
              fontSize: 18,
            }}
          >
            Custom Script Upload
          </h4>
          <div
            style={{
              fontSize: 14,
              color: '#666',
              marginBottom: 16,
            }}
          >
            Upload a custom JSON script to configure your monitoring rules. When a custom script is uploaded, manual configuration options will be hidden.
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <label
              style={{
                display: 'inline-block',
                cursor: 'pointer',
                background: '#0078d4',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '10px 20px',
                fontWeight: 600,
                fontSize: 14,
                transition: 'background 0.2s',
              }}
            >
              Choose JSON File
              <input
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
            </label>

            {uploadedScript && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ color: '#28a745', fontWeight: 500, fontSize: 14 }}>
                  ✓ {uploadedScript.label}
                </span>
                <button
                  onClick={() => setShowPreview(true)}
                  title="Preview JSON"
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 4,
                    cursor: 'pointer',
                    color: '#0078d4',
                    fontSize: 20,
                    display: 'flex',
                    alignItems: 'center',
                    borderRadius: '50%',
                    transition: 'background 0.2s',
                  }}
                >
                  {/* Eye icon SVG */}
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {uploadedScript && (
            <div
              style={{
                background: '#e8f5e8',
                border: '1px solid #c3e6c3',
                borderRadius: 4,
                padding: 12,
                fontSize: 14,
                color: '#2e7d2e',
              }}
            >
              <strong>Custom script loaded!</strong> Manual configuration options are now hidden. 
              You can only use custom queries in the rule builders below.
            </div>
          )}
        </div>
      )}

      {/* JSON Preview Modal */}
      {showPreview && uploadedScript && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowPreview(false)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 8,
              padding: 24,
              maxWidth: '80vw',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, color: '#0078d4' }}>
                Preview: {uploadedScript.label}
              </h3>
              <button
                onClick={() => setShowPreview(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 24,
                  cursor: 'pointer',
                  color: '#666',
                  padding: 4,
                }}
              >
                ×
              </button>
            </div>
            <pre
              style={{
                background: '#f5f5f5',
                padding: 16,
                borderRadius: 4,
                overflow: 'auto',
                maxHeight: '60vh',
                fontSize: 12,
                fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                color: '#333',
                margin: 0,
              }}
            >
              {formatJsonForPreview(uploadedScript.json)}
            </pre>
          </div>
        </div>
      )}
    </>
  );
};

export default CustomScriptUploader;
