export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES_BUCKET: R2Bucket;
  ADMIN_TOKEN?: string;
  DOWNLOAD_GRANT_TTL_SECONDS?: string;
  FILE_LISTING_MAX_ROWS?: string;
  FILE_LISTING_MODE?: string;
  IP_HASH_SALT?: string;
  MAX_DOWNLOADS?: string;
  MAX_SINGLE_UPLOAD_BYTES?: string;
  PUBLIC_BASE_URL?: string;
  R2_BUCKET_NAME?: string;
  RETENTION_HOURS?: string;
  RUNTIME_MODE?: string;
  UPLOAD_RATE_LIMIT_PER_HOUR?: string;
}
