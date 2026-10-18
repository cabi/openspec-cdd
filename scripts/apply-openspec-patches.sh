#!/usr/bin/env bash
# Applies every version-pinned patch in patches/ to the vendored OpenSpec CLI
# (vendor/OpenSpec).
#
# Pins: Fission-AI/OpenSpec v1.14.3 @ c794978f4f8845ce59693373c9dd882ee776588c
# Patches:
#   openspec-2117-new-change-schema-label_v1.14.3.patch
#     `new change` must report and persist the RESOLVED schema (config.yaml's
#     schema:), not the raw --schema flag. Upstream #2117.
#   openspec-archive-skill-lean_v1.14.3.patch
#     replaces the generated openspec-archive-change skill with the lean-verified
#     one (mechanical finish step, archive+commit as one stop, frozen history).
#
# Idempotent: a patch that is already applied (reverse applies cleanly) is
# skipped. If a patch neither applies nor reverse-applies, upstream moved past
# the pin: rebase it (README: 'Patching the vendored CLI') and update the pins.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
vendor="$root/vendor/OpenSpec"

[ -d "$vendor" ] || { echo "patches: vendor/OpenSpec missing - clone and build it first (README: 'Smoke tests')"; exit 1; }

applied=0
skipped=0
for patch_file in "$root"/patches/*.patch; do
  name="$(basename "$patch_file" .patch)"
  if git -C "$vendor" apply --check --reverse "$patch_file" 2>/dev/null; then
    echo "patch $name: already applied"
    skipped=$((skipped + 1))
    continue
  fi
  if git -C "$vendor" apply --check "$patch_file" 2>/dev/null; then
    git -C "$vendor" apply "$patch_file"
    echo "patch $name: applied"
    applied=$((applied + 1))
  else
    echo "patch $name: context mismatch - upstream moved past v1.14.3 @ c794978f; rebase the patch (README: 'Patching the vendored CLI')"
    exit 1
  fi
done

echo "patches: $applied applied, $skipped already in place"
if [ "$applied" -gt 0 ] && git -C "$vendor" diff --name-only -- src | grep -q .; then
  echo "patches: src/ changed - rebuild the CLI with: (cd vendor/OpenSpec && pnpm build)"
fi
