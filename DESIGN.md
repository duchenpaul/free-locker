/goal Build a copy of https://sendit.sh

Check the feature in https://sendit.sh/help, and try to 1:1 replicate it.

Ideally, user can use github actions to deploy to Cloudflare Workers. Check https://github.com/maillab/cloud-mail on how they did to deploy to the Cloudflare Workers.

Below is the system design

# System Design and Implementation Prompt: free-locker

## 1. Project Overview

Build a production-minded, lightweight temporary file-sharing web application named **free-locker**, inspired by the user experience and feature set of https://sendit.sh/ and its official help page at https://sendit.sh/help.

The product is intended for developers, system administrators, DevOps engineers, CI/CD pipelines, and everyday users who need to transfer files quickly without creating an account.

The primary product principles are:

- No registration or login required for normal file transfers.
- Upload files from a web browser or command line.
- Generate a unique, shareable download URL immediately after a successful upload.
- Files expire automatically after 24 hours or five successful downloads, whichever happens first.
- Support scripting and automation with predictable HTTP behavior and machine-readable JSON responses.
- Keep infrastructure costs as close to zero as possible by using Cloudflare's free offerings.
- Never pretend that an unsupported capability, security scan, or cleanup operation has succeeded.

Do not copy the reference site's branding, source code, or visual assets. Build an original product identity and implementation.

## 2. Mandatory Technical Stack

Use the following technologies unless a documented Cloudflare platform limitation requires a change.

### Frontend

- TypeScript
- React
- Vite
- Responsive, accessible HTML and CSS
- A lightweight component library or custom components
- Fetch API for HTTP requests

Deploy the static frontend using Cloudflare Workers Static Assets or another currently supported Cloudflare free static-hosting option.

Avoid server-side rendering unless a concrete requirement justifies it.

### Backend

- TypeScript
- Cloudflare Workers
- Hono for routing, middleware, and request validation
- Zod for input validation
- Cloudflare D1 using SQLite for metadata
- Cloudflare R2 for binary file storage
- Wrangler for local development, configuration, database migrations, and deployment
- Vitest for unit and integration tests

Use Cloudflare-native APIs and bindings where practical.

Do not introduce paid third-party services, a VPS, a traditional Node.js server, Redis, or a separate managed database into the default architecture.

### Repository and tooling

Use pnpm and a maintainable monorepo structure:

- apps/web: React frontend
- apps/worker: API and application logic
- packages/shared: shared types and validation schemas
- migrations: D1 SQL migrations
- tests: unit and integration tests
- docs: architecture, API, deployment, security, and operations documentation

Provide a working package.json, TypeScript configuration, Wrangler configuration, environment-variable examples, and setup instructions.

## 3. Product Features

Implement the following features.

### 3.1 Homepage

Create a clean, minimal, developer-oriented homepage.

The homepage must include:

- Product name and original free-locker branding.
- A clear explanation that files are temporary.
- A prominent drag-and-drop upload area.
- A file picker.
- Upload progress and error feedback.
- The maximum supported file size and retention policy.
- A command-line upload example.
- A copyable shell alias.
- Links to Help, FAQ, Terms, Privacy Policy, Disclaimer, and Abuse Reporting.
- Responsive layouts for desktop, tablet, and mobile devices.
- Accessible controls, keyboard navigation, and appropriate loading and empty states.

Keep the interface fast and avoid unnecessary animations, tracking scripts, and heavy dependencies.

### 3.2 Browser-based file uploads

Allow users to:

- Select one or more files.
- Drag and drop files.
- See filenames, file sizes, upload status, and progress.
- Cancel an upload before completion where possible.
- Retry failed uploads.
- Remove files from the selection before uploading.
- Upload multiple files as separate independent shares.
- Receive a unique download link for every successfully uploaded file.
- Copy a download URL with one click.
- See the expiration time and remaining download allowance.

Validate file sizes and upload limits on both the client and server.

Never rely on client-side validation alone.

For the initial MVP, set a configurable maximum file size of 100 MB per file for uploads through a single HTTP request. Design the storage and upload APIs so that larger files can be supported through R2 multipart uploads without routing the entire file through a Worker.

### 3.3 Command-line uploads

The command-line workflow is a first-class product feature, not an optional afterthought.

Support the familiar workflow:

    curl --upload-file ./file.zip https://free-locker.example/

Also support:

    curl -T ./file.zip https://free-locker.example/

    curl -T ./archive.tar.gz https://free-locker.example/

    wget https://free-locker.example/<file-id>/<filename>

Requirements:

