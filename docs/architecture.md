# Architecture

free-locker uses one asset-first Worker. Vite assets are served directly; `/`, `/api/*`, dynamic download paths, and Cron cleanup run Worker code.

```mermaid
flowchart TD
  Browser[Browser / CLI] --> Worker[Cloudflare Worker + Hono]
  Worker --> D1[(D1 metadata)]
  Worker --> R2[(Private R2 objects)]
  Cron[Cron Trigger] --> Worker
  Worker --> Static[Workers Static Assets]
```

## Small uploads

`PUT /` and raw `POST /api/v1/uploads` stream a request body into R2. The Worker rejects a body above the configured limit before it becomes active. D1 metadata starts in `uploading`; only a successful R2 write changes it to `active`.

```mermaid
sequenceDiagram
  participant C as Browser / curl
  participant W as Worker
  participant D as D1
  participant R as Private R2
  C->>W: PUT / or POST /api/v1/uploads
  W->>D: Insert uploading metadata
  W->>R: Stream bounded object body
  W->>D: Activate file with detected archive status
  W-->>C: URL or stable JSON response
```

The direct path requires `Content-Length`, because R2 streaming writes require a known length. The application caps it below Cloudflare Free's 100 MB zone request limit.

## Multipart uploads

For large files, the browser or CLI creates an upload session, requests one signed R2 `UploadPart` URL at a time, sends parts directly to R2, and submits ordered ETags to the Worker. Parent R2 credentials never reach a client.

```mermaid
sequenceDiagram
  participant C as Browser / CLI
  participant W as Worker
  participant D as D1
  participant R as Private R2
  C->>W: POST /api/v1/uploads (intent)
  W->>R: Create multipart upload
  W->>D: Store hashed capability and session
  loop Every part
    C->>W: Request signed part URL
    W-->>C: 5-minute scoped PUT URL
    C->>R: Upload part directly
  end
  C->>W: Complete with ETags
  W->>R: Complete and HEAD verify object
  W->>D: Activate file
```

R2 presigned multipart part URLs must be validated against a real bucket before production rollout. The implementation fails closed with `MULTIPART_UNAVAILABLE` when signing credentials are absent.

## Downloads

Share links are not R2 URLs. A `GET /:id/:filename` atomically reserves an allowance and redirects to a 10-minute grant. Grant requests can use Range headers for retry/resume. `HEAD` reads safe metadata and never consumes an allowance.

```mermaid
sequenceDiagram
  participant R as Recipient
  participant W as Worker
  participant D as D1
  participant O as Private R2
  R->>W: GET /:id/:filename
  W->>D: Atomically reserve authorization + grant
  W-->>R: 302 /download/:grant/:filename
  R->>W: GET grant URL
  W->>D: Validate grant and lifecycle state
  W->>O: Read private object
  W-->>R: Attachment stream
```

This enforces five distinct authorizations. It does not claim that the Worker can prove every client received all bytes after a stream begins; a grant may serve retry/range requests during its 10-minute lifetime.
