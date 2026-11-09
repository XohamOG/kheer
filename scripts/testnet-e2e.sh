#!/usr/bin/env bash
# Runs the whole agent lifecycle with real transactions on NEAR testnet.
#
# Needs: near-cli-rs on PATH, and five funded testnet accounts whose keys are in
# the legacy keychain (~/.near-credentials). Mints one new agent per run, which
# locks about 1.5 testnet NEAR.
#
#   scripts/testnet-e2e.sh               # about 3 minutes
#   scripts/testnet-e2e.sh --with-refund # also waits out the delivery deadline
#   RACE_DELAY=1.2 scripts/testnet-e2e.sh  # seconds between payout and sale
set -u

REGISTRY="${REGISTRY:-understudy-demo.testnet}"
SELLER="${SELLER:-understudy-alice.testnet}"
CUSTOMER="${CUSTOMER:-understudy-bob.testnet}"
BUYER="${BUYER:-understudy-carol.testnet}"
OPERATOR="${OPERATOR:-understudy-ops.testnet}"
RACE_DELAY="${RACE_DELAY:-1.5}"
HASH=4VEvrTQM5xuWgHZC4LJXUutK3qdxR1aHBUr5wuDkFr9Z
TENTH=100000000000000000000000
YOCTO='1 yoctoNEAR'
GAS='60.0 Tgas'

pass=0; failed=0
ok()  { pass=$((pass+1));     echo "  PASS  $1"; }
bad() { failed=$((failed+1)); echo "  FAIL  $1"; }

send() { # signer method json gas deposit
  near contract call-function as-transaction "$REGISTRY" "$2" json-args "$3" \
    prepaid-gas "$4" attached-deposit "$5" sign-as "$1" \
    network-config testnet sign-with-legacy-keychain send 2>&1
}
view() { # method json
  near contract call-function as-read-only "$REGISTRY" "$1" json-args "$2" \
    network-config testnet now 2>/dev/null
}
field() { # text key: first string or bare value of "key"
  printf '%s' "$1" | grep -m1 "\"$2\"" | sed -E 's/.*": *"?([^",]*)"?,?.*/\1/'
}
expect_ok() { # label signer method json gas deposit
  local out; out=$(send "$2" "$3" "$4" "$5" "$6")
  if printf '%s' "$out" | grep -qE 'panicked|ExecutionError|Failed'; then
    bad "$1"; printf '%s\n' "$out" | grep -E 'panicked|ExecutionError' | head -2
  else ok "$1"; fi
  LAST="$out"
}
expect_fail() { # label expected-message signer method json gas deposit
  local out; out=$(send "$3" "$4" "$5" "$6" "$7")
  if printf '%s' "$out" | grep -q "$2"; then ok "$1"
  else bad "$1 (wanted: $2)"; printf '%s\n' "$out" | tail -4; fi
}
check() { # label actual expected
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (got '$2', wanted '$3')"; fi
}

echo "== Mint"
expect_ok "mint a new agent" "$SELLER" mint \
  "{\"metadata\":{\"title\":\"E2E test agent (synthetic)\"},\"price\":\"$TENTH\",\"knowledge_hash\":\"$HASH\"}" \
  '150.0 Tgas' '1.5 NEAR'
ID=$(printf '%s' "$LAST" | grep -A1 'return value' | tail -1 | tr -d '"[:space:]')
[ -n "$ID" ] || { echo "Could not read the token id"; exit 1; }
T="\"token_id\":\"$ID\""
VAULT="a$ID.$REGISTRY"
echo "  token $ID, vault $VAULT"
keys=$(near account list-keys "$VAULT" network-config testnet now 2>/dev/null | grep -c 'ed25519:')
check "vault has zero access keys" "$keys" "0"
expect_ok "holder sets operator" "$SELLER" set_operator "{$T,\"operator\":\"$OPERATOR\"}" "$GAS" "$YOCTO"

