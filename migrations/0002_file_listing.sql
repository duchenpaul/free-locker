ALTER TABLE files ADD COLUMN upload_ip TEXT;

CREATE INDEX IF NOT EXISTS files_public_listing_idx
  ON files(lifecycle_status, scan_status, expires_at, created_at DESC);
