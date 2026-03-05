-- Migration: Enhance Smart Execution with Pod-Level Tracking and Rule Configuration
-- Purpose: Add comprehensive pod-level operation correlation and rule configuration support
-- Date: 2026-01-29

-- 1. Enhance operation_metrics table with pod tracking
ALTER TABLE operation_metrics 
ADD COLUMN IF NOT EXISTS pod_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS namespace VARCHAR(255),
ADD COLUMN IF NOT EXISTS affected_pods JSONB, -- Array of pods affected by this operation
ADD COLUMN IF NOT EXISTS pod_metrics_before JSONB, -- Pod metrics snapshot before operation
ADD COLUMN IF NOT EXISTS pod_metrics_after JSONB, -- Pod metrics snapshot after operation
ADD COLUMN IF NOT EXISTS pod_cpu_delta FLOAT, -- CPU change caused by operation
ADD COLUMN IF NOT EXISTS pod_memory_delta FLOAT; -- Memory change caused by operation

-- 2. Create pod_operation_correlation table for detailed pod tracking
CREATE TABLE IF NOT EXISTS pod_operation_correlation (
    id SERIAL PRIMARY KEY,
    execution_id VARCHAR(255) NOT NULL,
    operation_metric_id INTEGER REFERENCES operation_metrics(id) ON DELETE CASCADE,
    smart_execution_id VARCHAR(255), -- Reference to smart_executions table
    
    -- Pod identification
    pod_name VARCHAR(255) NOT NULL,
    namespace VARCHAR(255) NOT NULL,
    node_name VARCHAR(255),
    
    -- Correlation type
    correlation_type VARCHAR(50) DEFAULT 'affected', -- 'direct', 'indirect', 'affected'
    
    -- Metrics at operation time (before)
    cpu_percent_before FLOAT,
    memory_mb_before FLOAT,
    network_rx_mbps_before FLOAT,
    network_tx_mbps_before FLOAT,
    
    -- Metrics after operation (measured 5-10 seconds after)
    cpu_percent_after FLOAT,
    memory_mb_after FLOAT,
    network_rx_mbps_after FLOAT,
    network_tx_mbps_after FLOAT,
    
    -- Calculated deltas
    cpu_delta FLOAT,
    memory_delta FLOAT,
    network_rx_delta FLOAT,
    network_tx_delta FLOAT,
    
    -- Impact score (calculated)
    impact_score FLOAT DEFAULT 0.0,
    
    -- Timestamps
    measured_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign keys
    FOREIGN KEY (execution_id) REFERENCES executions(execution_id) ON DELETE CASCADE,
    FOREIGN KEY (smart_execution_id) REFERENCES smart_executions(execution_id) ON DELETE CASCADE
);

-- 3. Create rule_execution_mapping table for rule configuration
CREATE TABLE IF NOT EXISTS rule_execution_mapping (
    id SERIAL PRIMARY KEY,
    execution_id VARCHAR(255) NOT NULL,
    smart_execution_id VARCHAR(255), -- Reference to smart_executions table
    
    -- Rule identification
    rule_id INTEGER, -- Reference to rules table if exists
    rule_name VARCHAR(255),
    rule_book_id INTEGER, -- Reference to rule book if exists
    
    -- Rule configuration (JSONB for flexibility)
    rule_config JSONB NOT NULL, -- {
    --   "namespaces": ["ntnx-system", "default"],
    --   "pod_names": ["pod-1", "pod-2"],
    --   "custom_queries": [
    --     {"name": "Custom CPU", "query": "...", "threshold": 80}
    --   ],
    --   "filters": {
    --     "namespace_pattern": "ntnx-*",
    --     "pod_name_pattern": "ncm-*"
    --   }
    -- }
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign keys
    FOREIGN KEY (execution_id) REFERENCES executions(execution_id) ON DELETE CASCADE,
    FOREIGN KEY (smart_execution_id) REFERENCES smart_executions(execution_id) ON DELETE CASCADE
);

-- 4. Add rule_config column to smart_executions table
ALTER TABLE smart_executions 
ADD COLUMN IF NOT EXISTS rule_config JSONB; -- Store rule configuration with execution

