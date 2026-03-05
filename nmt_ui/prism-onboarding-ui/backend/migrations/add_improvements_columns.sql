-- Add new columns for Smart Execution improvements
-- Safe to run multiple times (IF NOT EXISTS pattern)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_executions' AND column_name='tags') THEN
    ALTER TABLE smart_executions ADD COLUMN tags JSONB DEFAULT '[]'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_executions' AND column_name='anomaly_count') THEN
    ALTER TABLE smart_executions ADD COLUMN anomaly_count INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_executions' AND column_name='anomaly_high_count') THEN
    ALTER TABLE smart_executions ADD COLUMN anomaly_high_count INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_executions' AND column_name='anomaly_data') THEN
    ALTER TABLE smart_executions ADD COLUMN anomaly_data JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_executions' AND column_name='learning_summary') THEN
    ALTER TABLE smart_executions ADD COLUMN learning_summary TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_executions' AND column_name='latency_summary') THEN
    ALTER TABLE smart_executions ADD COLUMN latency_summary JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='smart_executions' AND column_name='alert_thresholds') THEN
    ALTER TABLE smart_executions ADD COLUMN alert_thresholds JSONB;
  END IF;
END $$;
