# Deployment

## Prerequisites

- A Cloudflare account with Workers, D1, and R2 enabled.
- Node 22.17+ and pnpm 11.1+.
- A private R2 bucket and a D1 database for each environment.
- A GitHub repository if using the included workflows.

Cloudflare Free resources are bounded. Current documented limits include 100,000 Worker requests/day, 10 ms CPU/request, a 100 MB Free-zone request-body limit, 500 MB per D1 database, and R2's separate free storage/operation allowances. Review current Cloudflare documentation before deployment because limits and pricing change.

## Create resources

```sh
pnpm install --frozen-lockfile
pnpm --filter @free-locker/worker exec wrangler login
pnpm --filter @free-locker/worker exec wrangler d1 create free-locker
pnpm --filter @free-locker/worker exec wrangler r2 bucket create free-locker
```

Copy the returned D1 database ID into `apps/worker/wrangler.jsonc`. Use separate names and IDs for preview/development and production environments; do not point local development at production resources.

Apply R2 browser-upload CORS after replacing the example origins:

```sh
pnpm --filter @free-locker/worker exec wrangler r2 bucket cors set free-locker --file ../../config/r2-cors.example.json
```

Keep the R2 bucket private. Do not enable `r2.dev` or public bucket access for transfer objects.

## Secrets

Set secrets interactively or through a protected deployment environment. Do not place values in `wrangler.jsonc`, `.dev.vars.example`, or Git.

```sh
pnpm --filter @free-locker/worker exec wrangler secret put ADMIN_TOKEN
pnpm --filter @free-locker/worker exec wrangler secret put IP_HASH_SALT
```

## Local development

Edit `config/transfer.defaults.json` to set checked-in product defaults such as the 24-hour retention period, five-download allowance, and 95 MiB per-file upload limit. Uploads above the limit are rejected with `413 Payload Too Large`. `MAX_*` values in `.dev.vars` or Wrangler environments are optional per-environment overrides; secrets still belong only in `.dev.vars` or Worker secrets.

`fileListingMode` defaults to `disabled`. Set it to `enabled` to expose a Files link on the homepage, or `hidden` to allow the direct `/file_browser` route without navigation. The listing includes uploader IP addresses as requested, so treat either non-disabled mode as an intentional privacy disclosure.

```sh
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm --filter @free-locker/worker exec wrangler d1 migrations apply free-locker --local
pnpm dev
```

Build production assets and dry-run the Worker before every release:

```sh
pnpm --filter @free-locker/web build
pnpm --filter @free-locker/worker build
```

## Production deployment

```sh
pnpm check
pnpm --filter @free-locker/web build
pnpm --filter @free-locker/worker exec wrangler d1 migrations apply free-locker --remote --config wrangler.jsonc
pnpm --filter @free-locker/worker exec wrangler deploy --config wrangler.jsonc
```

Attach a custom domain through Workers and set `PUBLIC_BASE_URL` to its HTTPS origin. A Workers.dev subdomain also works for testing. Verify that the deployed Worker fails closed if the daily Workers quota is exhausted; a security-sensitive route must not fall through to an unprotected origin.

## GitHub Actions

The workflow deploys through the GitHub `prod` environment. It first deploys a
minimal Worker that returns `503 Service Unavailable`, with the expected
`D1_DATABASE_NAME` and `R2_BUCKET_NAME` stored as Cloudflare plaintext runtime
variables. The workflow reads those values from the active Cloudflare Worker
version, uses Wrangler to verify or create the R2 bucket and D1 database, then
writes a production-only Wrangler config containing the resolved bindings. This
means every deployment has a short, intentional service interruption while the
database migration runs.

It synchronizes the following GitHub environment secrets to the production
Worker:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `ADMIN_TOKEN` (optional)
- `IP_HASH_SALT`

Its production order is:

1. Deploy the bootstrap Worker and its Cloudflare runtime metadata.
2. Read `D1_DATABASE_NAME` and `R2_BUCKET_NAME` from the active Cloudflare Worker version, then verify or create R2 and D1 resources with Wrangler.
3. Apply D1 migrations.
4. Deploy the Worker and static assets with the resolved D1/R2 bindings and runtime metadata.
5. Synchronize Worker secrets.

Configure the following non-secret GitHub environment variables in `prod`. The
workflow passes them to Wrangler as Worker variables:

- `PUBLIC_BASE_URL=https://free-locker.noob.pp.ua`
- `RETENTION_HOURS=24`
- `MAX_DOWNLOADS=5`
- `MAX_SINGLE_UPLOAD_BYTES=99614720` (optional, defaults to 95 MiB; larger uploads get `413 Payload Too Large`)
- `FILE_LISTING_MODE=enabled`
- `RUNTIME_MODE=cloudflare`

The workflow does not persist resource identifiers in GitHub. The bootstrap
Worker stores the resource names in Cloudflare; the final Worker stores
`D1_DATABASE_NAME`, `D1_DATABASE_ID`, and `R2_BUCKET_NAME` there as runtime
variables. R2 buckets are identified by name rather than a UUID. The default
R2 bucket name is `free-locker`.

Grant the deployment API token Account-level R2 Storage `Edit` and User-level API
Tokens `Edit` in addition to the Workers Scripts, D1, and Account Settings
permissions. The deploy workflow runs only
on `main` pushes or manual dispatch, never on pull requests. Require environment
approval for production.

## Rollback

Use the Workers dashboard or Wrangler versions to promote a previous Worker version. Do not roll back a D1 schema migration by deleting active metadata. Apply a forward migration or restore through a documented database recovery process after first testing it against a copy.
