import { useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { AlertsPDFDocument } from '../components/PDFDocument';
import type { Alert } from '../types/onboarding';

interface UsePDFExportProps {
  alerts: Alert[];
  selectedDate: string;
  selectedTestbed: string;
  selectedSeverity: string;
  selectedStatus: string;
}

export const usePDFExport = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string>('');

  const generatePDF = async ({
    alerts,
    selectedDate,
    selectedTestbed,
    selectedSeverity,
    selectedStatus
  }: UsePDFExportProps) => {
    setIsGenerating(true);
    setError('');

    try {
        // Create the PDF document
        const doc = (
            <AlertsPDFDocument
                alerts={alerts}
                selectedDate={selectedDate}
                selectedTestbed={selectedTestbed}
                selectedSeverity={selectedSeverity}
                selectedStatus={selectedStatus}
            />
        );

      // Generate PDF blob
      const blob = await pdf(doc).toBlob();

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // Generate filename
      const dateStr = selectedDate.replace(/\-/g, '');
      const testbedStr = selectedTestbed ? `-${selectedTestbed}` : '';
      const severityStr = selectedSeverity !== 'All' ? `-${selectedSeverity}` : '';
      const statusStr = selectedStatus !== 'All' ? `-${selectedStatus}` : '';
      
      link.download = `alert-summary-${dateStr}${testbedStr}${severityStr}${statusStr}.pdf`;
      
      // Trigger download
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up
      URL.revokeObjectURL(url);

      return true;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate PDF';
      setError(errorMessage);
      console.error('PDF generation error:', err);
      return false;
    } finally {
      setIsGenerating(false);
    }
  };

  return {
    generatePDF,
    isGenerating,
    error,
    clearError: () => setError('')
  };
};