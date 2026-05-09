-- instances 表：面板侧实例所有权登记
CREATE TABLE IF NOT EXISTS instances (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,           -- 实际 Incus 名（带 u<uid>- 前缀）
    display_name TEXT NOT NULL,           -- 用户看到的名字
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spec_cpu INT NOT NULL DEFAULT 0,      -- 0 = 不限
    spec_memory_mb INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS instances_owner_idx ON instances(owner_id);
