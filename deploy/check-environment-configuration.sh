#!/usr/bin/env bash

set -euo pipefail

required_secrets=(CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID IP_HASH_SALT)
required_vars=(PUBLIC_BASE_URL RETENTION_HOURS MAX_DOWNLOADS FILE_LISTING_MODE RUNTIME_MODE)
# Optional Worker overrides; defaults mirror config/transfer.defaults.json.
optional_vars=(
  MAX_SINGLE_UPLOAD_BYTES=99614720
  FILE_LISTING_MAX_ROWS=100
  DOWNLOAD_GRANT_TTL_SECONDS=600
  UPLOAD_RATE_LIMIT_PER_HOUR=20
)

missing=()
for name in "${required_secrets[@]}" "${required_vars[@]}"; do
  if [ -z "${!name:-}" ]; then
    missing+=("${name}")
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "Missing required GitHub environment configuration (${GITHUB_ENVIRONMENT:-prod} environment):" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi

echo "GitHub environment variables:"
for name in "${required_vars[@]}"; do
  echo "  ${name}=${!name}"
done
for entry in "${optional_vars[@]}"; do
  name="${entry%%=*}"
  value="${!name:-}"
  if [ -n "${value}" ]; then
    echo "  ${name}=${value}"
  else
    echo "  ${name}=unset (default ${entry#*=})"
  fi
done

echo "GitHub secrets (presence only):"
for name in "${required_secrets[@]}"; do
  echo "  ${name}=set"
done
if [ -n "${ADMIN_TOKEN:-}" ]; then
  echo "  ADMIN_TOKEN=set"
else
  echo "  ADMIN_TOKEN=not set (optional)"
fi