echo "== Earn"
expect_ok "customer hires" "$CUSTOMER" hire "{$T,\"request_hash\":\"$HASH\"}" "$GAS" '0.11 NEAR'
JOB=$(printf '%s' "$LAST" | grep -A1 'return value' | tail -1 | tr -d '"[:space:]')
expect_fail "escrow cannot be withdrawn" "exceeds the available" "$SELLER" withdraw "{$T,\"amount\":\"$TENTH\"}" "$GAS" "$YOCTO"
expect_fail "stranger cannot deliver" "Only the operator" "$BUYER" deliver "{\"job_id\":$JOB,\"result_hash\":\"$HASH\"}" "$GAS" '0 NEAR'
expect_ok "operator delivers" "$OPERATOR" deliver "{\"job_id\":$JOB,\"result_hash\":\"$HASH\"}" "$GAS" '0 NEAR'
expect_fail "stranger cannot accept" "Only the customer" "$BUYER" accept "{\"job_id\":$JOB,\"rating\":5}" "$GAS" "$YOCTO"
expect_ok "customer accepts" "$CUSTOMER" accept "{\"job_id\":$JOB,\"rating\":5}" "$GAS" "$YOCTO"
a=$(view get_agent "{$T}")
check "wallet credited" "$(field "$a" available)" "$TENTH"
expect_fail "non-holder cannot withdraw" "Only the holder" "$BUYER" withdraw "{$T,\"amount\":\"$TENTH\"}" "$GAS" "$YOCTO"

expect_fail "stranger cannot fake a payout result" "is private" "$BUYER" on_withdraw "{$T,\"amount\":\"$TENTH\",\"to\":\"$BUYER\"}" "$GAS" '0 NEAR'
expect_fail "stranger cannot fake vault creation" "is private" "$BUYER" on_vault_created "{\"id\":999,\"owner\":\"$BUYER\",\"vault\":\"$VAULT\",\"metadata\":{\"title\":\"x\"},\"price\":\"$TENTH\",\"knowledge_hash\":\"$HASH\",\"deposit\":\"0\"}" "$GAS" '0 NEAR'

echo "== Sell with an open job"
expect_ok "customer opens a second job" "$CUSTOMER" hire "{$T,\"request_hash\":\"$HASH\"}" "$GAS" '0.11 NEAR'
JOB2=$(printf '%s' "$LAST" | grep -A1 'return value' | tail -1 | tr -d '"[:space:]')
expect_ok "holder lists agent" "$SELLER" list_for_sale "{$T,\"price\":\"500000000000000000000000\"}" "$GAS" "$YOCTO"
expect_fail "buyer's minimum-balance guard works" "below your minimum" "$BUYER" buy "{$T,\"min_available\":\"999000000000000000000000\"}" "$GAS" '0.5 NEAR'
expect_ok "buyer buys" "$BUYER" buy "{$T,\"min_available\":\"$TENTH\"}" "$GAS" '0.5 NEAR'
a=$(view get_agent "{$T}")
check "buyer now holds it" "$(field "$a" owner_id)" "$BUYER"
check "operator cleared by sale" "$(field "$a" operator)" "null"

echo "== Old holder is locked out"
expect_fail "old holder cannot withdraw" "Only the holder" "$SELLER" withdraw "{$T,\"amount\":\"$TENTH\"}" "$GAS" "$YOCTO"
expect_fail "old holder cannot set operator" "Only the holder" "$SELLER" set_operator "{$T,\"operator\":\"$OPERATOR\"}" "$GAS" "$YOCTO"
expect_fail "old operator cannot deliver" "Only the operator" "$OPERATOR" deliver "{\"job_id\":$JOB2,\"result_hash\":\"$HASH\"}" "$GAS" '0 NEAR'

