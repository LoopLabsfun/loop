#!/usr/bin/env bash
#
# Sync the MISSING production env vars from .env.local → the linked Vercel project.
#
# Why: the Loop Labs production project ships with only a handful of env vars, so
# prod falls back to the static registry (no Supabase) and the agent cron 503s (no
# ANTHROPIC_API_KEY). This pushes the rest so prod runs for real.
#
# Safety:
#   - Reads values from .env.local at RUNTIME — nothing secret is committed, and
#     the script never prints a value (only key names + status).
#   - Idempotent: skips any key already present in production.
#   - HOLDS AGENT_CLAIM_FEES (it signs a real recurring mainnet tx) — enable that
#     one by hand when you're ready: `echo 1 | vercel env add AGENT_CLAIM_FEES production`.
#   - NEXT_PUBLIC_SITE_URL is forced to the prod domain (env-specific).
#
# Requires: a CLI session / token with permission to manage PRODUCTION env vars on
# the Loop Labs team (Owner/Admin). A "Member" can only write preview/development.
#
# Usage:  bash scripts/sync-vercel-env.sh   (then: vercel --prod)

set -euo pipefail
cd "$(dirname "$0")/.."

ENVFILE=".env.local"
[ -f "$ENVFILE" ] || { echo "✗ $ENVFILE not found"; exit 1; }

# Real-money / manual-only toggles never pushed automatically.
HOLD=" AGENT_CLAIM_FEES "

# Environment-specific overrides (the public site URL must be the prod domain).
declare -A OVERRIDE=( [NEXT_PUBLIC_SITE_URL]="https://www.looplabs.fun" )

# Names already set in production (so we skip them and don't error on re-add).
EXISTING="$(vercel env ls production 2>/dev/null | awk '/^ [A-Z]/{print $1}')"

# Parse .env.local (ignore comments/blanks; last value wins for duplicate keys).
declare -A KV
while IFS= read -r line; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" != *"="* ]] && continue
  key="${line%%=*}"; val="${line#*=}"
  key="${key//[[:space:]]/}"
  [ -z "$key" ] && continue
  KV["$key"]="$val"
done < "$ENVFILE"
for k in "${!OVERRIDE[@]}"; do KV["$k"]="${OVERRIDE[$k]}"; done

added=0; skipped=0; failed=0
for key in "${!KV[@]}"; do
  if [[ "$HOLD" == *" $key "* ]]; then echo "hold : $key (enable manually)"; continue; fi
  if grep -qx "$key" <<<"$EXISTING"; then echo "skip : $key (already in prod)"; ((skipped++)); continue; fi
  if printf '%s' "${KV[$key]}" | vercel env add "$key" production >/dev/null 2>&1; then
    echo "add  : $key"; ((added++))
  else
    echo "FAIL : $key (permissions? already exists?)"; ((failed++))
  fi
done

echo "──────────────────────────────────────────"
echo "added $added · skipped $skipped · failed $failed"
echo "AGENT_CLAIM_FEES held. Next: vercel --prod  (deploys current working tree)"
