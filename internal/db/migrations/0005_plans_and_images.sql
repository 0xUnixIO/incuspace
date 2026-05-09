-- 套餐 + 镜像白名单
CREATE TABLE IF NOT EXISTS plans (
    id BIGINT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    cpu INT NOT NULL,
    memory_mb INT NOT NULL,
    traffic_gb INT NOT NULL DEFAULT 0,
    bandwidth_mbps INT NOT NULL DEFAULT 0,
    ports INT NOT NULL DEFAULT 10,
    stock INT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS allowed_images (
    id BIGINT PRIMARY KEY,
    alias TEXT UNIQUE NOT NULL,
    source TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE instances ADD COLUMN IF NOT EXISTS plan_id BIGINT NULL REFERENCES plans(id);
ALTER TABLE instances ADD COLUMN IF NOT EXISTS image TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_instances_plan_id ON instances(plan_id);
