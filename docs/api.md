# API

All versioned API errors use:

```json
{
  "success": false,
  "error": {
    "code": "FILE_EXPIRED",
    "message": "This file has expired.",
    "requestId": "opaque-request-id"
  }
}
```

## Uploads

| Method and path                                        | Purpose                       | Request                                                         | Success                                                                             |
| ------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `PUT /`                                                | CLI single upload             | Raw body, `Content-Length`; filename from `Content-Disposition` | Plain download instruction, or `UploadSuccess` JSON with `Accept: application/json` |
| `PUT` or `POST /files[/:filename]`                     | Raw upload alias              | Raw body, `Content-Length`; optional safe path filename         | Same as root PUT; `GET /files` is intentionally not a listing endpoint              |
| `POST /:filename`                                      | Raw-byte compatibility upload | Raw body and safe path filename                                 | Same as root PUT                                                                    |
| `POST /api/v1/uploads`                                 | Browser direct upload         | Raw body + content disposition                                  | `201 UploadSuccess` JSON                                                            |
| `POST /api/v1/uploads`                                 | Multipart intent              | JSON `{ filename, size, contentType }`                          | `201` session `{ uploadId, capability, mode, expiresAt, partSize }`                 |
| `POST /api/v1/uploads/:id/multipart/parts/:partNumber` | Authorize one part            | `X-Upload-Capability`, JSON `{ size }`                          | Signed R2 PUT URL, exact content type, expiry                                       |
| `POST /api/v1/uploads/:id/multipart/complete`          | Verify and activate           | Capability + ordered `{ parts: [{ partNumber, etag }] }`        | `UploadSuccess` JSON                                                                |
| `POST /api/v1/uploads/:id/multipart/abort`             | Abort incomplete upload       | Capability                                                      | `204`                                                                               |

`UploadSuccess` is stable JSON:

```json
{
  "success": true,
  "id": "public-random-id",
  "filename": "file.zip",
  "size": 1048576,
  "downloadUrl": "https://free-locker.example/public-random-id/file.zip",
  "expiresAt": "2026-10-16T12:00:00.000Z",
  "remainingDownloads": 5,
  "scanStatus": "unscanned"
}
```

## Files and downloads

| Method and path                  | Behavior                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/v1/files/:id`          | Safe public metadata only. No object key, credentials, or storage internals.               |
| `GET /api/v1/config`             | Public UI capabilities, including configured file-listing mode.                            |
| `GET /api/v1/file_browser`       | Mode-gated active file table JSON: opaque ID, name, size, upload date/IP, link, and count. |
| `GET /help`                      | Plain-text command-line reference suitable for `curl -L`.                                  |
| `GET /file_browser`              | Mode-gated browser route; redirects to `/#/file_browser` or returns JSON.                  |
| `HEAD /:id/:filename`            | Metadata headers; does not spend an allowance.                                             |
| `GET /:id/:filename`             | Reserves an authorization and returns a 302 to the temporary grant.                        |
| `GET /download/:grant/:filename` | Streams attachment content; Range requests are valid only on a grant.                      |
| `GET /healthz`                   | Minimal health response.                                                                   |

Expired, revoked, exhausted, and unavailable shares return `410` or `404` as appropriate. Download streams use attachment disposition, `application/octet-stream`, `nosniff`, and `Cache-Control: no-store`.

File-listing modes are configured in `config/transfer.defaults.json` or overridden by `FILE_LISTING_MODE`:

- `enabled`: `/file_browser` and the JSON API work, and the browser navigation shows Files.
- `hidden`: `/file_browser` and the JSON API work, but the browser navigation omits Files.
- `disabled`: `/file_browser` and the JSON API return 404, and the browser navigation omits Files.

The listing intentionally exposes upload IP addresses when enabled or hidden. Keep the default `disabled` for public instances unless the privacy implications are acceptable.

## Operations

| Method and path                       | Authorization                         | Behavior                                                                 |
| ------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| `POST /api/v1/reports`                | None                                  | Submits a rate-limited abuse report without granting deletion authority. |
| `POST /api/v1/admin/files/:id/revoke` | `Authorization: Bearer <ADMIN_TOKEN>` | Revokes a share immediately; physical deletion occurs in Cron cleanup.   |

Upload rate limits use a salted client-network hash in bounded D1 windows. Deployments should set `IP_HASH_SALT` as a Worker secret.
