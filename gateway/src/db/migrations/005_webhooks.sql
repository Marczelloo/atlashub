-- Webhooks System Schema

-- Webhooks table
CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,

    -- Webhook identification
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500),

    -- Target configuration
    url VARCHAR(2048) NOT NULL,
    method VARCHAR(10) NOT NULL DEFAULT 'POST' CHECK (method IN ('POST', 'PUT', 'PATCH')),

    -- Secret for HMAC-SHA256 signature (stored as hash for verification)
    secret_hash VARCHAR(64) NOT NULL, -- SHA-256 hash of the secret

    -- Event subscription (which events trigger this webhook)
    events JSONB NOT NULL DEFAULT '[]', -- Array of event types: ["record.created", "record.updated", "record.deleted"]

    -- Optional: filter by table names (empty = all tables)
    table_filter JSONB DEFAULT '[]', -- Array of table names to watch

    -- HTTP configuration
    headers JSONB DEFAULT '{}', -- Custom headers to send
    timeout_ms INTEGER NOT NULL DEFAULT 30000,

    -- Retry configuration
    enabled BOOLEAN NOT NULL DEFAULT true,
    max_retries INTEGER NOT NULL DEFAULT 3,
    retry_backoff_ms INTEGER NOT NULL DEFAULT 1000, -- Base backoff, exponential

    -- Metadata
    last_triggered_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique name per project
    UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_webhooks_project_id ON webhooks(project_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_enabled ON webhooks(enabled) WHERE enabled = true;

-- Webhook Deliveries (execution history)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,

    -- Event details
    event_type VARCHAR(50) NOT NULL, -- e.g., "record.created", "record.updated", "record.deleted"
    project_id UUID NOT NULL,
    table_name VARCHAR(255) NOT NULL,

    -- Payload (the data that was sent)
    payload JSONB NOT NULL,

    -- Request details
    request_headers JSONB, -- Headers sent (excluding sensitive ones)

    -- Response details
    http_status INTEGER,
    response_body TEXT,
    response_headers JSONB,

    -- Timing
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'retrying')),

    -- Retry tracking
    attempt_number INTEGER NOT NULL DEFAULT 1,
    next_retry_at TIMESTAMPTZ,
    error_message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status) WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next_retry ON webhook_deliveries(next_retry_at) WHERE status = 'retrying' AND next_retry_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_project_id ON webhook_deliveries(project_id, created_at DESC);

-- Trigger for updated_at on webhooks
DROP TRIGGER IF EXISTS update_webhooks_updated_at ON webhooks;
CREATE TRIGGER update_webhooks_updated_at
    BEFORE UPDATE ON webhooks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Webhook event types for reference:
-- record.created - Triggered when a new record is inserted
-- record.updated - Triggered when a record is updated
-- record.deleted - Triggered when a record is deleted
