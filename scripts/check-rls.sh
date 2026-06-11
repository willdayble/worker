#!/usr/bin/env bash
# Fail if any Supabase migration uses a permissive RLS policy.
# Rationale: the first_attempt schema shipped `WITH CHECK (true)` (001:185) and
# `USING (true)` (015:45), which let a leaked key read/insert across tenants.
# CONTRACTS §5 forbids these; this guard enforces it in pre-commit and CI.
#
# Only actual SQL is inspected: `--` line comments are stripped before matching,
# so documentation that *names* the forbidden pattern (like this file, or a
# migration's header) does not trip the guard. Line numbers stay accurate.
set -euo pipefail

DIR="supabase/migrations"
if [ ! -d "$DIR" ]; then
  echo "check-rls: no $DIR yet — skipping."
  exit 0
fi

PATTERN='(with[[:space:]]+check|using)[[:space:]]*\([[:space:]]*true[[:space:]]*\)'
found=0

while IFS= read -r file; do
  # Strip everything from the first `--` to end-of-line (keeps line numbering),
  # then grep the comment-free SQL. `nl`-style prefix keeps file:line context.
  if matches=$(sed 's/--.*$//' "$file" | grep -niE "$PATTERN"); then
    found=1
    while IFS= read -r m; do
      echo "$file:$m"
    done <<< "$matches"
  fi
done < <(find "$DIR" -type f -name '*.sql')

if [ "$found" -eq 1 ]; then
  echo ""
  echo "ERROR: permissive RLS policy found above (WITH CHECK (true) / USING (true))."
  echo "Every policy must constrain to the row's user_id. See docs/CONTRACTS.md §5."
  exit 1
fi

echo "check-rls: passed (no permissive policies)."
