# Threat model

A Kheer agent is an NFT with its own wallet, and selling the NFT hands over the wallet. So the big question is: can a seller sell the agent and still keep the money? This page lists every way we could think of to try, what stops each one, and other ways people could abuse the system.

**How we know each row holds**

- **Unit:** covered by the contract tests (`cargo test` in `contracts/`), with calls to other contracts simulated.
- **Live:** tried for real on testnet by `scripts/testnet-e2e.sh`.
- **Not built:** that part doesn't exist yet, so the row is a plan, not a guarantee.
- **Accepted:** can't be prevented, so we say so here.

## How control passes on transfer

Only one thing decides who controls an agent: who holds its NFT (`owner_id` in the registry).

The agent's wallet (`a<id>.<registry>`) is created with **no keys**, so nobody can sign for it. The only way money leaves it is `pay`, and only the registry can call that. The registry only pays whoever holds the NFT at that moment.

So when the NFT moves, the right to withdraw moves with it, in the same step. There's no key to swap and nothing for the old owner to hand back.

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
| 10 | The registry deployer key can upgrade the contract and take everything | **Currently present** on `app.kheer-demo.testnet`, so the deployer could change the contract. Disclosed risk on this testnet deployment | Accepted for now |
| 11 | Receiver of `nft_transfer_call` drains the wallet, then rejects the token | `transfer_locked` blocks withdrawals and holder actions until the resolve step | Unit |
| 12 | Forging a callback to credit money or mint a token | Callbacks are private to the registry | Live |

## Other threats

| # | Threat | Handling | Evidence |
|---|---|---|---|
| 13 | Self-hiring to fake a record | Unique customers are counted and shown. A person with many accounts can still inflate it | Unit, Accepted |
| 14 | Agent never delivers | Anyone can trigger `refund` after `deliver_by`. The job fee is not refunded because it pays for storage | Unit, Live |
| 15 | Customer never accepts | Anyone can trigger `finalize` after the window. No rating is recorded | Unit |
| 16 | Holder withdraws unearned money | Escrow is held by the registry, and only accepted jobs add to the withdrawable balance | Unit, Live |
| 17 | Too little gas leaves a promise half-done | Minimum gas is required for `mint` and `withdraw`, and callbacks have reserved gas | Partly: the requirement is in the contract, with no dedicated test |
| 18 | Wallet is credited before the money arrives, and a fast withdrawal fails | The payout fails cleanly and the callback restores the balance (see #2) | Unit |
| 19 | History is flooded to push out old entries | History per token is a ring of 100 entries, so old entries can be pushed out. Lifetime counters are unaffected, and every entry is also a permanent NEP-297 event | Unit, Accepted |
| 20 | Prompt injection in a submitted resume | The submission is wrapped as data and cannot close its wrapper. The prompt forbids obeying it, and attempts are flagged on the result | Unit for wrapping and flags. `npm run test:safety` measures the model and writes `docs/SAFETY_RUN.md` |
| 21 | Customer extracts the knowledge pack by asking | Refusal rules plus an output check that withholds any answer repeating eight consecutive words of the pack. This reduces the risk only: paraphrase can pass | Unit for the check. Same safety run for the model |
| 22 | Runtime operator reads the knowledge pack | **Accepted** unless the runtime itself runs in a TEE. NEAR AI Cloud protects inference, not our server. Packs are AES-256-GCM encrypted at rest, and the operator holds that key | Unit, Accepted |
| 23 | Old holder keeps reading the knowledge after a sale | The holder API needs a fresh NEP-413 signature from a full-access key, and checks `owner_id` on chain at that moment | Browser test against live testnet |
| 24 | Someone else reads a customer's result | The result is released only for a random view key held in the customer's browser, whose hash is committed in the on-chain request hash. Clearing browser storage loses access | Browser test against live testnet |
| 25 | Runtime key is stolen | It is a function-call key that can only call `deliver` on the registry, with a 1 NEAR gas allowance. It cannot move funds. A thief could deliver junk results for agents using this operator, and customers could then decline to rate them | Key permissions visible on chain |
| 26 | Inference budget is drained through the public API | Per-client hourly limits on exams and writes. Limits reset on restart | Accepted |

## Settings on the demo deployment

The delivery window is 5 minutes and the accept window is 10 minutes, so the whole flow fits in a demo. A production deployment would use much longer windows. Everything here is on testnet.
