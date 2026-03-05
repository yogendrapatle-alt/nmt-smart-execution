import React from 'react';
import { usePDFExport } from '../hooks/usePDFExport.tsx';
import type { Alert } from '../types/onboarding';

interface PDFExportButtonProps {
  alerts: Alert[];
  selectedDate: string;
  selectedTestbed: string;
  selectedSeverity: string;
  selectedStatus: string;
  disabled?: boolean;
}

export const PDFExportButton: React.FC<PDFExportButtonProps> = ({
  alerts,
  selectedDate,
  selectedTestbed,
  selectedSeverity,
  selectedStatus,
  disabled = false
}) => {
  const { generatePDF, isGenerating, error, clearError } = usePDFExport();

  const handleExportPDF = async () => {
    clearError();
    await generatePDF({
      alerts,
      selectedDate,
      selectedTestbed,
      selectedSeverity,
      selectedStatus
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <button
        onClick={handleExportPDF}
        disabled={disabled || isGenerating || alerts.length === 0}
        style={{
          background: disabled || isGenerating || alerts.length === 0 ? '#ccc' : '#dc3545',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          padding: '12px 24px',
          fontWeight: 600,
          cursor: disabled || isGenerating || alerts.length === 0 ? 'not-allowed' : 'pointer',
          fontSize: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}
      >
        {isGenerating ? '📄 Generating PDF...' : '📄 Export as PDF'}
      </button>
      
      {error && (
        <div style={{
          color: '#dc3545',
          fontSize: 12,
          padding: '4px 8px',
          backgroundColor: '#f8d7da',
          borderRadius: 4,
          border: '1px solid #f5c6cb',
          maxWidth: 300,
          textAlign: 'center'
        }}>
          ❌ {error}
        </div>
      )}
    </div>
  );
};