echo "== New holder inherits the job and the money"
expect_ok "new holder sets operator" "$BUYER" set_operator "{$T,\"operator\":\"$OPERATOR\"}" "$GAS" "$YOCTO"
expect_ok "operator delivers open job" "$OPERATOR" deliver "{\"job_id\":$JOB2,\"result_hash\":\"$HASH\"}" "$GAS" '0 NEAR'
expect_ok "customer accepts open job" "$CUSTOMER" accept "{\"job_id\":$JOB2,\"rating\":4}" "$GAS" "$YOCTO"
a=$(view get_agent "{$T}")
check "wallet holds both jobs' earnings" "$(field "$a" available)" "200000000000000000000000"
before=$(near tokens "$VAULT" view-near-balance network-config testnet now 2>&1 | grep 'account has')
expect_ok "new holder withdraws 0.1" "$BUYER" withdraw "{$T,\"amount\":\"$TENTH\"}" "$GAS" "$YOCTO"
after=$(near tokens "$VAULT" view-near-balance network-config testnet now 2>&1 | grep 'account has')
echo "  vault before: $before"; echo "  vault after:  $after"
a=$(view get_agent "{$T}")
check "wallet reduced" "$(field "$a" available)" "$TENTH"
check "withdrawal recorded" "$(field "$a" lifetime_withdrawn)" "$TENTH"
check "lock released" "$(field "$a" withdrawal_pending)" "false"

echo "== Race: sale in the middle of a payout (delay ${RACE_DELAY}s)"
expect_ok "approve a marketplace" "$BUYER" nft_approve "{$T,\"account_id\":\"$CUSTOMER\"}" '100.0 Tgas' '0.01 NEAR'
approval=$(view nft_token "{$T}" | grep -A1 approved_account_ids | tail -1 | sed -E 's/.*: *([0-9]+).*/\1/')
tmp=$(mktemp -d)
send "$BUYER" withdraw "{$T,\"amount\":\"$TENTH\"}" "$GAS" "$YOCTO" > "$tmp/w" &
sleep "$RACE_DELAY"
send "$CUSTOMER" nft_transfer "{\"receiver_id\":\"$SELLER\",$T,\"approval_id\":$approval}" "$GAS" "$YOCTO" > "$tmp/t" &
wait
if grep -q 'panicked' "$tmp/w"; then w=rejected; else w=succeeded; fi
if grep -q 'panicked' "$tmp/t"; then t=rejected; else t=succeeded; fi
echo "  withdrawal: $w | sale: $t"
grep -h 'panicked' "$tmp/w" "$tmp/t" | sed 's/^ */  /' | cut -c1-110
if grep -q 'A withdrawal is pending' "$tmp/t"; then
  ok "ordering seen: payout first, sale blocked by the lock"
elif [ "$t" = succeeded ] && [ "$w" = rejected ]; then
  ok "ordering seen: sale first, old holder's payout refused"
elif [ "$t" = succeeded ] && [ "$w" = succeeded ]; then
  ok "ordering seen: payout fully finished before the sale, no overlap"
  echo "  NOTE: this run did not exercise the lock. Try a smaller RACE_DELAY."
else
  bad "unexpected race outcome"; cat "$tmp/w" "$tmp/t" | tail -12
fi
a=$(view get_agent "{$T}")
check "no lock left behind" "$(field "$a" withdrawal_pending)" "false"

if [ "${1:-}" = "--with-refund" ]; then
  echo "== Refund after the delivery deadline"
  holder=$(field "$a" owner_id)
  expect_ok "holder restores operator" "$holder" set_operator "{$T,\"operator\":\"$OPERATOR\"}" "$GAS" "$YOCTO"
  expect_ok "customer hires" "$CUSTOMER" hire "{$T,\"request_hash\":\"$HASH\"}" "$GAS" '0.11 NEAR'
  JOB3=$(printf '%s' "$LAST" | grep -A1 'return value' | tail -1 | tr -d '"[:space:]')
  expect_fail "too early to refund" "has not passed" "$BUYER" refund "{\"job_id\":$JOB3}" "$GAS" '0 NEAR'
  window=$(field "$(view get_config '{}')" deliver_window_ms)
  sleep $((window / 1000 + 5))
  expect_ok "anyone can refund after the deadline" "$BUYER" refund "{\"job_id\":$JOB3}" "$GAS" '0 NEAR'
  check "job marked refunded" "$(field "$(view get_job "{\"job_id\":$JOB3}")" status)" "Refunded"
fi

echo
echo "History for token $ID:"
view get_history "{$T}" | grep '"kind"' | sed -E 's/.*"kind": *"([^"]*)".*/  \1/' | paste -sd' ' -
echo
echo "Result: $pass passed, $failed failed"
[ "$failed" -eq 0 ]
