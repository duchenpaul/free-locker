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

## Upload size limit

Every upload is a single Worker request streamed to R2. Files larger than `MAX_SINGLE_UPLOAD_BYTES` are rejected with `413 Payload Too Large` (`UPLOAD_TOO_LARGE`) before any storage write.

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
