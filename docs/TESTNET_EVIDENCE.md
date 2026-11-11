# Testnet evidence

Real transactions you can open on a block explorer. These come from one run of `scripts/testnet-e2e.sh` on `kheer-demo.testnet`, our test deployment. It runs the same contract code as `app.kheer-demo.testnet`, the one the website uses.

| Step | Transaction |
|---|---|
| mint a new agent | [5Bi4hyJzpw...](https://testnet.nearblocks.io/txns/5Bi4hyJzpw5uLhnZsyJrTbd1FRVt9qXUGTibPT2tZxPh) |
| holder sets operator | [E3H9Za4Lbt...](https://testnet.nearblocks.io/txns/E3H9Za4Lbt9jw3z87xFquwfi81CtecjxsxAeYLSp51Yd) |
| customer hires | [CCY3fUx5tV...](https://testnet.nearblocks.io/txns/CCY3fUx5tV91NjfatXjpUGMQVFJ3nB3aX4UgMSmiSuTL) |
| operator delivers | [4b2bQAGrAS...](https://testnet.nearblocks.io/txns/4b2bQAGrASBEELZtU9wzuPMWaXQVv4vfQTt5s7A3UJDf) |
| customer accepts | [6t8Wv3SH98...](https://testnet.nearblocks.io/txns/6t8Wv3SH98enb3TcWhVg4i9U9NJy3XSx4FbGzToCUg1w) |
| customer opens a second job | [ChhuKxH7aP...](https://testnet.nearblocks.io/txns/ChhuKxH7aPhjpBPbiY4baERJb2BC1Batd5kokBqxAX92) |
| holder lists agent | [7ZC8ipVF71...](https://testnet.nearblocks.io/txns/7ZC8ipVF71tLY9GwcgRDHhC9zkYAqBNW5BGhEaaUQCEy) |
| buyer buys | [AiqPSVw3L5...](https://testnet.nearblocks.io/txns/AiqPSVw3L5uHh3ustsksnVYfYDVJVtBm2Web1BuHfzGY) |
| new holder sets operator | [4em5sPkccH...](https://testnet.nearblocks.io/txns/4em5sPkccHjibGX4MvMz2EZiTtJ7r3BjeJDodCMB3JAq) |
| operator delivers open job | [DAyADNntX5...](https://testnet.nearblocks.io/txns/DAyADNntX59Tw2KrFSPEEHgdjUTS4de7hDmV5xLYdjPo) |
| customer accepts open job | [8Uwku4q5VT...](https://testnet.nearblocks.io/txns/8Uwku4q5VTnHzJVq4RZWRHpYjNcDwzRwbMQcVcj37XhT) |
| new holder withdraws 0.1 | [BvBst2ekDk...](https://testnet.nearblocks.io/txns/BvBst2ekDkr5MAAkzam29RdzkSNisEaJYgandi5FYhUa) |
| approve a marketplace | [E2TjC3RQrb...](https://testnet.nearblocks.io/txns/E2TjC3RQrbBg4fHuXuy1mbMSGRFR343UYhrWriEzyDL) |

## Browser run with real AI

On 10 November 2026, `E2E_REAL_AI=1 npx tsx e2e/flow.ts` ran the whole product in Chrome against `app.kheer-demo.testnet`, with real inference on `z-ai/glm-5.3-flash`: 20 passed, 0 failed. It minted agent 0, which completed one job, was sold from `kheer-alice.testnet` to `kheer-carol.testnet` and paid out 0.05 NEAR. The hire included a prompt-injection line, which the model flagged and ignored. The material is synthetic and labelled on the agent page.

```
near contract call-function as-read-only app.kheer-demo.testnet get_history json-args '{"token_id":"0"}' network-config testnet now
```