- Accept HTTP PUT requests at the root upload endpoint.
- Accept a conventional multipart/form-data upload endpoint for scripts and clients that prefer POST.
- Derive the filename safely from the request and sanitize it before display.
- Return a ready-to-use download URL after a successful upload.
- Return a non-zero-compatible HTTP error response for failures.
- Support `Accept: application/json` and return a stable JSON response schema when requested.
- Set an appropriate content type and HTTP status code.
- Avoid HTML responses for command-line clients requesting JSON.
- Provide copy-and-paste examples for Linux, macOS, Windows PowerShell, Git Bash, WSL, and CI/CD workflows.
- Include GitHub Actions and GitLab CI examples.
- Provide a shell alias similar to:

      alias free-locker='curl https://free-locker.example -T'

- Document how to download files with curl and wget.

Example successful JSON response:

    {
      "success": true,
      "id": "random-public-id",
      "filename": "file.zip",
      "size": 1048576,
      "downloadUrl": "https://free-locker.example/random-public-id/file.zip",
      "expiresAt": "2026-10-16T12:00:00Z",
      "remainingDownloads": 5
    }

The response schema is illustrative; define and document a consistent final schema.

#### Large-file CLI compatibility

Cloudflare's proxied HTTP request-body limit may prevent a single `curl -T` request from accepting very large files.

Do not claim that the simple PUT endpoint supports 10 GB uploads when it cannot.

Implement a documented large-file upload path using R2 multipart uploads and a CLI helper script or small TypeScript CLI client that uploads parts directly to R2 using short-lived presigned URLs.

Keep the simple `curl -T` workflow for files within the verified single-request limit.

### 3.4 Download pages and direct downloads

Each uploaded file must have a unique public identifier and a download URL.

Implement:

- Direct downloads suitable for browsers, curl, and wget.
- A human-friendly download page when appropriate.
- Correct Content-Disposition headers.
- Safe filename handling.
- Content-Type handling that does not cause arbitrary uploaded HTML or scripts to execute in the application origin.
- Appropriate `X-Content-Type-Options: nosniff` and other security headers.
- Clear messages for expired files, missing files, exhausted download limits, and revoked shares.
- HTTP 404 or 410 responses as appropriate.
- Cache behavior that cannot serve expired or unauthorized content.
- No directory listing or public access to an R2 bucket.

Do not expose internal R2 object keys, credentials, or storage configuration.

### 3.5 File expiration and download limits

Use the following defaults:

- Retention period: 24 hours from successful upload.
- Maximum downloads: five successful downloads.
- A file becomes unavailable when either limit is reached.
- Encrypted archive files are allowed, but their maximum download count is one.
- All retention settings and limits must be configurable.

Determine whether an archive is encrypted using a documented, best-effort detection method. Do not trust its filename extension alone.

Do not inspect or attempt to decrypt an encrypted archive.

Implement expiration and download-limit checks on the server, not only in the frontend.

Define exactly what constitutes a successful download. For example, distinguish a completed transfer from an interrupted request, a HEAD request, or a metadata lookup.

Prevent concurrent downloads from exceeding the configured allowance. Use atomic conditional updates or another concurrency-safe design. Explain any limitations around interrupted downloads and range requests.

### 3.6 File lifecycle and deletion

Implement both logical expiration and physical storage cleanup.

- Reject access immediately when a share expires or its download allowance is exhausted.
- Use Cloudflare Cron Triggers for periodic cleanup.
- Query expired and exhausted records in bounded batches.
- Delete corresponding R2 objects.
- Remove incomplete multipart uploads after an appropriate timeout.
- Delete stale metadata after successful cleanup, subject to audit and abuse-reporting requirements.
- Make cleanup idempotent and safe to retry.
- Record deletion failures and retry later.
- Document that scheduled cleanup is asynchronous and does not guarantee deletion at the exact expiration second.

If R2 lifecycle rules are used as an additional safeguard, explain their limitations and ensure they do not delete active files prematurely.

### 3.7 File types and malware handling

Support arbitrary file types by default, subject to configurable limits and abuse controls.

The reference service states that uploads are scanned for malware. Treat malware scanning as a security requirement that needs a real scanner or scanning integration.

Do not falsely label files as scanned if no scanner is configured.

Because the default deployment must remain within Cloudflare's free tier:

- Define a scanner interface that can be integrated with an external scanning service or a separately operated scanner later.
- Keep the MVP deployable without a paid scanning dependency.
- Explicitly disclose the scanning status in documentation.
- Quarantine files until scanning completes when scanning is enabled.
- Reject confirmed malicious files.
- Never execute uploaded files.
- Avoid loading user-uploaded HTML or JavaScript on the application's trusted origin.
- Apply configurable extension and content-type policies where appropriate.

