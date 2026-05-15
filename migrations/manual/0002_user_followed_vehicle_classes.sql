-- Plan-PP follow-up: schema 已加 userFollowedVehicleClasses 但缺 drizzle migration
-- 用 manual migration 兜底,IF NOT EXISTS 保持幂等
CREATE TABLE IF NOT EXISTS user_followed_vehicle_classes (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_class_id uuid NOT NULL REFERENCES vehicle_classes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, vehicle_class_id)
);

CREATE INDEX IF NOT EXISTS ufvc_user_idx ON user_followed_vehicle_classes(user_id);
CREATE INDEX IF NOT EXISTS ufvc_vehicle_idx ON user_followed_vehicle_classes(vehicle_class_id);
