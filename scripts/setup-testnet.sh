#!/usr/bin/env bash
# Creates your own Kheer deployment on NEAR testnet and writes .env.
# Usage: scripts/setup-testnet.sh <unique-prefix>
# Needs near-cli-rs on PATH. Accounts come from the free testnet faucet, which
# rate-limits: if it answers 429, wait a while and run again.
set -euo pipefail

P="${1:?Usage: scripts/setup-testnet.sh <unique-prefix>}"
cd "$(dirname "$0")/.."
REGISTRY="$P-registry.testnet"
OPERATOR="$P-ops.testnet"

exists() {
  local out
  out=$(near account view-account-summary "$1" network-config testnet now 2>&1 || true)
  case "$out" in *"does not exist"*) return 1 ;; *) return 0 ;; esac
}
run() {
  local out
  if ! out=$("$@" 2>&1); then printf '%s\n' "$out" | tail -8; exit 1; fi
}

for name in registry ops alice bob carol; do
  a="$P-$name.testnet"
  if exists "$a"; then echo "$a already exists"; continue; fi
  near account create-account sponsor-by-faucet-service "$a" autogenerate-new-keypair \
    save-to-legacy-keychain network-config testnet create >/dev/null 2>&1 || true
  exists "$a" || { echo "Could not create $a. The faucet may be rate-limiting. Try again later."; exit 1; }
  echo "created $a"
done

run near contract deploy "$REGISTRY" use-file contracts/res/registry.wasm with-init-call new \
  json-args '{"deliver_window_ms":300000,"accept_window_ms":600000}' \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send
echo "deployed $REGISTRY"

run near account add-key "$OPERATOR" grant-function-call-access --allowance '1 NEAR' \
  --contract-account-id "$REGISTRY" --function-names deliver autogenerate-new-keypair \
  save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send

node scripts/write-env.cjs "$REGISTRY" "$OPERATOR"
echo
echo "Registry: $REGISTRY"
echo "Next: add NEARAI_API_KEY to .env, or start the runtime with INFERENCE_STUB=1 to try it without AI."