Explain the trade-off between an entirely free deployment and reliable malware scanning of large files.

### 3.8 Abuse prevention and rate limiting

Implement basic abuse prevention without requiring user accounts.

Include:

- Configurable per-IP upload rate limits.
- Per-IP request and upload quotas.
- Maximum file size and active-share limits.
- Request-body validation.
- Random, unguessable public identifiers.
- Restrictions on malformed requests.
- Protection against path traversal and unsafe filenames.
- An abuse-reporting endpoint or form.
- A documented takedown workflow.
- A mechanism to revoke a share.
- An operator-only administrative mechanism protected by a secret or Cloudflare Access.
- Minimal, bounded operational logs.
- A retention policy for logs and abuse reports.

Do not store IP addresses or user-agent data indefinitely. Document what is collected, why it is collected, and how long it is retained.

Do not expose an unauthenticated endpoint that can delete arbitrary files.

Explain the limitations of IP-based rate limiting, including shared NAT addresses and IPv6 clients.

### 3.9 Privacy, terms, and disclaimer pages

Create original pages for:

- Help
- FAQ
- Terms of Service
- Privacy Policy
- Disclaimer
- Abuse Reporting
- Contact

Document that free-locker is a temporary transfer service, not a backup or permanent cloud-storage solution.

Explain:

- Default retention and download limits.
- The deletion process and its limitations.
- User responsibility for uploaded content.
- Prohibited content and intellectual-property complaints.
- The limits of confidentiality and encryption.
- Operational logging and retention.
- The process for reporting abuse.
- Service availability limitations.

Do not claim end-to-end encryption unless it is actually implemented and verified.

## 4. Cloudflare Architecture

Use the following default architecture:

    Browser / curl / CLI helper
              |
              v
    Cloudflare DNS + HTTPS
              |
              v
    Cloudflare Worker
       |          |
       v          v
      D1          R2
    Metadata    File objects
       |
       v
    Cron Trigger
    Expiration and cleanup

For large uploads:

    CLI helper or browser
              |
              v
    Worker: create upload session
              |
              v
    Short-lived R2 presigned URLs
              |
              v
    Direct R2 multipart upload
              |
              v
    Worker: verify and finalize
              |
              v
    D1 metadata becomes active

Requirements:

- Keep the R2 bucket private.
- Do not proxy large binary uploads through the Worker.
- Use short-lived, narrowly scoped presigned URLs.
- Never expose R2 access keys to browsers or clients.
- Restrict presigned URLs to a specific object and operation.
- Verify the uploaded object and its size before activating a share.
- Keep incomplete uploads unavailable to downloaders.
- Clean up incomplete multipart sessions.
- Make direct-download authorization consistent with the expiration and download-count rules.
- Avoid public R2 URLs that bypass application authorization.

### Important download-count design decision

A raw R2 presigned GET URL can be reused until it expires and may allow downloads that bypass the Worker counter.

Therefore, design download authorization explicitly.

Choose and document one of these approaches:

1. Route downloads through the Worker and enforce the download limit there, while accounting for Cloudflare request-size, range-request, and bandwidth constraints.
2. Use very short-lived, one-time download grants with atomic reservation and finalization logic, acknowledging that an issued URL may still be reused during its validity period.
3. Introduce a more sophisticated download-token mechanism if necessary.

Do not claim strict five-download enforcement if the implementation cannot guarantee it.

For the default MVP, prioritize correct authorization and clearly defined download-count semantics over pretending to support every possible large-file delivery pattern.

## 5. Cloudflare Free-Tier Constraints

Before implementing the system, consult the current official Cloudflare documentation.

Verify all relevant limits at implementation time, including:

- Workers Free daily request quotas and CPU limits.
- HTTP request-body limits imposed by the Cloudflare plan and upload path.
- R2 free storage allowance and operation quotas.
- R2 multipart upload behavior.
- Presigned URL constraints.
- D1 storage, query, and write limits.
- Cron Trigger restrictions.
- Rate Limiting availability and limits.
- Static Assets deployment behavior.
- Cloudflare security and caching behavior.

Design for a free-tier MVP, but do not promise unlimited usage.

Use a configurable default file size limit of 100 MB for single-request uploads. A larger maximum, such as 10 GB, must be supported only through a verified multipart-upload path.

Make clear that the R2 free storage allowance is finite and that usage beyond free quotas may incur charges.

