#!/usr/bin/env bash

set -euo pipefail

required=(
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_API_TOKEN
  GITHUB_OUTPUT
)

for name in "${required[@]}"; do
  if [ -z "${!name:-}" ]; then
    echo "${name} must be set." >&2
    exit 1
  fi
done

worker_dir="$(cd "$(dirname "$0")/../apps/worker" && pwd)"
worker_name="${WORKER_NAME:-free-locker}"
api="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${worker_name}"

deployments="$(
  curl --fail-with-body --silent --show-error \
    --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "${api}/deployments?per_page=1"
)"
version_id="$(printf '%s' "${deployments}" | jq --raw-output '
  .result.deployments[0].versions
  | map(select(.percentage > 0))[0].version_id // empty
')"

if [ -z "${version_id}" ]; then
  echo "Could not resolve the active Worker version for ${worker_name}." >&2
  exit 1
fi

version="$(
  curl --fail-with-body --silent --show-error \
    --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "${api}/versions/${version_id}"
)"
bindings="$(printf '%s' "${version}" | jq '.result.resources.bindings // []')"

binding_text() {
  local binding_name="$1"

  printf '%s' "${bindings}" | jq --raw-output --arg name "${binding_name}" '
    [.[] | select(.name == $name and .type == "plain_text") | .text][0] // empty
  '
}

database_name="$(binding_text D1_DATABASE_NAME)"
bucket_name="$(binding_text R2_BUCKET_NAME)"

if [ -z "${database_name}" ] || [ -z "${bucket_name}" ]; then
  echo "Active Worker version must define D1_DATABASE_NAME and R2_BUCKET_NAME as plaintext bindings." >&2
  exit 1
fi

cd "${worker_dir}"

if pnpm exec wrangler r2 bucket info "${bucket_name}" --json >/dev/null; then
  echo "Using existing R2 bucket ${bucket_name}."
else
  echo "Creating R2 bucket ${bucket_name}."
  pnpm exec wrangler r2 bucket create "${bucket_name}" >/dev/null
  pnpm exec wrangler r2 bucket info "${bucket_name}" --json >/dev/null
fi

d1_databases="$(pnpm exec wrangler d1 list --json)"
database_id="$(printf '%s' "${d1_databases}" | jq -r \
  --arg name "${database_name}" \
  '[.[] | select(.name == $name) | .uuid][0] // empty')"

if [ -z "${database_id}" ]; then
  echo "Creating D1 database ${database_name}."
  pnpm exec wrangler d1 create "${database_name}" >/dev/null
  database_id="$(pnpm exec wrangler d1 list --json | jq -r \
    --arg name "${database_name}" \
    '[.[] | select(.name == $name) | .uuid][0] // empty')"
fi

if [ -z "${database_id}" ]; then
  echo "Could not resolve the D1 database ID for ${database_name}." >&2
  exit 1
fi

config_path="wrangler.production.jsonc"
escaped_database_name="$(printf '%s' "${database_name}" | sed 's/[\\&/]/\\&/g')"
escaped_database_id="$(printf '%s' "${database_id}" | sed 's/[\\&/]/\\&/g')"
escaped_bucket_name="$(printf '%s' "${bucket_name}" | sed 's/[\\&/]/\\&/g')"
sed \
  -e "s/00000000-0000-0000-0000-000000000000/${escaped_database_id}/g" \
  -e "s/\"database_name\": \"free-locker\"/\"database_name\": \"${escaped_database_name}\"/g" \
  -e "s/\"D1_DATABASE_NAME\": \"free-locker\"/\"D1_DATABASE_NAME\": \"${escaped_database_name}\"/g" \
  -e "s/\"D1_DATABASE_ID\": \"00000000-0000-0000-0000-000000000000\"/\"D1_DATABASE_ID\": \"${escaped_database_id}\"/g" \
  -e "s/\"bucket_name\": \"free-locker\"/\"bucket_name\": \"${escaped_bucket_name}\"/g" \
  -e "s/\"R2_BUCKET_NAME\": \"free-locker\"/\"R2_BUCKET_NAME\": \"${escaped_bucket_name}\"/g" \
  wrangler.jsonc > "${config_path}"

printf 'config_path=%s\n' "${config_path}" >> "${GITHUB_OUTPUT}"
printf 'd1_database_name=%s\n' "${database_name}" >> "${GITHUB_OUTPUT}"
printf 'd1_database_id=%s\n' "${database_id}" >> "${GITHUB_OUTPUT}"
printf 'r2_bucket_name=%s\n' "${bucket_name}" >> "${GITHUB_OUTPUT}"
