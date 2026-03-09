#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="/Users/apple/Documents/New project/.openclaw/workspace"
TARGET_ROOT="/Users/apple/Library/Mobile Documents/iCloud~md~obsidian/Documents/OpenClaw"

DAILY_DIR="$TARGET_ROOT/Daily"
MEMORY_DIR="$TARGET_ROOT/Memory"
CONTEXT_DIR="$TARGET_ROOT/Context"
ARCHIVE_DIR="$TARGET_ROOT/Archive"

mkdir -p "$DAILY_DIR" "$MEMORY_DIR" "$CONTEXT_DIR" "$ARCHIVE_DIR"

sync_if_exists() {
  local src="$1"
  local dest_dir="$2"

  if [[ -e "$src" ]]; then
    cp "$src" "$dest_dir/"
  fi
}

if [[ -d "$SOURCE_ROOT/memory" ]]; then
  find "$SOURCE_ROOT/memory" -maxdepth 1 -type f -name '*.md' -print0 | while IFS= read -r -d '' file; do
    cp "$file" "$MEMORY_DIR/"
  done
fi

sync_if_exists "$SOURCE_ROOT/MEMORY.md" "$MEMORY_DIR"
sync_if_exists "$SOURCE_ROOT/USER.md" "$CONTEXT_DIR"
sync_if_exists "$SOURCE_ROOT/IDENTITY.md" "$CONTEXT_DIR"

printf 'Synced allowed OpenClaw files into %s\n' "$TARGET_ROOT"
