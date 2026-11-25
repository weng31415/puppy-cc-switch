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

for asset in "$assets"/PuppyRouter-App-*; do
  name=${asset##*/}
  key="downloads/$name"
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
    exit 1
  fi
done

for feed in manual-latest.json latest.json; do
  aws s3 cp "$assets/$feed" "$bucket/downloads/$feed" --endpoint-url "$endpoint" \
    --cache-control "no-cache, max-age=60" --content-type "application/json"
done
