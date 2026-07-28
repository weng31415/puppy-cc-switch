#!/usr/bin/env bash

set -euo pipefail

deb_path="${1:-}"
if [ -z "$deb_path" ] || [ ! -f "$deb_path" ]; then
  echo "Usage: $0 <path-to-deb>" >&2
  exit 2
fi

deb_path="$(cd "$(dirname "$deb_path")" && pwd)/$(basename "$deb_path")"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

(
  cd "$work_dir"
  ar x "$deb_path"
)

data_archive="$(find "$work_dir" -maxdepth 1 -type f -name 'data.tar.*' -print -quit)"
if [ -z "$data_archive" ]; then
  echo "DEB validation failed: data archive not found in $deb_path" >&2
  exit 1
fi

mkdir -p "$work_dir/root"
tar -xf "$data_archive" -C "$work_dir/root"

binary_path="$work_dir/root/usr/bin/puppyrouter-app"
if [ ! -f "$binary_path" ]; then
  echo "DEB validation failed: usr/bin/puppyrouter-app not found" >&2
  exit 1
fi

if LC_ALL=C grep -aFq '__TAURI_BUNDLE_TYPE_VAR_UNK' "$binary_path"; then
  echo "DEB validation failed: Tauri bundle type is still UNK" >&2
  exit 1
fi

if ! LC_ALL=C grep -aFq '__TAURI_BUNDLE_TYPE_VAR_DEB' "$binary_path"; then
  echo "DEB validation failed: Tauri DEB bundle marker not found" >&2
  exit 1
fi

echo "Verified Tauri DEB bundle marker in $(basename "$deb_path")"
