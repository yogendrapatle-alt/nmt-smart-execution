import React from 'react';

type ConfigUploaderProps = {
  onConfigLoaded: (config: any) => void;
};

const ConfigUploader: React.FC<ConfigUploaderProps> = ({ onConfigLoaded }) => {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        // Validate that the config has a top-level Config key
        if (!json || typeof json !== 'object' || !json.Config) {
          alert('Invalid config file! Must contain a top-level "Config" key.');
          return;
        }
        console.log('[ConfigUploader] Parsed config JSON:', json);
        onConfigLoaded(json);
      } catch {
        alert('Invalid config file!');
      }
    };
    reader.readAsText(file);
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);

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
        title="Upload a previously saved config JSON to auto-fill all fields below"
        style={{
          background: 'transparent',
          color: '#0078d4',
          border: 'none',
          borderRadius: 0,
          padding: '0 12px',
          height: 54,
          fontWeight: 600,
          cursor: 'pointer',
          fontSize: 13,
          outline: 'none',
          transition: 'background 0.2s',
        }}
      >
        Upload Config
      </button>
    </div>
  );
};

export default ConfigUploader;
