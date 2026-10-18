#!/usr/bin/env bash
# Applies version-pinned patches to the vendored OpenSpec CLI (vendor/OpenSpec).
#
# Pin: Fission-AI/OpenSpec v1.14.3 @ c794978f4f8845ce59693373c9dd882ee776588c
# Patch 2117: `openspec new change` must report and persist the RESOLVED schema
#   (config.yaml's schema:), not the raw --schema flag (undefined when omitted).
#   Upstream issue: https://github.com/Fission-AI/OpenSpec/issues/2117
#
# Idempotent: exits 0 without touching anything if already applied.
# If the context no longer matches, upstream moved past the pin: rebase the
# patch (see README section "Patching the vendored CLI") and update the pin.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
vendor="$root/vendor/OpenSpec"
patch_file="$root/patches/openspec-2117-new-change-schema-label_v1.14.3.patch"
target="src/commands/workflow/new-change.ts"

[ -d "$vendor" ] || { echo "patch 2117: vendor/OpenSpec missing - clone and build it first (README: 'Smoke tests')"; exit 1; }

if grep -q 'projectConfig?.schema' "$vendor/$target"; then
  echo "patch 2117: already applied"
  exit 0
fi

git -C "$vendor" apply --check "$patch_file" 2>/dev/null || {
  echo "patch 2117: context mismatch - upstream moved past v1.14.3 @ c794978f; rebase the patch (README: 'Patching the vendored CLI')"
  exit 1
}
git -C "$vendor" apply "$patch_file"
echo "patch 2117: applied - rebuild the CLI with: (cd vendor/OpenSpec && pnpm build)"
