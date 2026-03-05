import React from 'react';

interface JSONPreviewModalProps {
  open: boolean;
  onClose: () => void;
  jsonData: any;
  title?: string;
}

const JSONPreviewModal: React.FC<JSONPreviewModalProps> = ({ open, onClose, jsonData, title }) => {
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      background: 'rgba(0,0,0,0.35)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 10,
        maxWidth: 700,
        width: '90vw',
        maxHeight: '80vh',
        boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: '#0078d4', fontWeight: 700 }}>{title || 'JSON Preview'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#0078d4' }}>&times;</button>
        </div>
        <div style={{
          overflowY: 'auto',
          background: '#f5f7fa',
          borderRadius: 6,
          padding: 16,
          fontFamily: 'monospace',
          fontSize: 14,
          color: '#222',
          flex: 1,
          minHeight: 200,
          maxHeight: '60vh',
        }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {JSON.stringify(jsonData, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
};

export default JSONPreviewModal;
