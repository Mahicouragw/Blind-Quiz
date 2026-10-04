#!/usr/bin/env bash
# Deploy the blind-quiz-api Edge Function as ONE complete replacement.
#
#   bash scripts/deploy-function.sh            # deploy, then verify live
#   bash scripts/deploy-function.sh --no-verify # deploy only
#
# Requirements:
#   * Supabase CLI (`supabase` on PATH, otherwise npx supabase is used)
#   * SUPABASE_ACCESS_TOKEN exported in your shell (a Supabase personal access
#     token). This script never prints, logs, or stores it.
#
# What this does:
#   `supabase functions deploy` bundles the entire supabase/functions/<name>
#   directory and replaces the deployed version wholesale. It does NOT append to
#   or merge with whatever is currently deployed, which is what produced:
#     Uncaught SyntaxError: Identifier 'createClient' has already been declared
#     at index.ts:680:10
#
# What this never does:
#   No migration, db push, db reset, seed, or schema command of any kind.
#   Migrations 001-009 are already applied remotely and are left untouched.

set -euo pipefail
cd "$(dirname "$0")/.."

FUNCTION_NAME="blind-quiz-api"
PROJECT_REF="${SUPABASE_PROJECT_REF:-zchircgdkyjnowqcdwvf}"
RUN_VERIFY=1
[ "${1:-}" = "--no-verify" ] && RUN_VERIFY=0

echo "== Pre-flight: Edge Function source integrity =="
node --no-warnings scripts/check-function-source.mjs

LINES=$(wc -l < "supabase/functions/$FUNCTION_NAME/index.ts")
echo
echo "== Deployment plan =="
echo "  function     : $FUNCTION_NAME"
echo "  project ref  : $PROJECT_REF"
echo "  source       : supabase/functions/$FUNCTION_NAME/index.ts ($LINES lines)"
echo "  mode         : complete replacement (bundle upload, no appending)"
echo "  verify_jwt   : disabled (matches supabase/config.toml)"
echo "  migrations   : none - 001-009 are already applied and are not touched"
echo

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "ERROR: SUPABASE_ACCESS_TOKEN is not set in this shell." >&2
  echo "Export it first, e.g.:  export SUPABASE_ACCESS_TOKEN=\$(cat /path/to/token)" >&2
  echo "Create one at https://supabase.com/dashboard/account/tokens" >&2
  exit 1
fi

if command -v supabase >/dev/null 2>&1; then
  SUPABASE_CMD=(supabase)
else
  SUPABASE_CMD=(npx --yes supabase@latest)
fi

echo "== Deploying =="
"${SUPABASE_CMD[@]}" functions deploy "$FUNCTION_NAME" \
  --project-ref "$PROJECT_REF" \
  --use-api \
  --no-verify-jwt

echo
echo "== Deployed. $FUNCTION_NAME now serves exactly the $LINES-line repository source. =="

if [ "$RUN_VERIFY" -eq 1 ]; then
  echo
  echo "== Live verification =="
  node --no-warnings tests/live-api.mjs
fi
