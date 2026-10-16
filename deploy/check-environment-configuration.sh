#!/usr/bin/env bash

set -euo pipefail

required_secrets=(CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID IP_HASH_SALT)
non_secret_vars=(PUBLIC_BASE_URL RETENTION_HOURS MAX_DOWNLOADS FILE_LISTING_MODE RUNTIME_MODE)

missing=()
for name in "${required_secrets[@]}" "${non_secret_vars[@]}"; do
  if [ -z "${!name:-}" ]; then
    missing+=("${name}")
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "Missing required GitHub environment configuration (${GITHUB_ENVIRONMENT:-prod} environment):" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi

echo "GitHub environment variables (non-secret):"
for name in "${non_secret_vars[@]}"; do
  echo "  ${name}=${!name}"
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
