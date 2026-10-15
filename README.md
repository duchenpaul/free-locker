# free-locker

Temporary, account-free file sharing for browsers, terminals, and CI. Built with Cloudflare Workers, D1, and private R2 storage.

## Local development

```sh
pnpm install --frozen-lockfile
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm dev
```

Frontend: `http://127.0.0.1:5173`

Worker: `http://127.0.0.1:8787`

## Configuration

Update product defaults in `config/transfer.defaults.json`. Use `apps/worker/.dev.vars` for local overrides only; never commit secrets.

## GitHub Actions deployment

Configure the GitHub `production` environment with the following variables and secrets.

### Variables

| Name | Used for | How to set |
|------|----------|------------|
| `PUBLIC_BASE_URL` | Base URL used to build download links (e.g. `https://files.example.com`) | Your deployment's public URL |
| `RETENTION_HOURS` | Hours before a transfer expires (default 24) | Any positive integer |
| `MAX_DOWNLOADS` | Download authorizations per file (default 5) | Any positive integer |
| `FILE_LISTING_MODE` | Public file listing: `enabled`, `hidden`, or `disabled` | One of the three values |
| `RUNTIME_MODE` | Deployment target: `cloudflare` (Worker) or `local` | `cloudflare` for this workflow |

### Secrets

| Name | Used for | How to generate |
|------|----------|-----------------|
| `CLOUDFLARE_API_TOKEN` | Deploys the Worker and applies D1 migrations | Cloudflare dashboard → My Profile → API Tokens → create token with the **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account to deploy into | Cloudflare dashboard → Workers & Pages → Account ID (right sidebar) |
| `IP_HASH_SALT` | Salt for non-reversible upload-IP hashing (abuse prevention) | `openssl rand -hex 32` |
| `ADMIN_TOKEN` | Bearer token for admin endpoints (e.g. revoking files from the file browser) | `openssl rand -hex 32` |
| `R2_ACCOUNT_ID` | Account ID for R2 S3-compatible API (multipart upload signing) | Same value as `CLOUDFLARE_ACCOUNT_ID` |
| `R2_ACCESS_KEY_ID` | Access key for R2 multipart uploads | R2 section → Manage API Tokens → create with **Object Read & Write**, scoped to the `free-locker` bucket |
| `R2_SECRET_ACCESS_KEY` | Secret key paired with `R2_ACCESS_KEY_ID` | Shown once when creating the R2 API token — store it immediately |

Pass Worker configuration through Wrangler `--var` flags. Keep all secrets out of Git and do not pass them with `--var`.

## Upload and download

```sh
curl http://localhost:8787/ -T ./file.zip
curl -L -O <url>
```

## Commands

```sh
just check
just build
just test-worker
just test-web
just test-cli
just test-integration
```

## Docs

- [Architecture](docs/architecture.md)
- [API](docs/api.md)
- [Deployment](docs/deployment.md)
- [Security](docs/security.md)