-- 5. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_operation_metrics_pod_name ON operation_metrics(pod_name);
CREATE INDEX IF NOT EXISTS idx_operation_metrics_namespace ON operation_metrics(namespace);
CREATE INDEX IF NOT EXISTS idx_pod_correlation_execution_id ON pod_operation_correlation(execution_id);
CREATE INDEX IF NOT EXISTS idx_pod_correlation_smart_execution_id ON pod_operation_correlation(smart_execution_id);
CREATE INDEX IF NOT EXISTS idx_pod_correlation_pod_name ON pod_operation_correlation(pod_name);
CREATE INDEX IF NOT EXISTS idx_pod_correlation_namespace ON pod_operation_correlation(namespace);
CREATE INDEX IF NOT EXISTS idx_pod_correlation_measured_at ON pod_operation_correlation(measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_rule_execution_smart_execution_id ON rule_execution_mapping(smart_execution_id);
CREATE INDEX IF NOT EXISTS idx_rule_execution_execution_id ON rule_execution_mapping(execution_id);

-- 6. Create view for operation-pod correlation analysis
CREATE OR REPLACE VIEW operation_pod_impact AS
SELECT 
    poc.id,
    poc.execution_id,
    poc.smart_execution_id,
    poc.operation_metric_id,
    om.entity_type,
    om.operation_type,
    om.entity_name,
    poc.pod_name,
    poc.namespace,
    poc.correlation_type,
    poc.cpu_percent_before,
    poc.cpu_percent_after,
    poc.cpu_delta,
    poc.memory_mb_before,
    poc.memory_mb_after,
    poc.memory_delta,
    poc.impact_score,
    poc.measured_at,
    om.started_at AS operation_started_at,
    om.completed_at AS operation_completed_at,
    om.status AS operation_status,
    se.testbed_label,
    se.testbed_id
FROM pod_operation_correlation poc
LEFT JOIN operation_metrics om ON poc.operation_metric_id = om.id
LEFT JOIN smart_executions se ON poc.smart_execution_id = se.execution_id
ORDER BY poc.measured_at DESC;

-- 7. Create function to calculate impact score
CREATE OR REPLACE FUNCTION calculate_pod_impact_score(
    cpu_delta FLOAT,
    memory_delta FLOAT,
    network_rx_delta FLOAT,
    network_tx_delta FLOAT
) RETURNS FLOAT AS $$
BEGIN
    -- Impact score: weighted combination of metric changes
    -- CPU: 40%, Memory: 40%, Network: 20%
    RETURN (
        ABS(COALESCE(cpu_delta, 0)) * 0.4 +
        ABS(COALESCE(memory_delta, 0)) / 100.0 * 0.4 + -- Normalize memory (MB to percentage-like)
        (ABS(COALESCE(network_rx_delta, 0)) + ABS(COALESCE(network_tx_delta, 0))) / 10.0 * 0.2
    );
END;
$$ LANGUAGE plpgsql;

-- 8. Create trigger to auto-calculate impact score
CREATE OR REPLACE FUNCTION update_pod_impact_score()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.cpu_delta IS NOT NULL OR NEW.memory_delta IS NOT NULL THEN
        NEW.impact_score = calculate_pod_impact_score(
            NEW.cpu_delta,
            NEW.memory_delta,
            NEW.network_rx_delta,
            NEW.network_tx_delta
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_pod_impact_score ON pod_operation_correlation;
CREATE TRIGGER trigger_update_pod_impact_score
    BEFORE INSERT OR UPDATE ON pod_operation_correlation
    FOR EACH ROW
    EXECUTE FUNCTION update_pod_impact_score();

-- 9. Add comments for documentation
COMMENT ON TABLE pod_operation_correlation IS 'Tracks correlation between entity operations and pod-level metric changes';
COMMENT ON TABLE rule_execution_mapping IS 'Maps rule configurations (namespaces, pod names, queries) to executions';
COMMENT ON COLUMN operation_metrics.affected_pods IS 'JSON array of pods affected by this operation: [{"name": "pod-1", "namespace": "ntnx-system"}]';
COMMENT ON COLUMN operation_metrics.pod_metrics_before IS 'Pod metrics snapshot before operation execution';
COMMENT ON COLUMN operation_metrics.pod_metrics_after IS 'Pod metrics snapshot after operation execution';
COMMENT ON COLUMN rule_execution_mapping.rule_config IS 'Rule configuration including namespaces, pod names, and custom queries';

-- 10. Grant permissions (adjust as needed)
-- GRANT SELECT, INSERT, UPDATE ON pod_operation_correlation TO nmt_app;
-- GRANT SELECT, INSERT, UPDATE ON rule_execution_mapping TO nmt_app;
-- GRANT SELECT ON operation_pod_impact TO nmt_app;
