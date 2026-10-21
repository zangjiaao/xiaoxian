-- 小闲的云端档案。每一行都带 user_email，接口只按当前登录邮箱读写。

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  birth_year INTEGER NOT NULL,
  birth_month INTEGER NOT NULL,
  birth_day INTEGER NOT NULL,
  birth_hour INTEGER,
  birth_minute INTEGER,
  birth_place TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_profiles_user_updated ON profiles (user_email, updated_at);

CREATE TABLE charts (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  clock_mode TEXT NOT NULL CHECK (clock_mode = 'civil'),
  payload_json TEXT NOT NULL
);

CREATE INDEX idx_charts_user_profile ON charts (user_email, profile_id);

CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_user_profile ON chat_sessions (user_email, profile_id, updated_at);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  reasoning TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_messages_user_session ON chat_messages (user_email, session_id, created_at);

CREATE TABLE settings (
  user_email TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_email, key)
);
