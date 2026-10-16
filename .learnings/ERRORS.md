## [ERR-20261015-001] terminal_runner_partial_install_output

**Logged**: 2026-10-15T00:00:00Z  **Priority**: low  **Status**: resolved  **Area**: config

### Summary
The terminal wrapper returned partial or empty output for synchronous `pnpm install` commands before a lockfile appeared.

### Details
Dependency resolution began but did not produce `pnpm-lock.yaml`; the returned terminal identifier was not an active background session when queried.

### Suggested Action
Confirm package-manager completion using an explicit filesystem check before treating a quiet terminal result as success.

### Resolution
- **Resolved**: 2026-10-15T00:00:00Z
- **Notes**: pnpm had completed resolution but blocked the required `esbuild` and `workerd` build scripts. Current pnpm uses an `allowBuilds` map in `pnpm-workspace.yaml`; a partial install had also inserted a duplicate placeholder map, which was removed before retrying.

### Metadata
- Source: error
- Related Files: package.json, pnpm-workspace.yaml
- Tags: terminal, pnpm, validation

## [ERR-20261015-002] terminal_runner_discards_nested_cd

**Logged**: 2026-10-15T00:00:00Z  **Priority**: low  **Status**: pending  **Area**: config

### Summary
The terminal runner simplified a nested `cd` command and executed Wrangler from the repository root.

### Details
`wrangler dev` did not find the Worker configuration because the wrapper discarded the command's directory change.

### Suggested Action
Use package scripts or explicit Wrangler `--config` paths when commands need a package-local working directory.

### Metadata
- Source: error
- Related Files: apps/worker/wrangler.jsonc
- Tags: terminal, wrangler, validation

## [ERR-20261016-001] github_token_cannot_update_environment_variables

**Logged**: 2026-10-16T00:00:00Z  **Priority**: medium  **Status**: resolved  **Area**: config

### Summary
The deployment workflow created a D1 database but could not persist its ID to a GitHub environment variable with `GITHUB_TOKEN`.

### Details
`gh variable set D1_DATABASE_ID --env prod` failed with HTTP 403, "Resource not accessible by integration", after Cloudflare resource provisioning succeeded.

### Suggested Action
Resolve Cloudflare resources with Wrangler on every deployment and deploy their bindings/runtime variables directly to the Worker; do not persist resource identifiers through the GitHub environment-variable API.

### Resolution
- **Resolved**: 2026-10-16T00:00:00Z
- **Notes**: Removed `gh variable set` and its workflow inputs. The provisioning script now resolves D1 and R2 by name and writes a generated Wrangler config for deployment.

### Metadata
- Source: error
- Related Files: .github/workflows/deploy.yml, deploy/provision-worker-resources.sh
- Tags: github-actions, cloudflare, wrangler, deployment

## [ERR-20261016-002] prettier_has_no_shell_parser

**Logged**: 2026-10-16T00:00:00Z  **Priority**: low  **Status**: resolved  **Area**: tests

### Summary
Prettier cannot validate deployment shell scripts because the repository has no shell parser configured.

### Details
`pnpm exec prettier --check deploy/provision-worker-resources.sh` exited with "No parser could be inferred" after shell syntax validation had passed.

### Suggested Action
Validate shell scripts with `bash -n`; run Prettier only for supported file types.

### Resolution
- **Resolved**: 2026-10-16T00:00:00Z
- **Notes**: Validation commands now scope Prettier to YAML, JSONC, TypeScript, and Markdown files.

### Metadata
- Source: error
- Related Files: deploy/provision-worker-resources.sh
- Tags: prettier, bash, validation
