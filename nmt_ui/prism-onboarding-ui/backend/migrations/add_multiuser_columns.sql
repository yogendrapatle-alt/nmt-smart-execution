-- Migration script to add multi-user support columns to email_schedules table
-- Run this script to update the database schema for multi-user email scheduling

-- Add user_email column
ALTER TABLE email_schedules 
ADD COLUMN IF NOT EXISTS user_email VARCHAR(255);

-- Add schedule_name column
ALTER TABLE email_schedules 
ADD COLUMN IF NOT EXISTS schedule_name VARCHAR(255);

-- Update existing records to have default values
UPDATE email_schedules 
SET user_email = 'admin@system.local' 
WHERE user_email IS NULL;

UPDATE email_schedules 
SET schedule_name = 'Default Schedule' 
WHERE schedule_name IS NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_email_schedules_user_email ON email_schedules(user_email);
CREATE INDEX IF NOT EXISTS idx_email_schedules_user_schedule ON email_schedules(user_email, schedule_name);

-- Verify the changes
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'email_schedules' 
ORDER BY ordinal_position;
