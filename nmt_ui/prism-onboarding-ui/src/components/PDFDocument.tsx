import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { Alert } from '../types/onboarding';

// Register fonts if needed
// Font.register({
//   family: 'Roboto',
//   src: 'https://fonts.gstatic.com/s/roboto/v27/KFOmCnqEu92Fr1Mu4mxK.woff2'
// });

const styles = StyleSheet.create({
    page: {
        flexDirection: 'column',
        backgroundColor: '#ffffff',
        padding: 30,
        fontFamily: 'Helvetica'
    },
    header: {
        marginBottom: 20,
        borderBottom: '1 solid #000000',
        paddingBottom: 10
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 10
    },
    subtitle: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 5
    },
    filterInfo: {
        fontSize: 12,
        textAlign: 'center',
        color: '#666666',
        marginBottom: 5
    },
    alertsTable: {
        marginTop: 20
    },
    tableHeader: {
        flexDirection: 'row',
        backgroundColor: '#f0f0f0',
        padding: 8,
        borderBottom: '1 solid #000000',
        fontWeight: 'bold'
    },
    tableRow: {
        flexDirection: 'row',
        padding: 6,
        borderBottom: '0.5 solid #cccccc',
        minHeight: 30
    },
    tableRowEven: {
        backgroundColor: '#f9f9f9'
    },
    colTime: { width: '12%', fontSize: 10 },
    colSeverity: { width: '12%', fontSize: 10 },
    colStatus: { width: '12%', fontSize: 10 },
    colRule: { width: '20%', fontSize: 10 },
    colSummary: { width: '22%', fontSize: 10 },
    colDescription: { width: '22%', fontSize: 10 },
    severityBadge: {
        padding: 2,
        borderRadius: 2,
        color: '#ffffff',
        textAlign: 'center'
    },
    criticalBadge: { backgroundColor: '#dc3545' },
    moderateBadge: { backgroundColor: '#fd7e14' },
    lowBadge: { backgroundColor: '#28a745' },
    statusBadge: {
        padding: 2,
        borderRadius: 2,
        color: '#ffffff',
        textAlign: 'center'
    },
    activeBadge: { backgroundColor: '#dc3545' },
    pendingBadge: { backgroundColor: '#fd7e14' },
    resolvedBadge: { backgroundColor: '#28a745' },
    summary: {
        marginTop: 20,
        padding: 10,
        backgroundColor: '#f8f9fa',
        borderRadius: 4
    },
    summaryTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        marginBottom: 8
    },
    summaryText: {
        fontSize: 12,
        marginBottom: 4
    },
    footer: {
        position: 'absolute',
        bottom: 30,
        left: 30,
        right: 30,
        textAlign: 'center',
        fontSize: 10,
        color: '#666666'
    }
});

interface PDFDocumentProps {
    alerts: Alert[];
    selectedDate: string;
    selectedTestbed: string;
    selectedSeverity: string;
    selectedStatus: string;
}

export const AlertsPDFDocument: React.FC<PDFDocumentProps> = ({
    alerts,
    selectedDate,
    selectedTestbed,
    selectedSeverity,
    selectedStatus
}) => {
    const getSeverityStyle = (severity: string) => {
        switch (severity.toLowerCase()) {
            case 'critical': return [styles.severityBadge, styles.criticalBadge];
            case 'moderate': return [styles.severityBadge, styles.moderateBadge];
            case 'low': return [styles.severityBadge, styles.lowBadge];
            default: return [styles.severityBadge];
        }
    };

    const getStatusStyle = (status: string) => {
        switch (status.toLowerCase()) {
            case 'active': return [styles.statusBadge, styles.activeBadge];
            case 'pending': return [styles.statusBadge, styles.pendingBadge];
            case 'resolved': return [styles.statusBadge, styles.resolvedBadge];
            default: return [styles.statusBadge];
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    const formatTime = (timestamp: string) => {
        return new Date(timestamp).toLocaleTimeString('en-US', {
            hour12: true,
            hour: 'numeric',
            minute: '2-digit'
        });
    };

    const getSummaryStats = () => {
        const stats = {
            total: alerts.length,
            critical: alerts.filter(a => a.severity.toLowerCase() === 'critical').length,
            moderate: alerts.filter(a => a.severity.toLowerCase() === 'moderate').length,
            low: alerts.filter(a => a.severity.toLowerCase() === 'low').length,
            active: alerts.filter(a => a.status.toLowerCase() === 'active').length,
            resolved: alerts.filter(a => a.status.toLowerCase() === 'resolved').length
        };
        return stats;
    };

    const stats = getSummaryStats();

    return (
        <Document>
            <Page size="A4" style={styles.page} orientation="landscape">
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.title}>NCM Monitoring Tool - Alert Summary</Text>
                    <Text style={styles.subtitle}>
                        Date: {formatDate(selectedDate)} | Testbed: {selectedTestbed || 'All'}
                    </Text>
                    <Text style={styles.filterInfo}>
                        Filters: Severity: {selectedSeverity} | Status: {selectedStatus}
                    </Text>
                    <Text style={styles.filterInfo}>
                        Generated on: {new Date().toLocaleString()}
                    </Text>
                </View>

                {/* Summary Statistics */}
                <View style={styles.summary}>
                    <Text style={styles.summaryTitle}>Summary Statistics</Text>
                    <Text style={styles.summaryText}>Total Alerts: {stats.total}</Text>
                    <Text style={styles.summaryText}>
                        By Severity: Critical: {stats.critical} | Moderate: {stats.moderate} | Low: {stats.low}
                    </Text>
                    <Text style={styles.summaryText}>
                        By Status: Active: {stats.active} | Resolved: {stats.resolved}
                    </Text>
                </View>

                {/* Alerts Table */}
                <View style={styles.alertsTable}>
                    {/* Table Header */}
                    <View style={styles.tableHeader}>
                        <Text style={styles.colTime}>Time</Text>
                        <Text style={styles.colSeverity}>Severity</Text>
                        <Text style={styles.colStatus}>Status</Text>
                        <Text style={styles.colRule}>Alert Name</Text>
                        <Text style={styles.colSummary}>Summary</Text>
                        <Text style={styles.colDescription}>Description</Text>
                    </View>

                    {/* Table Rows */}
                    {alerts.map((alert, index) => (
                        <View
                            key={`${alert.id}-${index}`}
                            style={[
                                styles.tableRow,
                                index % 2 === 0 ? styles.tableRowEven : {}
                            ]}
                        >
                            <Text style={styles.colTime}>{formatTime(alert.timestamp)}</Text>
                            <View style={styles.colSeverity}>
                                <Text style={getSeverityStyle(alert.severity)}>
                                    {alert.severity}
                                </Text>
                            </View>
                            <View style={styles.colStatus}>
                                <Text style={getStatusStyle(alert.status)}>
                                    {alert.status}
                                </Text>
                            </View>
                            <Text style={styles.colRule}>{alert.ruleName}</Text>
                            <Text style={styles.colSummary}>{alert.summary || 'N/A'}</Text>
                            <Text style={styles.colDescription}>{alert.description}</Text>
                        </View>
                    ))}
                </View>

                {/* Footer */}
                <Text style={styles.footer}>
                    Nutanix NCM Monitoring Tool | Generated: {new Date().toLocaleDateString()}
                </Text>
            </Page>
        </Document>
    );
};