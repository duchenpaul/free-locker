PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  display_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  max_downloads INTEGER NOT NULL DEFAULT 5 CHECK (max_downloads > 0),
  successful_downloads INTEGER NOT NULL DEFAULT 0 CHECK (
    successful_downloads >= 0 AND successful_downloads <= max_downloads
  ),
  encryption_status TEXT NOT NULL DEFAULT 'unknown' CHECK (
    encryption_status IN ('unknown', 'not_encrypted', 'encrypted')
  ),
  scan_status TEXT NOT NULL DEFAULT 'unscanned' CHECK (
    scan_status IN ('unscanned', 'pending', 'clean', 'malicious', 'failed')
  ),
  lifecycle_status TEXT NOT NULL DEFAULT 'uploading' CHECK (
    lifecycle_status IN (
      'uploading', 'pending_scan', 'active', 'revoked', 'expired', 'exhausted',
      'cleanup_pending', 'deleted', 'failed'
    )
  ),
  revoked_at TEXT,
  revoked_reason TEXT,
  deleted_at TEXT,
  cleanup_attempts INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
  cleanup_last_error TEXT,
  cleanup_retry_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS files_public_lookup_idx ON files(public_id);
CREATE INDEX IF NOT EXISTS files_cleanup_idx
  ON files(lifecycle_status, expires_at, successful_downloads, max_downloads, cleanup_retry_at);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  capability_hash TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('single', 'multipart')),
  r2_multipart_upload_id TEXT,
  expected_size_bytes INTEGER NOT NULL CHECK (expected_size_bytes >= 0),
  uploaded_size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (uploaded_size_bytes >= 0),
  part_metadata_json TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  aborted_at TEXT,
  status TEXT NOT NULL DEFAULT 'created' CHECK (
    status IN ('created', 'uploading', 'completed', 'aborted', 'expired', 'failed')
  ),
  UNIQUE (file_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS upload_sessions_expiry_idx ON upload_sessions(status, expires_at);
CREATE INDEX IF NOT EXISTS upload_sessions_file_idx ON upload_sessions(file_id);

CREATE TABLE IF NOT EXISTS download_grants (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  request_ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS download_grants_lookup_idx ON download_grants(id, status, expires_at);
CREATE INDEX IF NOT EXISTS download_grants_expiry_idx ON download_grants(status, expires_at);

CREATE TABLE IF NOT EXISTS rate_limit_windows (
  ip_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  window_expires_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  upload_bytes INTEGER NOT NULL DEFAULT 0 CHECK (upload_bytes >= 0),
  PRIMARY KEY (ip_hash, action, window_started_at)
);

CREATE INDEX IF NOT EXISTS rate_limit_expiry_idx ON rate_limit_windows(window_expires_at);

CREATE TABLE IF NOT EXISTS abuse_reports (
  id TEXT PRIMARY KEY,
  public_file_id TEXT NOT NULL,
  reporter_contact TEXT,
  reason TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'open' CHECK (
    moderation_status IN ('open', 'reviewing', 'resolved', 'dismissed')
  ),
  resolved_at TEXT,
  moderator_note TEXT
);

CREATE INDEX IF NOT EXISTS abuse_reports_status_idx ON abuse_reports(moderation_status, submitted_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  details_json TEXT
);

CREATE INDEX IF NOT EXISTS audit_events_retention_idx ON audit_events(created_at);
