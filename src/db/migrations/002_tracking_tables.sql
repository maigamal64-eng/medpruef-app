-- Migration 002: User tracking and analytics tables
-- Run manually via Supabase SQL editor or psql

-- User sessions (browser sessions)
CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text NOT NULL,
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  duration_seconds int,
  pages_visited text[] DEFAULT '{}',
  device_info jsonb DEFAULT '{}',
  exam_source text,
  created_at timestamptz DEFAULT now()
);

-- Event tracking
CREATE TABLE IF NOT EXISTS user_events (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  session_id uuid REFERENCES user_sessions(id),
  event_type text NOT NULL,
  event_data jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Daily aggregates (upserted by answer API or a cron)
CREATE TABLE IF NOT EXISTS daily_stats (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  date date NOT NULL,
  questions_answered int DEFAULT 0,
  questions_correct int DEFAULT 0,
  time_spent_seconds int DEFAULT 0,
  sessions_count int DEFAULT 0,
  topics_practiced text[] DEFAULT '{}',
  xp_earned int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_user_events_user_type ON user_events(user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_user_events_created ON user_events(created_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_stats_user_date ON daily_stats(user_id, date);
