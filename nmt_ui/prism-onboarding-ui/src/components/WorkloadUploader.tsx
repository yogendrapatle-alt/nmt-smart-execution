import React from 'react';

type WorkloadUploaderProps = {
  onWorkloadLoaded: (workload: any) => void;
};

const WorkloadUploader: React.FC<WorkloadUploaderProps> = ({ onWorkloadLoaded }) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        // Validate that the workload has the expected keys
        if (!json || typeof json !== 'object' || !json.workloads || !Array.isArray(json.workloads)) {
          alert('Invalid workload file! Must contain a top-level "workloads" array.');
          return;
        }
        onWorkloadLoaded(json);
      } catch {
        alert('Invalid workload file!');
      }
    };
    reader.readAsText(file);
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <input
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        ref={fileInputRef}
        onChange={handleFileChange}
      />
      <button
        type="button"
        onClick={handleButtonClick}
        title="Upload a previously saved workload JSON to auto-fill all fields below"
        style={{
          background: '#fff',
          color: '#0078d4',
          fontWeight: 600,
          fontSize: 15,
          border: '1px solid #0078d4',
          borderRadius: 6,
          padding: '8px 18px',
          cursor: 'pointer',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          marginLeft: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}
      >
        ⬆️ Upload Workload
      </button>
    </div>
  );
};

export default WorkloadUploader;
