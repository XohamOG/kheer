"use client";

import type { WalletDriver } from "./wallet";
import { REGISTRY } from "./near";

/**
 * Signs with a testnet key placed in localStorage by the browser test.
 * Only loaded when the build sets NEXT_PUBLIC_TEST_WALLET=1.
 */
export async function loadTestWallet(): Promise<{ accountId: string; driver: WalletDriver } | null> {
  const raw = localStorage.getItem("kheer:test-wallet");
  if (!raw) return null;
  const { accountId, privateKey } = JSON.parse(raw);
  const { Account, JsonRpcProvider, KeyPair, KeyPairSigner } = await import("near-api-js");
  const { signMessage } = await import("near-api-js/nep413");
  const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
  const account = new Account(accountId, provider, new KeyPairSigner(KeyPair.fromString(privateKey)));
  return {
    accountId,
    driver: {
      call: (c) =>
        account.callFunction({
          contractId: REGISTRY,
          methodName: c.method,
          args: c.args as Record<string, unknown>,
          gas: BigInt(c.gas),
          deposit: BigInt(c.deposit),
        }),
      async sign(message, recipient, nonce) {
        const s = await signMessage({ signerAccount: account, payload: { message, recipient, nonce } });
        return {
          accountId: s.accountId,
          publicKey: s.publicKey.toString(),
          signature: btoa(String.fromCharCode(...s.signature)),
        };
      },
    },
  };
}
