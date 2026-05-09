-- 端口分配模型重构：
-- 之前 port_range 在 users 表（按用户）；改为按实例分配（每实例一段连续端口）
-- - users 删除 port_range 列
-- - instances 增加 port_range_start / port_range_end
-- 端口由后端从全局池（环境变量 PORT_POOL_START/PORT_POOL_END，
-- 每实例 PORTS_PER_INSTANCE 个）启动时分配。

ALTER TABLE users DROP COLUMN IF EXISTS port_range_start;
ALTER TABLE users DROP COLUMN IF EXISTS port_range_end;

ALTER TABLE instances ADD COLUMN IF NOT EXISTS port_range_start INT;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS port_range_end INT;

CREATE INDEX IF NOT EXISTS instances_port_range_idx ON instances(port_range_start);
