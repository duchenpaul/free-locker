import type { AppConfig } from '../config';
import type { Env } from '../env';
import { AppError } from '../errors';
import { sha256Base64Url } from '../security';

function currentWindow(now: Date): { expiresAt: string; startedAt: string } {
  const startedAt = new Date(now);
  startedAt.setUTCMinutes(0, 0, 0);
  const expiresAt = new Date(startedAt);
  expiresAt.setUTCHours(expiresAt.getUTCHours() + 1);
  return { expiresAt: expiresAt.toISOString(), startedAt: startedAt.toISOString() };
}

export async function enforceUploadRateLimit(
  env: Env,
  config: AppConfig,
  clientIp: string | undefined,
): Promise<void> {
  const { expiresAt, startedAt } = currentWindow(new Date());
  const salt = env.IP_HASH_SALT ?? 'local-development-only-rate-limit-salt';
  const ipHash = await sha256Base64Url(`${salt}:${clientIp ?? 'unknown'}`);
  const result = await env.DB.prepare(
    `INSERT INTO rate_limit_windows (
      ip_hash, action, window_started_at, window_expires_at, request_count, upload_bytes
    ) VALUES (?, 'upload', ?, ?, 1, 0)
    ON CONFLICT(ip_hash, action, window_started_at) DO UPDATE SET request_count = request_count + 1
    WHERE request_count < ?`,
  )
    .bind(ipHash, startedAt, expiresAt, config.uploadRateLimitPerHour)
    .run();

  if (result.meta.changes !== 1) {
    throw new AppError('RATE_LIMITED', 'Too many uploads were requested. Try again later.', 429);
  }
}
