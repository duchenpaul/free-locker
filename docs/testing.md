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
- oversized uploads rejected with 413
- encrypted ZIP best-effort one-download policy
- abuse reports, admin revocation, and rate limits
- bounded expiration cleanup and R2 deletion

## Real Cloudflare tests

Before enabling production use, verify with a dedicated test account/bucket:

1. A real upload round-trip works end to end against the deployed Worker.
2. No public R2 URL bypasses the Worker download counter.

Do not report a live integration test as passed until it has actually run with non-production test credentials.
