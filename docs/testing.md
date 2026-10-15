# Testing

## Local checks

```sh
pnpm --filter @free-locker/shared test
pnpm --filter @free-locker/worker test
pnpm --filter @free-locker/web test
pnpm --filter @free-locker/cli test
pnpm typecheck
pnpm build
```

Worker tests use `@cloudflare/vitest-plugin` with local Miniflare D1 and R2 bindings. Each test applies the real D1 migration and covers:

- CLI and browser small uploads
- JSON response negotiation
- safe filename handling and attachment headers
- grant-backed downloads and HEAD non-consumption
- truthful multipart-unavailable handling
- encrypted ZIP best-effort one-download policy
- abuse reports, admin revocation, and rate limits
- bounded expiration cleanup and R2 deletion

## Real Cloudflare tests

Local emulation cannot prove presigned multipart `UploadPart` compatibility or deployed R2 CORS. Before enabling large uploads in production, use a dedicated test account/bucket to verify:

1. Signed URLs accept the exact configured `Content-Type`.
2. Browser origins can read `ETag` through the configured R2 CORS policy.
3. Completion verifies object size and activates a share.
4. Abort removes incomplete multipart state.
5. No public R2 URL bypasses the Worker download counter.

Do not report a live integration test as passed until it has actually run with non-production test credentials.
