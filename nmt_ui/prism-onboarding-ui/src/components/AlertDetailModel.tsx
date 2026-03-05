import React from 'react';
import type { Alert } from '../types/onboarding';

interface AlertDetailModalProps {
  alert: Alert | null;
  isOpen: boolean;
  onClose: () => void;
}

export const AlertDetailModal: React.FC<AlertDetailModalProps> = ({ alert, isOpen, onClose }) => {
  if (!isOpen || !alert) return null;

  // Parse technical details from alert summary
  const parseTechnicalDetails = (summary: string) => {
    const details = {
      podName: 'N/A',
      namespace: 'N/A',
      metric: 'N/A',
      condition: 'N/A',
      pcIP: 'N/A',
      testbed: 'N/A'
    };

    try {
      // Extract PC IP: "PC IP: 10.36.199.44"
      const pcIPMatch = summary.match(/PC IP:\s*([\d.]+)/i);
      if (pcIPMatch) {
        details.pcIP = pcIPMatch[1];
      }

      // Extract Testbed: "Testbed: testing_rhel"
      const testbedMatch = summary.match(/Testbed:\s*([\w\-]+)/i);
      if (testbedMatch) {
        details.testbed = testbedMatch[1];
      }

      // Extract Alert name: "Alert name:PodCPUUsage"
      const alertNameMatch = summary.match(/Alert name:\s*([\w\-]+)/i);
      if (alertNameMatch) {
        details.metric = alertNameMatch[1];
      }

      // Extract podName, namespace, and condition from the first line
      // Pod: Pod vulcan in namespace ntnx-ncm-aiops has PodCPUUsage > 0.5 [0.57%]
      // Node: Pod Worker VM in namespace has NodeCPUUsage > 1 [10.41%]
      const firstLine = summary.split(/\n|\r|Alert name:/)[0];
      // Pod alert regex
      let podMatch = firstLine.match(/^Pod\s+([\w\-]+)\s+in\s+namespace\s+([\w\-]+)\s+has\s+(\w+)\s*([><=]+)\s*([\d.]+)\s*\[([\d.]+%)]/i);
      if (podMatch) {
        details.podName = podMatch[1];
        details.namespace = podMatch[2];
        details.metric = podMatch[3];
        details.condition = `${podMatch[4]} ${podMatch[5]} [${podMatch[6]}]`;
      } else {
        // Node alert regex
        let nodeMatch = firstLine.match(/^Pod\s+(.+?)\s+in\s+namespace\s+has\s+(\w+)\s*([><=]+)\s*([\d.]+)\s*\[([\d.]+%)]/i);
        if (nodeMatch) {
          details.podName = nodeMatch[1];
          details.namespace = 'N/A';
          details.metric = nodeMatch[2];
          details.condition = `${nodeMatch[3]} ${nodeMatch[4]} [${nodeMatch[5]}]`;
        }
      }
    } catch (error) {
      console.warn('Error parsing technical details from summary:', error);
    }

    return details;
  };

  const technicalDetails = parseTechnicalDetails(alert.summary || '');

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'Critical': return '#dc3545';
      case 'Moderate': return '#fd7e14';
      case 'Low': return '#28a745';
      default: return '#6c757d';
    }
  };

  const getStatusColor = (status: string) => {
    return status === 'Active' ? '#dc3545' : '#28a745';
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return {
      date: date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      }),
      time: date.toLocaleTimeString('en-US', { 
        hour12: true, 
        hour: 'numeric', 
        minute: '2-digit',
        second: '2-digit'
      })
    };
  };

  const { date, time } = formatTimestamp(alert.timestamp);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#fff',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
        maxWidth: 600,
        width: '90%',
        maxHeight: '80vh',
        overflow: 'auto',
        padding: 0
      }}>
        {/* Header */}
        <div style={{
          padding: '24px 24px 16px',
          borderBottom: '1px solid #e9ecef',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start'
        }}>
          <div>
            <h3 style={{ margin: 0, color: '#333', fontSize: 20, fontWeight: 600 }}>
              Alert Details
            </h3>
            <div style={{ 
              marginTop: 8,
              display: 'flex',
              gap: 8,
              alignItems: 'center'
            }}>
              <span style={{ 
                padding: '4px 8px', 
                borderRadius: 4, 
                fontSize: 12, 
                fontWeight: 600,
                color: '#fff',
                backgroundColor: getSeverityColor(alert.severity)
              }}>
                {alert.severity}
              </span>
              <span style={{ 
                padding: '4px 8px', 
                borderRadius: 4, 
                fontSize: 12, 
                fontWeight: 600,
                color: '#fff',
                backgroundColor: getStatusColor(alert.status)
              }}>
                {alert.status}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: 4,
              color: '#666'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 24 }}>
          {/* Alert Information Card */}
          <div style={{
            backgroundColor: '#f8f9fa',
            border: '1px solid #dee2e6',
            borderRadius: 8,
            padding: 20,
            marginBottom: 20
          }}>
            <div style={{ display: 'grid', gap: 16 }}>
              {/* Alert Name */}
              <div>
                <label style={{ 
                  display: 'block', 
                  marginBottom: 4, 
                  fontWeight: 600, 
                  color: '#495057',
                  fontSize: 14
                }}>
                  🏷️ Alert Name:
                </label>
                <div style={{ 
                  fontFamily: 'monospace', 
                  fontSize: 15, 
                  color: '#212529',
                  backgroundColor: '#fff',
                  padding: '8px 12px',
                  borderRadius: 4,
                  border: '1px solid #ced4da'
                }}>
                  {alert.ruleName}
                </div>
              </div>

              {/* Summary */}
              {alert.summary && (
                <div>
                  <label style={{ 
                    display: 'block', 
                    marginBottom: 4, 
                    fontWeight: 600, 
                    color: '#495057',
                    fontSize: 14
                  }}>
                    📋 Summary:
                  </label>
                  <div style={{ 
                    fontSize: 15, 
                    color: '#212529',
                    backgroundColor: '#fff',
                    padding: '8px 12px',
                    borderRadius: 4,
                    border: '1px solid #ced4da',
                    lineHeight: 1.4
                  }}>
                    {alert.summary}
                  </div>
                </div>
              )}

              {/* Description */}
              <div>
                <label style={{ 
                  display: 'block', 
                  marginBottom: 4, 
                  fontWeight: 600, 
                  color: '#495057',
                  fontSize: 14
                }}>
                  📝 Description:
                </label>
                <div style={{ 
                  fontSize: 15, 
                  color: '#212529',
                  backgroundColor: '#fff',
                  padding: '8px 12px',
                  borderRadius: 4,
                  border: '1px solid #ced4da',
                  lineHeight: 1.4
                }}>
                  {alert.description}
                </div>
              </div>

              {/* Trigger Time */}
              <div>
                <label style={{ 
                  display: 'block', 
                  marginBottom: 4, 
                  fontWeight: 600, 
                  color: '#495057',
                  fontSize: 14
                }}>
                  ⏰ Trigger Time:
                </label>
                <div style={{ 
                  fontSize: 15, 
                  color: '#212529',
                  backgroundColor: '#fff',
                  padding: '8px 12px',
                  borderRadius: 4,
                  border: '1px solid #ced4da'
                }}>
                  <div style={{ fontWeight: 500 }}>{date}</div>
                  <div style={{ color: '#6c757d', marginTop: 2 }}>{time}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Technical Details */}
          <div style={{
            backgroundColor: '#e8f4fd',
            border: '1px solid #bee5eb',
            borderRadius: 8,
            padding: 20
          }}>
            <h4 style={{ 
              margin: '0 0 16px 0', 
              color: '#0c5460',
              fontSize: 16,
              fontWeight: 600
            }}>
              🔧 Technical Details
            </h4>
            
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', 
              gap: 16 
            }}>
              <div>
                <label style={{ 
                  display: 'block', 
                  marginBottom: 4, 
                  fontWeight: 600, 
                  color: '#0c5460',
                  fontSize: 12
                }}>
                  Pod/Node Name:
                </label>
                <div style={{ 
                  fontFamily: 'monospace', 
                  fontSize: 13, 
                  color: '#212529' 
                }}>
                  {technicalDetails.podName}
                </div>
              </div>

              <div>
                <label style={{ 
                  display: 'block', 
                  marginBottom: 4, 
                  fontWeight: 600, 
                  color: '#0c5460',
                  fontSize: 12
                }}>
                  Namespace:
                </label>
                <div style={{ 
                  fontFamily: 'monospace', 
                  fontSize: 13, 
                  color: '#212529' 
                }}>
                  {technicalDetails.namespace}
                </div>
              </div>

              <div>
                <label style={{ 
                  display: 'block', 
                  marginBottom: 4, 
                  fontWeight: 600, 
                  color: '#0c5460',
                  fontSize: 12
                }}>
                  Metric:
                </label>
                <div style={{ 
                  fontFamily: 'monospace', 
                  fontSize: 13, 
                  color: '#212529' 
                }}>
                  {technicalDetails.metric}
                </div>
              </div>

              <div>
                <label style={{ 
                  display: 'block', 
                  marginBottom: 4, 
                  fontWeight: 600, 
                  color: '#0c5460',
                  fontSize: 12
                }}>
                  Condition:
                </label>
                <div style={{ 
                  fontFamily: 'monospace', 
                  fontSize: 13, 
                  color: '#212529' 
                }}>
                  {technicalDetails.condition}
                </div>
              </div>

              <div>
                <label style={{ 
                  display: 'block', 
                  marginBottom: 4, 
                  fontWeight: 600, 
                  color: '#0c5460',
                  fontSize: 12
                }}>
                  PC IP:
                </label>
                <div style={{ 
                  fontFamily: 'monospace', 
                  fontSize: 13, 
                  color: '#212529' 
                }}>
                  {technicalDetails.pcIP}
                </div>
              </div>

              <div>
                <label style={{ 
                  display: 'block', 
                  marginBottom: 4, 
                  fontWeight: 600, 
                  color: '#0c5460',
                  fontSize: 12
                }}>
                  Testbed:
                </label>
                <div style={{ 
                  fontFamily: 'monospace', 
                  fontSize: 13, 
                  color: '#212529' 
                }}>
                  {technicalDetails.testbed}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #e9ecef',
          display: 'flex',
          justifyContent: 'flex-end'
        }}>
          <button
            onClick={onClose}
            style={{
              background: '#6c757d',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '8px 16px',
              fontWeight: 500,
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
