# Security and threat model

## Controls

- Public IDs, grants, sessions, capabilities, and object keys use Web Crypto randomness.
- R2 is private. Clients receive only signed PUT part URLs, never an R2 GET URL or parent credential.
- Object keys are server-generated and unrelated to filenames. Display filenames are normalized and never used as storage paths.
- Direct downloads stream via the Worker with attachment disposition, `X-Content-Type-Options: nosniff`, no-store caching, and an opaque object key.
- Download authorization is a D1 conditional update plus grant creation. `HEAD` does not reserve a download.
- Uploads enforce server-side content-length and stream byte limits; oversized files are rejected with `413`.
- D1 prepared statements bind client values. API errors never contain SQL, stack traces, storage keys, grants, or secrets.
- Operator revocation needs a constant-time bearer-token comparison. Public abuse reporting cannot delete files.
- Per-IP rate windows store a salted hash and are removed during cleanup.

## Archive and scanner stance

The ZIP local-header general-purpose encryption bit is a best-effort positive signal. A positive signal limits a file to one authorization. Unknown formats remain `unknown`; the service never infers encryption solely from a filename extension and does not decrypt archives.

The default free deployment has no malware scanner. It reports `unscanned`, not “clean” or “scanned.” A production scanner integration must quarantine or keep files pending until a clean result is known, then reject malicious content.

## Residual risks

- A download authorization is consumed before streaming. The service cannot reliably know whether a client receives all bytes after disconnecting.
- Short-lived reusable grants allow range/retry requests during their TTL, so a strict count of physical transfer completions is intentionally not claimed.
- IP limits affect shared NATs and are not identity or access control.
- Direct-to-R2 presigned URLs are bearer credentials until expiry. Restrict R2 CORS origins and TTL, and never log URLs.
- Cloudflare Free quotas are finite and shared at account scope. This code does not silently enable paid services.
