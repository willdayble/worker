#!/usr/bin/env bash
# Fail if any Supabase migration uses a permissive RLS policy.
# Rationale: the first_attempt schema shipped `WITH CHECK (true)` (001:185) and
# `USING (true)` (015:45), which let a leaked key read/insert across tenants.
# CONTRACTS §5 forbids these; this guard enforces it in pre-commit and CI.
set -euo pipefail

DIR="supabase/migrations"
if [ ! -d "$DIR" ]; then
  echo "check-rls: no $DIR yet — skipping."
  exit 0
fi

# Match WITH CHECK (true) or USING (true), tolerant of whitespace/case.
if grep -rniE '(with[[:space:]]+check|using)[[:space:]]*\([[:space:]]*true[[:space:]]*\)' "$DIR"; then
  echo ""
  echo "ERROR: permissive RLS policy found above (WITH CHECK (true) / USING (true))."
  echo "Every policy must constrain to the row's user_id. See docs/CONTRACTS.md §5."
  exit 1
fi

echo "check-rls: passed (no permissive policies)."
