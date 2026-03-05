-- Migration: Add comprehensive metrics tracking
-- Purpose: Store Prometheus metrics, entity operation timeline, and pod-level metrics
-- Date: 2026-01-28

-- 1. Add metrics column to executions table
ALTER TABLE executions ADD COLUMN IF NOT EXISTS metrics JSONB;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS prometheus_url VARCHAR(512);

-- 2. Create operation_metrics table for entity-level tracking
CREATE TABLE IF NOT EXISTS operation_metrics (
    id SERIAL PRIMARY KEY,
    execution_id VARCHAR(255) NOT NULL,
    testbed_id VARCHAR(128),
    entity_type VARCHAR(100) NOT NULL,
    operation_type VARCHAR(50) NOT NULL,
    entity_name VARCHAR(255),
    entity_uuid VARCHAR(255),
    
    -- Timestamps
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_seconds FLOAT,
    
    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'RUNNING',
    error_message TEXT,
    
    -- Metrics snapshot at operation time
    metrics_snapshot JSONB,
    
    -- Pod-level metrics
    pod_cpu_percent FLOAT,
    pod_memory_mb FLOAT,
    pod_network_rx_mbps FLOAT,
    pod_network_tx_mbps FLOAT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign keys
    FOREIGN KEY (execution_id) REFERENCES executions(execution_id) ON DELETE CASCADE,
    FOREIGN KEY (testbed_id) REFERENCES testbeds(unique_testbed_id) ON DELETE SET NULL
);

-- 3. Create metrics_history table for continuous monitoring
CREATE TABLE IF NOT EXISTS metrics_history (
    id SERIAL PRIMARY KEY,
    testbed_id VARCHAR(128) NOT NULL,
    collected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- System-level metrics
    cpu_percent FLOAT,
    memory_percent FLOAT,
    disk_percent FLOAT,
    network_rx_mbps FLOAT,
    network_tx_mbps FLOAT,
    
    -- Pod-level metrics (aggregated)
    pod_metrics JSONB,
    
    -- Active alerts
    active_alerts INTEGER DEFAULT 0,
    alert_details JSONB,
    
    -- Full metrics snapshot
    full_metrics JSONB,
    
    FOREIGN KEY (testbed_id) REFERENCES testbeds(unique_testbed_id) ON DELETE CASCADE
);

-- 4. Create testbed_timeline view for easy querying
CREATE OR REPLACE VIEW testbed_timeline AS
SELECT 
    om.testbed_id,
    om.execution_id,
    om.entity_type,
    om.operation_type,
    om.entity_name,
    om.started_at AS timestamp,
    om.completed_at,
    om.duration_seconds,
    om.status,
    om.pod_cpu_percent,
    om.pod_memory_mb,
    e.status AS execution_status,
    t.testbed_label,
    t.pc_ip,
    t.ncm_ip
FROM operation_metrics om
LEFT JOIN executions e ON om.execution_id = e.execution_id
LEFT JOIN testbeds t ON om.testbed_id = t.unique_testbed_id
ORDER BY om.started_at DESC;

-- 5. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_operation_metrics_execution_id ON operation_metrics(execution_id);
CREATE INDEX IF NOT EXISTS idx_operation_metrics_testbed_id ON operation_metrics(testbed_id);
CREATE INDEX IF NOT EXISTS idx_operation_metrics_started_at ON operation_metrics(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_metrics_entity_type ON operation_metrics(entity_type);
CREATE INDEX IF NOT EXISTS idx_metrics_history_testbed_id ON metrics_history(testbed_id);
CREATE INDEX IF NOT EXISTS idx_metrics_history_collected_at ON metrics_history(collected_at DESC);

-- 6. Add comments for documentation
COMMENT ON TABLE operation_metrics IS 'Tracks individual entity operations with metrics snapshots';
COMMENT ON TABLE metrics_history IS 'Stores continuous Prometheus metrics for testbeds';
COMMENT ON VIEW testbed_timeline IS 'Unified view of testbed activities with metrics';
COMMENT ON COLUMN executions.metrics IS 'Full execution metrics collected from Prometheus';
COMMENT ON COLUMN executions.prometheus_url IS 'Prometheus endpoint URL for this execution';
COMMENT ON COLUMN operation_metrics.metrics_snapshot IS 'Prometheus metrics at the time of this operation';
COMMENT ON COLUMN operation_metrics.pod_cpu_percent IS 'CPU usage of pod running this operation';
COMMENT ON COLUMN operation_metrics.pod_memory_mb IS 'Memory usage in MB of pod running this operation';

-- 7. Create function to calculate operation duration on completion
CREATE OR REPLACE FUNCTION calculate_operation_duration()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.completed_at IS NOT NULL AND NEW.started_at IS NOT NULL THEN
        NEW.duration_seconds = EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. Create trigger for auto-calculating duration
DROP TRIGGER IF EXISTS trigger_calculate_operation_duration ON operation_metrics;
CREATE TRIGGER trigger_calculate_operation_duration
    BEFORE INSERT OR UPDATE ON operation_metrics
    FOR EACH ROW
    EXECUTE FUNCTION calculate_operation_duration();

-- 9. Grant permissions (adjust as needed)
-- GRANT SELECT, INSERT, UPDATE ON operation_metrics TO nmt_app;
-- GRANT SELECT, INSERT ON metrics_history TO nmt_app;
-- GRANT SELECT ON testbed_timeline TO nmt_app;
