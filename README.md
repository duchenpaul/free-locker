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

## Pre-commit install

To install the pre-commit hook, run:

```sh
just pre-commit-install
```

## Configuration

Update product defaults in `config/transfer.defaults.json`. Use `apps/worker/.dev.vars` for local overrides only; never commit secrets.

## Deploy to Cloudfare to GitHub Actions

Configure the GitHub `production` environment with the following variables and secrets.

### Variables

| Name                         | Mandatory | Used for                                                                 | How to set                     |
| ---------------------------- | --------- | ------------------------------------------------------------------------ | ------------------------------ |
| `PUBLIC_BASE_URL`            | Yes       | Base URL used to build download links (e.g. `https://files.example.com`) | Your deployment's public URL   |
| `RETENTION_HOURS`            | No        | Hours before a transfer expires (default 24)                             | Any positive integer           |
| `MAX_DOWNLOADS`              | No        | Download authorizations per file (default 5)                             | Any positive integer           |
| `MAX_MULTIPART_UPLOAD_BYTES` | No        | Multipart upload ceiling (default 10737418240 = 10 GiB)                  | Any positive integer (bytes)   |
| `MAX_SINGLE_UPLOAD_BYTES`    | No        | Per-file direct-upload limit (default 99614720 = 95 MiB)                 | Any positive integer (bytes)   |
| `FILE_LISTING_MODE`          | No        | Public file listing: `enabled`, `hidden`, or `disabled`                  | One of the three values        |
| `RUNTIME_MODE`               | Yes       | Deployment target: `cloudflare` (Worker) or `local`                      | `cloudflare` for this workflow |

### Secrets

| Name                    | Mandatory | Used for                                                                       | How to generate                                                                                   |
| ----------------------- | --------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Yes       | Deploys the Worker, applies D1 migrations, and creates the R2 bucket if needed | Cloudflare dashboard → My Profile → API Tokens → create a scoped token with the permissions below |
| `CLOUDFLARE_ACCOUNT_ID` | Yes       | Cloudflare account to deploy into                                              | Cloudflare dashboard → Workers & Pages → Account ID (right sidebar)                               |
| `IP_HASH_SALT`          | Yes       | Salt for non-reversible upload-IP hashing (abuse prevention)                   | `openssl rand -hex 32`                                                                            |
| `ADMIN_TOKEN`           | No        | Bearer token for admin endpoints (e.g. revoking files from the file browser)   | `openssl rand -hex 32`                                                                            |
| `R2_ACCOUNT_ID`         | No        | Account ID for R2 S3-compatible API (multipart upload signing)                 | Set automatically from `CLOUDFLARE_ACCOUNT_ID` by the deploy workflow                             |

The workflow creates the `free-locker` bucket when it is missing, then writes the
application secrets to the deployed Worker. The R2 multipart credentials
(`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`) are also provisioned automatically:
the deploy workflow checks the Worker's existing secrets and, when they are
missing, creates a bucket-scoped R2 API token through the Cloudflare API and
stores the derived access key and secret on the Worker.

### Cloudflare API permissions

Create `CLOUDFLARE_API_TOKEN` as an account-scoped token, limited to the production
account, with these permissions:

| Permission group | Permission       | Access | Why it is required                                          |
| ---------------- | ---------------- | ------ | ----------------------------------------------------------- |
| Account          | Workers Scripts  | Edit   | Uploads and activates the Worker and its static assets.     |
| Account          | D1               | Edit   | Applies the production D1 migrations.                       |
| Account          | R2 Storage       | Edit   | Checks for and creates the private `free-locker` R2 bucket. |
| Account          | Account Settings | Read   | Lets Wrangler read the account context used for deployment. |
| User             | API Tokens       | Edit   | Mints the bucket-scoped R2 multipart token at deploy time.  |

The deployment does not require an account-wide administrator token or DNS permissions.
Add Workers Routes `Edit` only if this workflow is later changed to manage Worker
routes or custom domains.

R2 credentials are required for multipart uploads (files larger than the Worker
direct-upload limit). The deploy workflow provisions them automatically when the
Worker does not already have them; until then, multipart uploads return a
configuration error to clients.

Pass Worker configuration through Wrangler `--var` flags. Keep all secrets out of Git and do not pass them with `--var`.

## Upload and download

```sh
curl http://localhost:8787/ -T ./file.zip
curl -L -O <url>
```

## Commands

```sh
just check
just format
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