The application's intended operating budget is zero, so implement configurable quotas, storage monitoring, conservative defaults, and fail-closed behavior when limits are exceeded.

Never silently enable paid services.

## 6. Data Model

Design D1 tables with appropriate constraints, indexes, timestamps, and migration files.

At minimum, include:

### files

- Internal ID
- Random public ID
- R2 object key
- Original filename
- Sanitized display filename
- Content type
- File size
- Optional checksum
- Creation timestamp
- Expiration timestamp
- Maximum download count
- Successful download count
- Encryption-detection status
- Malware-scanning status
- Lifecycle status
- Deletion timestamp
- Optional revocation timestamp

### upload_sessions

- Session ID
- R2 multipart upload ID, when applicable
- Object key
- Expected size
- Uploaded size or part metadata
- Creation timestamp
- Session expiration timestamp
- Status

### download_grants

Use only if needed by the selected authorization model.

Include:

- Grant ID
- File ID
- Expiration timestamp
- Reservation or completion status
- Relevant concurrency-control metadata

### abuse_reports

- Report ID
- Public file ID
- Reporter contact, if voluntarily supplied
- Reason
- Submission timestamp
- Moderation status

Avoid collecting personal data without a concrete operational need.

Explain how atomic updates and indexes prevent race conditions and expensive table scans.

## 7. API Design

Define and implement a versioned API.

Include at least:

- `PUT /` — simple CLI upload.
- `POST /api/uploads` — browser upload initiation or small-file upload.
- `POST /api/uploads/:id/complete` — validate and finalize an upload.
- `POST /api/uploads/:id/multipart` — initiate multipart upload when required.
- `POST /api/uploads/:id/multipart/parts/:partNumber` — obtain a narrowly scoped upload URL or equivalent part authorization.
- `POST /api/uploads/:id/multipart/complete` — finalize multipart upload.
- `POST /api/uploads/:id/multipart/abort` — abort an incomplete upload.
- `GET /api/files/:id` — return safe, non-sensitive file metadata.
- `GET /:id/:filename` — download or initiate an authorized download.
- `HEAD /:id/:filename` — handle metadata requests without consuming a download allowance.
- `POST /api/reports` — report abuse.
- `GET /healthz` — minimal health endpoint.

You may adjust the exact routes if the implementation requires a better API design.

For every endpoint, document:

- Purpose
- HTTP method
- Request schema
- Response schema
- Authentication or authorization requirements
- Rate limits
- Expected status codes
- Error responses
- Idempotency behavior

Use consistent JSON errors, such as:

    {
      "success": false,
      "error": {
        "code": "FILE_EXPIRED",
        "message": "This file is no longer available."
      }
    }

Never return stack traces, internal object keys, secrets, or raw database errors to clients.

## 8. Frontend UX and Visual Design

Create an original, professional, developer-oriented design for free-locker.

Visual direction:

- Minimal and functional.
- Clear typography.
- Restrained colors.
- Responsive layout.
- Accessible contrast.
- No intrusive advertising.
- No mandatory account creation.
- No unnecessary dashboards or complicated onboarding.

The homepage should prominently show:

- Drag-and-drop upload area.
- CLI upload command.
- Retention policy.
- Maximum supported file size.
- Upload progress.
- Generated download link and copy action.

Provide appropriate pages and states for:

- Uploading
- Upload complete
- Upload failure
- Downloading
- Expired file
- Exhausted download allowance
- Missing or revoked file
- Rate limit exceeded
- Storage quota reached
- Unsupported upload size

Ensure the design remains usable without JavaScript-dependent animations.

## 9. Security Requirements

Implement and test:

- Server-side input validation.
- Cryptographically secure random public IDs.
- Secure object-key generation.
- Private R2 storage.
- Least-privilege access to storage and database resources.
- Short-lived presigned URLs.
- Safe Content-Disposition handling.
- No unsafe inline rendering of uploaded content.
- Appropriate CORS restrictions.
- CSRF protection where relevant.
- Rate limiting and abuse controls.
- Download-limit concurrency handling.
- Expiration checks before granting access.
- Protection against duplicate completion requests.
- Idempotent cleanup jobs.
- Secret management through Wrangler secrets or supported secret bindings.
- No credentials committed to source control.
- No logging of presigned URLs or sensitive tokens.
- Safe error responses.
- A documented threat model.

Use a vetted cryptographic library or Web Crypto APIs as appropriate. Do not invent custom encryption.

## 10. Testing Requirements

Provide automated tests for:

