# Kheer

Kheer turns a person's professional skill into an AI agent they own. The agent is a NEP-171 NFT with its own NEAR wallet. It takes paid jobs, the money collects in its wallet, the holder withdraws it, and selling the NFT hands over the agent, wallet, record and future income.

Built at NEAR HACKATHON. Tracks: `nfts`, `agents`. Testnet only.

![Holder page](docs/img/holder.png)

## The problem

Companies are replacing people with AI, and workers are sometimes asked to help train it. The company keeps the AI. The worker keeps nothing. Kheer lets a person train an agent on their own method and own the result.

## Deployments

| What | Address |
|---|---|
| Registry, used by the website | [`app.kheer-demo.testnet`](https://testnet.nearblocks.io/address/app.kheer-demo.testnet) |
| Test registry, holds the test history below | [`kheer-demo.testnet`](https://testnet.nearblocks.io/address/kheer-demo.testnet) |
| Agent wallets | `a<token_id>.<registry>` |
| Runtime operator | `kheer-ops.testnet` |

Real transaction links for every step: [docs/TESTNET_EVIDENCE.md](docs/TESTNET_EVIDENCE.md).

Hosted demo: not deployed yet. Run it locally with the steps below.

## Try it

### 1. Check the chain. Needs only [near-cli-rs](https://github.com/near/near-cli-rs).

Do this, and see an agent that was sold: `owner_id` is `kheer-carol.testnet`, `creator` is `kheer-alice.testnet`.

```
near contract call-function as-read-only kheer-demo.testnet get_agent json-args '{"token_id":"1"}' network-config testnet now
```

Do this, and see `sold` and `withdrawn` in its life story.

```
near contract call-function as-read-only kheer-demo.testnet get_history json-args '{"token_id":"1"}' network-config testnet now
```

Do this, and see an empty key table: nobody can sign for the agent's wallet.

```
near account list-keys a1.kheer-demo.testnet network-config testnet now
```

### 2. Run the tests

| Do | See |
|---|---|
| `cd contracts && cargo test` | 50 passed. Needs Rust, a C compiler and CMake |
| `cd runtime && npm ci && npm test` | 6 passed |

### 3. Run your own deployment

Needs Node 22+, near-cli-rs and the [Rust wasm target only if you rebuild contracts](#build-the-contracts).

```
scripts/setup-testnet.sh my-unique-prefix    # creates accounts, deploys, writes .env
```

The faucet rate-limits. If it refuses, wait and run again.

Add `NEARAI_API_KEY` to `.env`. Without a key, start the runtime with `INFERENCE_STUB=1` and every result is labelled "Test stub. No AI ran."

```
cd runtime && npm ci && npm start
cd web && npm ci && NEXT_PUBLIC_REGISTRY=my-unique-prefix-registry.testnet npm run build && npm start
```

Open http://localhost:3000 and connect a testnet wallet such as Meteor.

| Do | See |
|---|---|
| Teach: fill in the form and upload `demo/knowledge-synthetic.md` | Step two opens |
| Paste `demo/resume-sample.md`, Run exam | Your agent beside a plain AI |
| Approve exam, Mint for 1.5 NEAR | An agent page with a wallet at `a<id>.<registry>` |
| From a second account, paste a resume and Hire | A job page, then "Your result." |
| Accept and pay | "Paid." |
| As the holder, open the agent's Holder page and Unlock | The wallet balance |
| Withdraw | Your account is paid and the balance drops |
| List it, then Buy from a third account | The buyer sees the wallet |
| As the old holder, reopen the Holder page | "Locked." |
| Open History | What it earned, what it paid out, who held it |

### 4. Run the lifecycle against testnet

```
REGISTRY=my-unique-prefix-registry.testnet SELLER=my-unique-prefix-alice.testnet CUSTOMER=my-unique-prefix-bob.testnet BUYER=my-unique-prefix-carol.testnet OPERATOR=my-unique-prefix-ops.testnet scripts/testnet-e2e.sh --with-refund
```

See `38 passed, 0 failed`, including a real sale attempted during a payout. It takes about 8 minutes and locks 1.5 testnet NEAR.

### 5. Run the browser test

Uses system Chrome and real testnet transactions, with stub inference.

```
cd web && NEXT_PUBLIC_TEST_WALLET=1 npx next build && E2E_PREFIX=my-unique-prefix npx tsx e2e/flow.ts
```

See `20 passed, 0 failed`. Rebuild without the flag afterwards.

## How control passes on transfer

The only authority is `owner_id` of the token in the registry.

Each agent's wallet is a sub-account created with **no access keys**, so nobody can sign for it. Its only way to send money is `pay`, which only the registry can call. The registry issues `pay` only to the account holding the token at that moment.

When the token moves, the right to withdraw moves in the same state change. There is no key to rotate.

**What stops the old owner keeping access:**

- Every transfer path clears the operator, the sale listing and all marketplace approvals.
- A payout sets `withdrawal_pending` before its cross-contract call, and every transfer path refuses while it is set. The callback clears it, and restores the balance if the payment failed.
- `nft_transfer_call` sets `transfer_locked` until the receiver has resolved, so a provisional receiver cannot drain the wallet and hand the token back.
- Customer money stays in registry escrow until accepted, so unearned money cannot be withdrawn.
- The holder page needs a fresh signature, checked against the current owner on chain.

Every way we know a seller could try to keep the money: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## What NEAR does here

| Feature | Use |
|---|---|
| Named sub-accounts | Each NFT owns a real account as its wallet |
| Contracts deployed to keyless accounts | The wallet obeys the NFT, and no person holds its key |
| Function-call keys | The runtime can call only `deliver`, and cannot touch money |
| NEP-171, NEP-177, NEP-178 | The agent is a standard NFT with live metadata |
| NEP-297 events | Every hire, delivery, payout and sale is logged |
| NEP-413 | The holder proves ownership by signature, for free |
| NEAR AI Cloud | Inference on `z-ai/glm-5.3-flash` in a TEE. `GET /attestation` on the runtime fetches its report with a fresh nonce |

## Architecture

```
Expert ── knowledge ──▶ Runtime ── private inference ──▶ NEAR AI Cloud
                          │ deliver(job, result hash)
                          ▼
Customer ── hire + pay ─▶ Registry (NEP-171) ── controls ──▶ Vault a<id>.<registry>
Holder ──── withdraw ───▶
```

| Path | What |
|---|---|
| `contracts/registry` | NFT, escrow, jobs, locks, sale, history |
| `contracts/vault` | Keyless wallet deployed per agent |
| `runtime` | Knowledge store, exam, job loop, holder and result APIs |
| `web` | Next.js site |
| `scripts` | Testnet setup and lifecycle test |
| `demo` | Synthetic knowledge and resume, labelled as such |

## Test status

| Suite | Result | Covers |
|---|---|---|
| Contract unit tests | 50 passed | Every money path and lock, with callback success and failure simulated |
| Testnet lifecycle | 38 passed | Real mint, hire, deliver, accept, sale, lockout, refund, and the payout race |
| Browser flow | 20 passed | The whole product in Chrome on live testnet, with stub inference and a test wallet |
| Runtime unit tests | 6 passed | Encryption, output check, injection flags, parsing |
| Real AI safety run | Not run yet | `npm run test:safety` needs `NEARAI_API_KEY` and writes `docs/SAFETY_RUN.md` |

Not tested: a real wallet extension signing in the browser. The picker opens and lists testnet wallets, but the automated test signs with a local test wallet. A payout that fails partway is covered by unit tests only.

## Limits

- An agent is not a person, and its answers are not professional advice.
- A seller still knows what they taught it. A sale moves the identity, record and income, not the memory.
- Customers see answers, not the knowledge. Inference runs privately on NEAR AI Cloud. The runtime operator could access the knowledge, and prompt extraction is reduced, not eliminated.
- The deployer key remains on the registry, so the deployer could change the contract.
- Records can be inflated with multiple accounts.
- Whether people will pay for this over a general AI is unproven.
- Demo material is synthetic and labelled on screen. No expert or credential has been invented.
- Testnet only. Demo windows are 5 minutes to deliver and 10 minutes to accept.

## Build the contracts

```
rustup target add wasm32-unknown-unknown
cd contracts/vault && cargo near build non-reproducible-wasm && cp ../target/near/vault/vault.wasm ../res/
cd ../registry && cargo near build non-reproducible-wasm && cp ../target/near/registry/registry.wasm ../res/
```

On Windows with the GNU toolchain add `--no-abi`, put a MinGW `bin` on `PATH`, and set `CMAKE_GENERATOR=Ninja`.

## Built with

**Libraries:** near-sdk, near-contract-standards, near-api-js, `@hot-labs/near-connect`, Next.js, React, Hono, bs58, Playwright. **Services:** NEAR AI Cloud, FastNEAR RPC, NEAR testnet faucet. **Scaffold:** `cargo near new`.

**AI assistance:** the code, tests and documentation were written with Claude Code.

All code here was written during the hackathon. There is no pre-hackathon code.

## Licence

MIT
