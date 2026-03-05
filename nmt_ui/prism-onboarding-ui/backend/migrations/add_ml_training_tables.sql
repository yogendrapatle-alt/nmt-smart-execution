-- ML Training Pipeline Tables
-- Adds model_registry and ml_training_samples for DB-to-ML training

-- Model Registry: tracks all trained models with versioning and validation scores
CREATE TABLE IF NOT EXISTS model_registry (
    id SERIAL PRIMARY KEY,
    model_id VARCHAR(128) UNIQUE NOT NULL,
    testbed_id VARCHAR(128),
    model_version INTEGER NOT NULL DEFAULT 1,
    trained_at TIMESTAMP NOT NULL DEFAULT NOW(),
    samples_used INTEGER NOT NULL DEFAULT 0,
    cpu_r2 FLOAT,
    cpu_mae FLOAT,
    memory_r2 FLOAT,
    memory_mae FLOAT,
    validation_score FLOAT,
    model_path VARCHAR(512) NOT NULL,
    is_active BOOLEAN DEFAULT FALSE,
    training_duration_seconds FLOAT,
    feature_count INTEGER DEFAULT 6,
    feature_names JSONB,
    training_config JSONB,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_registry_testbed ON model_registry(testbed_id);
CREATE INDEX IF NOT EXISTS idx_model_registry_active ON model_registry(is_active);
CREATE INDEX IF NOT EXISTS idx_model_registry_trained_at ON model_registry(trained_at);

-- ML Training Samples: curated, validated training data from operation_metrics
CREATE TABLE IF NOT EXISTS ml_training_samples (
    id SERIAL PRIMARY KEY,
    testbed_id VARCHAR(128) NOT NULL,
    execution_id VARCHAR(128) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    operation VARCHAR(64) NOT NULL,
    cpu_before FLOAT NOT NULL,
    memory_before FLOAT NOT NULL,
    cpu_after FLOAT NOT NULL,
    memory_after FLOAT NOT NULL,
    cpu_impact FLOAT NOT NULL,
    memory_impact FLOAT NOT NULL,
    cluster_size INTEGER DEFAULT 1,
    concurrent_ops INTEGER DEFAULT 0,
    hour_of_day INTEGER,
    ops_per_minute FLOAT DEFAULT 0,
    duration_seconds FLOAT,
    success BOOLEAN DEFAULT TRUE,
    quality_score FLOAT DEFAULT 1.0,
    collected_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_samples_testbed ON ml_training_samples(testbed_id);
CREATE INDEX IF NOT EXISTS idx_ml_samples_collected ON ml_training_samples(collected_at);
CREATE INDEX IF NOT EXISTS idx_ml_samples_entity ON ml_training_samples(entity_type, operation);

-- ML Training Jobs: track background training runs
CREATE TABLE IF NOT EXISTS ml_training_jobs (
    id SERIAL PRIMARY KEY,
    job_id VARCHAR(128) UNIQUE NOT NULL,
    testbed_id VARCHAR(128),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    samples_used INTEGER DEFAULT 0,
    result_model_id VARCHAR(128),
    cpu_r2 FLOAT,
    memory_r2 FLOAT,
    error_message TEXT,
    trigger_type VARCHAR(32) DEFAULT 'manual',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_jobs_status ON ml_training_jobs(status);
CREATE INDEX IF NOT EXISTS idx_training_jobs_testbed ON ml_training_jobs(testbed_id);

-- Add timeout_minutes column to smart_executions if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'smart_executions' AND column_name = 'timeout_minutes') THEN
        ALTER TABLE smart_executions ADD COLUMN timeout_minutes FLOAT DEFAULT NULL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'smart_executions' AND column_name = 'checkpoint_data') THEN
        ALTER TABLE smart_executions ADD COLUMN checkpoint_data JSONB DEFAULT NULL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'smart_executions' AND column_name = 'last_checkpoint_at') THEN
        ALTER TABLE smart_executions ADD COLUMN last_checkpoint_at TIMESTAMP DEFAULT NULL;
    END IF;
END
$$;
