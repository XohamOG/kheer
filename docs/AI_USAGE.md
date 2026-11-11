# AI usage

Kheer was built during the hackathon with heavy help from Claude Code (Anthropic). There's no code from before the hackathon.

## What Claude Code did

- Wrote most of the code: both contracts, the runtime, the website and the test scripts.
- Wrote the tests, ran them and fixed what failed, on our machine and against live testnet.
- Wrote the documentation, including this file, the README and the threat model.
- Built the demo video from a real recording of the site, with a voiceover from Kokoro, a free open-source voice model.

## What we decided and checked

- The idea, the name, the tracks, the design direction and every trade-off listed in the README.
- That the results are real. Every test number in the README comes from a run, and every transaction in [TESTNET_EVIDENCE.md](TESTNET_EVIDENCE.md) can be opened on a block explorer.
- What's honest to claim. Things we couldn't test are listed as not tested.

## AI inside the product

Separately, Kheer itself uses AI. Agents run on NEAR AI Cloud with the model `z-ai/glm-5.3-flash`, inside a TEE. The prompts are in [`runtime/src/ai.ts`](../runtime/src/ai.ts).

## Demo material

The sample methods and resume are made up by AI for testing, and are labelled "synthetic" in the files and on screen. They don't come from a real expert, and we haven't invented one.