- Successful browser upload.
- Successful CLI PUT upload.
- JSON response negotiation.
- Correct filenames and download headers.
- Multiple independent file uploads.
- Expiration after 24 hours.
- Deletion or blocking after five successful downloads.
- Single-download encrypted archive behavior.
- Concurrent download requests.
- Invalid and oversized uploads.
- Malformed filenames and path traversal attempts.
- Missing files and revoked files.
- Rate limiting.
- Upload-session expiration.
- Multipart upload completion and abortion.
- Cleanup retries.
- Unauthorized access to private objects.
- API error handling.
- D1 migration correctness.

Use fake timers or injectable clocks for expiration tests.

Test locally with Wrangler and the appropriate Cloudflare development bindings. Clearly distinguish local emulation tests from tests that require a real Cloudflare account.

## 11. Deployment and Operations

Provide a complete, reproducible deployment guide for Cloudflare Free.

The guide must include:

1. Required accounts and prerequisites.
2. Node.js and pnpm installation.
3. Project setup.
4. Wrangler authentication.
5. D1 database creation.
6. R2 bucket creation.
7. D1 migrations.
8. R2 binding configuration.
9. Worker and Static Assets configuration.
10. Cron Trigger configuration.
11. Custom domain and DNS configuration.
12. Required secrets and environment variables.
13. Local development.
14. Unit and integration tests.
15. Preview deployment.
16. Production deployment.
17. Rollback and recovery procedures.
18. Monitoring and quota checks.
19. Storage cleanup and incident handling.

Use infrastructure configuration files wherever possible.

Provide actual commands and example configuration, not only a conceptual checklist.

Separate development and production resources.

Never hardcode account IDs, credentials, production domains, or secrets.

Provide a `.dev.vars.example` file containing placeholders only.

Include a GitHub Actions workflow for linting, type checking, testing, and deployment. Production deployment must use repository secrets and must not run automatically from untrusted pull requests.

## 12. Required Deliverables

Produce the following deliverables in order:

1. A concise system architecture and explanation of major design decisions.
2. A complete feature inventory with MVP, later phase, and unsupported labels.
3. An explicit Cloudflare Free-tier feasibility assessment.
4. Architecture diagrams using Mermaid.
5. A threat model and security decisions.
6. A D1 schema and migration files.
7. API specifications and error schemas.
8. A repository tree.
9. A working frontend and backend implementation.
10. Wrangler and Cloudflare resource configuration.
11. Automated tests.
12. Local development and deployment documentation.
13. A quota and cost-monitoring plan.
14. A list of known limitations and future improvements.

Do not stop after generating architecture diagrams or sample code.

Implement a coherent, runnable MVP with real Cloudflare bindings and real upload/download workflows.

Do not replace real functionality with mock responses, placeholder buttons, fake progress, or hardcoded download links.

If a capability cannot be completed because of a platform limitation or missing external service, document the limitation and implement the safest useful alternative.

## 13. Implementation Workflow

Work incrementally:

Phase 1: Inspect current Cloudflare documentation and finalize architecture.

Phase 2: Scaffold the monorepo, configure TypeScript, and create D1 migrations.

Phase 3: Implement metadata management, upload authorization, and secure download behavior.

Phase 4: Implement the browser upload experience.

Phase 5: Implement the CLI-compatible PUT endpoint and JSON responses.

Phase 6: Add multipart upload support for large files.

Phase 7: Implement expiration, download limits, cleanup, and abuse reporting.

Phase 8: Add tests, security headers, documentation, and CI/CD.

Phase 9: Validate the complete workflow locally and against a test Cloudflare environment where credentials are available.

After each phase, run relevant checks and report failures.

Do not claim that deployment or live integration tests succeeded unless they actually ran successfully.

## 14. Acceptance Criteria

The MVP is acceptable when:

- A visitor can upload a file from a browser without registering.
- A CLI user can upload a file with `curl -T`.
- The CLI receives a valid, immediately usable download URL.
- JSON output can be consumed by scripts.
- Authorized recipients can download files.
- Expired or exhausted shares cannot be accessed.
- Download limits are enforced according to documented semantics.
- R2 objects and D1 records are cleaned up safely.
- The frontend and backend deploy using Cloudflare-native services.
- The project can be developed and tested locally.
- No paid service is silently required.
- Platform limitations, quota risks, and malware-scanning limitations are documented.
- The repository contains reproducible setup and deployment instructions.

Begin by inspecting the official reference pages and current Cloudflare documentation. Present the architecture and feasibility assessment before writing code. Then implement the project incrementally, prioritizing a working, secure, free-tier-compatible MVP.
