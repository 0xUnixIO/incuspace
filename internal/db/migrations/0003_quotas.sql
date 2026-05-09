-- 流量配额表：从 quotas.json 迁移过来，按 instance_id 索引
CREATE TABLE IF NOT EXISTS quotas (
    instance_id BIGINT PRIMARY KEY REFERENCES instances(id) ON DELETE CASCADE,
    limit_bytes BIGINT NOT NULL DEFAULT 0,
    period TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('monthly','total')),
    action TEXT NOT NULL DEFAULT 'stop' CHECK (action IN ('stop','freeze','notify')),
    used_bytes BIGINT NOT NULL DEFAULT 0,
    last_bytes_rx BIGINT NOT NULL DEFAULT 0,
    last_bytes_tx BIGINT NOT NULL DEFAULT 0,
    last_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_poll_at TIMESTAMPTZ,
    triggered BOOLEAN NOT NULL DEFAULT FALSE
);
