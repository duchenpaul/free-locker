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
