#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "$0")/../apps/worker"

bucket_name="${R2_BUCKET_NAME:-free-locker}"
config_path="${WRANGLER_CONFIG_PATH:-wrangler.jsonc}"
print_cloudflare_errors() {
  local response="$1"
  local errors

  errors="$(printf '%s' "${response}" | jq --raw-output '[.errors[]? | "\(.code // "unknown"): \(.message // "Unknown Cloudflare API error")"] | join("; ")')"
  if [ -n "${errors}" ]; then
    echo "Cloudflare API error: ${errors}" >&2
  fi
}

echo "Checking existing R2 multipart credentials on the Worker."
existing="$(pnpm exec wrangler secret list --config "${config_path}")"
has_access_key="$(printf '%s' "${existing}" | jq --raw-output '[.[].name] | index("R2_ACCESS_KEY_ID") != null')"
has_secret_key="$(printf '%s' "${existing}" | jq --raw-output '[.[].name] | index("R2_SECRET_ACCESS_KEY") != null')"

if [ "${has_access_key}" = "true" ] && [ "${has_secret_key}" = "true" ]; then
  echo "R2 multipart credentials already present on the Worker."
  exit 0
fi

if [ "${has_access_key}" = "true" ] || [ "${has_secret_key}" = "true" ]; then
  echo "R2 multipart credentials are incomplete; remove both Worker secrets before provisioning a replacement pair." >&2
  exit 1
fi

api="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"
auth=(--header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" --header "Content-Type: application/json")

echo "Looking up the R2 bucket write permission group."
echo "Executing: curl --fail-with-body --silent --show-error --header 'Authorization: Bearer [redacted]' --header 'Content-Type: application/json' '${api}/tokens/permission_groups'"
permission_groups="$(curl --fail-with-body --silent --show-error "${auth[@]}" "${api}/tokens/permission_groups")" || {
  echo "Unable to list Cloudflare API token permission groups. Verify that CLOUDFLARE_API_TOKEN has User API Tokens: Edit permission for this account." >&2
  print_cloudflare_errors "${permission_groups}"
  exit 1
}
group_id="$(printf '%s' "${permission_groups}" | jq --raw-output '[.result[] | select(.name == "Workers R2 Storage Bucket Item Write") | .id][0]')"
if [ -z "${group_id}" ] || [ "${group_id}" = "null" ]; then
  echo "Permission group 'Workers R2 Storage Bucket Item Write' not found for this account." >&2
  exit 1
fi

policy="$(jq -n --arg account "${CLOUDFLARE_ACCOUNT_ID}" --arg bucket "${bucket_name}" --arg group "${group_id}" '{
  name: "free-locker-multipart",
  policies: [{
    effect: "allow",
    resources: {("com.cloudflare.edge.r2.bucket." + $account + "_default_" + $bucket): "*"},
    permission_groups: [{id: $group}]
  }]
}')"

echo "Creating a bucket-scoped R2 multipart API token for '${bucket_name}'."
echo "Executing: curl --fail-with-body --silent --show-error --request POST --header 'Authorization: Bearer [redacted]' --header 'Content-Type: application/json' --data '[redacted policy]' '${api}/tokens'"
token="$(curl --fail-with-body --silent --show-error --request POST "${auth[@]}" \
  --data "${policy}" "${api}/tokens")" || {
  echo "Unable to create the R2 multipart API token." >&2
  print_cloudflare_errors "${token}"
  exit 1
}

access_key_id="$(printf '%s' "${token}" | jq --raw-output '.result.id')"
secret_access_key="$(printf '%s' "${token}" | jq --join-output '.result.value' | sha256sum | cut --delimiter=' ' --fields=1)"

echo "Storing R2 multipart credentials on the Worker."
printf '%s' "${access_key_id}" | pnpm exec wrangler secret put R2_ACCESS_KEY_ID --config "${config_path}"
printf '%s' "${secret_access_key}" | pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY --config "${config_path}"
echo "R2 multipart credentials provisioned successfully."
