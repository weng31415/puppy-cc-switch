#!/usr/bin/env bash
set -euo pipefail

assets=${1:?expected a release-assets directory}
: "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}" "${R2_ACCOUNT_ID:?}" "${R2_BUCKET:?}"
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
bucket="s3://${R2_BUCKET}"
backup="release-manifest-backups/${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
public_base=$(jq -er '.platforms["windows-x86_64"].url | sub("/[^/]+$"; "")' "$assets/latest.json")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for feed in latest.json manual-latest.json; do
  aws s3 cp "$bucket/downloads/$feed" "$work/$feed" --endpoint-url "$endpoint"
  aws s3 cp "$work/$feed" "$bucket/$backup/$feed" --endpoint-url "$endpoint"
done

python3 - "$work/latest.json" "$assets/latest.json" <<'PY'
import json, sys
from pathlib import Path
def version(path):
    return tuple(map(int, json.loads(Path(path).read_text())["version"].split(".")))
if version(sys.argv[2]) < version(sys.argv[1]):
    sys.exit("A newer updater is already live")
PY

publish_immutable() {
  local asset=$1 name=$2 existing
  local key="downloads/$name"
  existing=$(aws s3api list-objects-v2 --endpoint-url "$endpoint" --bucket "$R2_BUCKET" \
    --prefix "$key" --max-keys 1 --query 'Contents[0].Key' --output text)
  if [[ "$existing" != "$key" ]]; then
    aws s3 cp "$asset" "$bucket/$key" --endpoint-url "$endpoint" \
      --cache-control "public, max-age=31536000, immutable"
  fi
  curl --fail --silent --show-error --location --retry 4 --retry-all-errors \
    --output "$work/download" "$public_base/$name"
  if ! cmp -s "$work/download" "$asset"; then
    echo "Public bytes do not match the verified release asset: $name" >&2
    return 1
  fi
}

for asset in "$assets"/PuppyRouter-App-*; do
  publish_immutable "$asset" "${asset##*/}"
done

# The portable client requests a ZIP by semantic version; release artifacts also carry the commit.
release=$(jq -er '.release' "$assets/manual-latest.json")
version=$(jq -er '.version' "$assets/latest.json")
for suffix in Windows-Portable.zip Windows-arm64-Portable.zip; do
  asset="$assets/PuppyRouter-App-$release-$suffix"
  alias_name="PuppyRouter-App-v$version-$suffix"
  if [[ -f "$asset" && "${asset##*/}" != "$alias_name" ]]; then
    publish_immutable "$asset" "$alias_name"
  fi
done

for feed in manual-latest.json latest.json; do
  aws s3 cp "$assets/$feed" "$bucket/downloads/$feed" --endpoint-url "$endpoint" \
    --cache-control "no-cache, max-age=60" --content-type "application/json"
done
