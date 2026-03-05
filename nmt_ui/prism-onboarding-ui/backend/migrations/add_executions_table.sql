-- Migration: Add executions table for tracking execution lifecycle
-- Purpose: Replace JITA-based file tracking with database-backed execution tracking
-- Date: 2026-01-27

-- Create executions table
CREATE TABLE IF NOT EXISTS executions (
    execution_id VARCHAR(255) PRIMARY KEY,
    testbed_id VARCHAR(128),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    
    -- Operation statistics
    completed_operations INTEGER DEFAULT 0,
    total_operations INTEGER DEFAULT 0,
    successful_operations INTEGER DEFAULT 0,
    failed_operations INTEGER DEFAULT 0,
    
    -- Timestamps
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Error tracking
    last_error TEXT,
    
    -- Configuration (JSON)
    config JSONB,
    
    -- Foreign key to testbeds (optional, allows orphan executions)
    CONSTRAINT fk_testbed 
        FOREIGN KEY (testbed_id) 
        REFERENCES testbeds(unique_testbed_id)
        ON DELETE SET NULL
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_executions_testbed_id ON executions(testbed_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_start_time ON executions(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_executions_created_at ON executions(created_at DESC);

-- Add execution_id column to alerts table for correlation
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS execution_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_alerts_execution_id ON alerts(execution_id);

-- Add foreign key constraint (optional, allows orphan alerts)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_execution'
    ) THEN
        ALTER TABLE alerts ADD CONSTRAINT fk_alert_execution
            FOREIGN KEY (execution_id) 
            REFERENCES executions(execution_id)
            ON DELETE SET NULL;
    END IF;
END $$;

-- Create function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_execution_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS trigger_update_execution_updated_at ON executions;
CREATE TRIGGER trigger_update_execution_updated_at
    BEFORE UPDATE ON executions
    FOR EACH ROW
    EXECUTE FUNCTION update_execution_updated_at();

-- Comments for documentation
COMMENT ON TABLE executions IS 'Tracks execution lifecycle for testbed workloads';
COMMENT ON COLUMN executions.execution_id IS 'Unique execution identifier (format: NMT-YYYYMMDD-HHMMSS-UUID)';
COMMENT ON COLUMN executions.testbed_id IS 'Associated testbed UUID';
COMMENT ON COLUMN executions.status IS 'Current execution status (PENDING, STARTING, RUNNING, PAUSED, STOPPING, STOPPED, COMPLETED, FAILED, ERROR)';
COMMENT ON COLUMN executions.progress IS 'Progress percentage (0-100)';
COMMENT ON COLUMN executions.config IS 'Full execution configuration as JSON';
COMMENT ON COLUMN alerts.execution_id IS 'Execution ID that triggered this alert (for correlation)';
