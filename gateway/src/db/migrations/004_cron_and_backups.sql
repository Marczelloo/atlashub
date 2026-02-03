-- Cron Jobs and Backup/Import-Export Schema

-- Cron Jobs table
CREATE TABLE IF NOT EXISTS cron_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE, -- NULL = global/platform job
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    
    -- Job type: http = external HTTP call, platform = internal action
    job_type VARCHAR(20) NOT NULL CHECK (job_type IN ('http', 'platform')),
    
    -- Scheduling
    schedule_cron VARCHAR(100) NOT NULL, -- Standard cron expression
    timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
    
    -- HTTP job config (used when job_type = 'http')
    http_url VARCHAR(2048),
    http_method VARCHAR(10) DEFAULT 'GET' CHECK (http_method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
    http_headers_encrypted TEXT, -- AES-256-GCM encrypted JSON
    http_body_encrypted TEXT, -- AES-256-GCM encrypted JSON
    
    -- Platform job config (used when job_type = 'platform')
    platform_action VARCHAR(50), -- e.g., 'backup.platform', 'backup.project', 'cleanup.logs'
    platform_config JSONB, -- Action-specific configuration
    
    -- Execution settings
    enabled BOOLEAN NOT NULL DEFAULT true,
    timeout_ms INTEGER NOT NULL DEFAULT 30000,
    retries INTEGER NOT NULL DEFAULT 0,
    retry_backoff_ms INTEGER NOT NULL DEFAULT 1000,
    
    -- Encryption IV/auth tag for headers and body
    headers_iv VARCHAR(24),
    headers_auth_tag VARCHAR(24),
    body_iv VARCHAR(24),
    body_auth_tag VARCHAR(24),
    
    -- Metadata
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique name per project (NULL project = global namespace)
    UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled, next_run_at) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_cron_jobs_project_id ON cron_jobs(project_id);

-- Cron Job Runs (execution history)
CREATE TABLE IF NOT EXISTS cron_job_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
    
    -- Timing
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    duration_ms INTEGER,
    
    -- Result
    status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'fail', 'timeout', 'cancelled')),
    http_status INTEGER, -- For HTTP jobs
    error_text TEXT,
    
    -- Log storage (optional: store large logs in MinIO)
    log_object_key VARCHAR(1024), -- MinIO object key for full log
    log_preview TEXT, -- First ~1000 chars of log
    
    -- Retry tracking
    attempt_number INTEGER NOT NULL DEFAULT 1,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cron_job_runs_job_id ON cron_job_runs(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_job_runs_status ON cron_job_runs(status) WHERE status = 'running';

-- Backups table
CREATE TABLE IF NOT EXISTS backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL, -- NULL = platform DB backup
    
    -- Backup type
    backup_type VARCHAR(20) NOT NULL CHECK (backup_type IN ('platform', 'project', 'table')),
    table_name VARCHAR(255), -- For table-level backups
    
    -- Storage
    object_key VARCHAR(1024) NOT NULL, -- MinIO object key
    size_bytes BIGINT NOT NULL DEFAULT 0,
    format VARCHAR(20) NOT NULL DEFAULT 'sql' CHECK (format IN ('sql', 'csv', 'json')),
    
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    error_message TEXT,
    
    -- Retention
    retention_days INTEGER,
    expires_at TIMESTAMPTZ,
    
    -- Metadata
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_backups_project_id ON backups(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backups_expires_at ON backups(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_backups_type ON backups(backup_type);

-- Import/Export Jobs table (for tracking async operations)
CREATE TABLE IF NOT EXISTS import_export_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    
    -- Operation type
    operation VARCHAR(10) NOT NULL CHECK (operation IN ('import', 'export')),
    target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('database', 'table')),
    table_name VARCHAR(255), -- For table operations
    
    -- File info
    object_key VARCHAR(1024), -- MinIO object key for source (import) or result (export)
    format VARCHAR(20) NOT NULL CHECK (format IN ('csv', 'json', 'sql')),
    
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    rows_processed INTEGER DEFAULT 0,
    rows_total INTEGER,
    error_message TEXT,
    
    -- Options
    options JSONB DEFAULT '{}', -- Format-specific options (delimiter, headers, upsert mode, etc.)
    
    -- Metadata
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_export_jobs_project_id ON import_export_jobs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_export_jobs_status ON import_export_jobs(status) WHERE status IN ('pending', 'running');

-- Notification settings table (for cron job failure alerts)
CREATE TABLE IF NOT EXISTS notification_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Notification type
    type VARCHAR(30) NOT NULL CHECK (type IN ('discord', 'email', 'webhook')),
    name VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    
    -- Configuration (encrypted for secrets)
    config_encrypted TEXT NOT NULL, -- AES-256-GCM encrypted JSON
    config_iv VARCHAR(24) NOT NULL,
    config_auth_tag VARCHAR(24) NOT NULL,
    
    -- Event filters
    events JSONB NOT NULL DEFAULT '["cron.failed", "backup.failed"]', -- Which events to notify
    
    -- Metadata
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger for updated_at on cron_jobs
DROP TRIGGER IF EXISTS update_cron_jobs_updated_at ON cron_jobs;
CREATE TRIGGER update_cron_jobs_updated_at
    BEFORE UPDATE ON cron_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for updated_at on notification_settings
DROP TRIGGER IF EXISTS update_notification_settings_updated_at ON notification_settings;
CREATE TRIGGER update_notification_settings_updated_at
    BEFORE UPDATE ON notification_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
