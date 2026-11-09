# Threat model

Understudy agents are NFTs with their own wallets, and a sale hands over the wallet. This document lists every way we know a seller could try to keep the money, and other ways the system can be abused.

**Status key**

- **Unit:** covered by `cargo test` in `contracts/`, with cross-contract results simulated.
- **Live:** exercised with real testnet transactions by `scripts/testnet-e2e.sh`.
- **Not built:** the component does not exist yet, so the row is a design intention only.
- **Accepted:** cannot be prevented, and is disclosed here.

## How control passes on transfer

There is exactly one source of authority: `owner_id` of the NEP-171 token in the registry.

The vault sub-account (`a<id>.<registry>`) is created with **no access keys**, so nobody can sign for it. Its only outbound path is `pay`, which only the registry can call. The registry only issues `pay` for the account that holds the token at that moment, and pays that account.

So when the token moves, the ability to withdraw moves with it, in the same state change. There is no key to rotate and nothing for the old owner to hand back.

A transfer also clears the operator, the sale listing and all marketplace approvals. Every transfer path goes through the same locks: `nft_transfer`, `nft_transfer_call`, approved marketplaces and `buy`.

## How a seller could try to keep the money

| # | Attack or failure | Handling | Evidence |
|---|---|---|---|
| 1 | Withdraw while selling, racing the transfer | `withdrawal_pending` is set before the payout call and blocks every transfer path until the callback runs | Unit, Live |
| 2 | Withdrawal fails after state has changed | The callback restores the balance and clears the lock | Unit |
| 3 | An approved marketplace still acts after the sale | Approvals are cleared on transfer | Unit |
| 4 | Old operator keeps delivering | Operator is cleared on transfer | Unit, Live |
| 5 | A key is left on the vault | Created with none. The script lists the keys of a real vault and expects zero | Unit, Live |
| 6 | Seller drains the wallet just before the sale | Withdrawing what the agent has earned is the holder's right, so a drain cannot be blocked. `buy(min_available)` makes the purchase fail if the wallet has fallen below what the buyer saw. A private sale through plain `nft_transfer` has no such guard. Escrow cannot be drained | Unit, Live |
| 7 | A job is open during the sale | Escrow stays in the registry and pays the vault on acceptance, so the new holder receives it. The new holder must set an operator, or the job refunds after its deadline | Unit, Live |
| 8 | Seller keeps a copy of the knowledge | **Accepted.** They know it, and nothing can make them forget. What transfers is the on-chain identity, the record and the income | Accepted |
| 9 | Seller keeps an off-chain marketplace listing | Agent Market is not integrated. If added, its listing and earnings are off-chain and do not move with the NFT | Not built |
| 10 | The registry deployer key can upgrade the contract and take everything | **Currently present** on `understudy-demo.testnet`. Remove it for the final deploy, or this row stays as a disclosed risk | Accepted for now |
| 11 | Receiver of `nft_transfer_call` drains the wallet, then rejects the token | `transfer_locked` blocks withdrawals and holder actions until the resolve step | Unit |
| 12 | Forging a callback to credit money or mint a token | Callbacks are private to the registry | Live |

## Other threats

| # | Threat | Handling | Evidence |
|---|---|---|---|
| 13 | Self-hiring to fake a record | Unique customers are counted and shown. A person with many accounts can still inflate it | Unit, Accepted |
| 14 | Agent never delivers | Anyone can trigger `refund` after `deliver_by`. The job fee is not refunded because it pays for storage | Unit |
| 15 | Customer never accepts | Anyone can trigger `finalize` after the window. No rating is recorded | Unit |
| 16 | Holder withdraws unearned money | Escrow is held by the registry, and only accepted jobs add to the withdrawable balance | Unit, Live |
| 17 | Too little gas leaves a promise half-done | Minimum gas is required for `mint` and `withdraw`, and callbacks have reserved gas | Partly: the requirement is in the contract, with no dedicated test |
| 18 | Wallet is credited before the money arrives, and a fast withdrawal fails | The payout fails cleanly and the callback restores the balance (see #2) | Unit |
| 19 | History is flooded to push out old entries | History per token is a ring of 100 entries, so old entries can be pushed out. Lifetime counters are unaffected, and every entry is also a permanent NEP-297 event | Unit, Accepted |
| 20 | Prompt injection in a submitted resume | Input is treated as data, with a test case | Not built |
| 21 | Customer extracts the knowledge pack by asking | Refusal rules plus an output check. This reduces the risk only | Not built |
| 22 | Runtime operator reads the knowledge pack | **Accepted** unless the runtime itself runs in a TEE. NEAR AI Cloud protects inference, not our server | Accepted |

## Settings on the demo deployment

The delivery window is 5 minutes and the accept window is 10 minutes, so the whole flow fits in a demo. A production deployment would use much longer windows. Everything here is on testnet.
