"use client";

import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { REGISTRY, TGAS } from "./near";

export interface Call {
  method: string;
  args: object;
  gas?: string;
  deposit?: string;
}
export interface Proof {
  accountId: string;
  publicKey: string;
  signature: string;
  nonce: string;
  message: string;
  recipient: string;
}
export interface WalletDriver {
  call(c: Required<Call>): Promise<unknown>;
  sign(message: string, recipient: string, nonce: Uint8Array): Promise<{ accountId: string; publicKey: string; signature: string }>;
}

interface Ctx {
  account: string | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  call(c: Call): Promise<unknown>;
  prove(message: string): Promise<Proof>;
}

const WalletContext = createContext<Ctx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const connector = useRef<NearConnector | null>(null);
  const testDriver = useRef<WalletDriver | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      // Compiled out of production builds. Used only by the automated browser test.
      if (process.env.NEXT_PUBLIC_TEST_WALLET === "1") {
        const t = await (await import("./testWallet")).loadTestWallet();
        if (t) {
          testDriver.current = t.driver;
          if (live) setAccount(t.accountId);
          return;
        }
      }
      const { NearConnector } = await import("@hot-labs/near-connect");
      const c = new NearConnector({
        network: "testnet",
        features: { testnet: true, signMessage: true, signAndSendTransaction: true },
      });
      connector.current = c;
      c.on("wallet:signIn", (e) => setAccount(e.accounts[0]?.accountId ?? null));
      c.on("wallet:signOut", () => setAccount(null));
      const existing = await c.getConnectedWallet().catch(() => null);
      if (live && existing?.accounts[0]) setAccount(existing.accounts[0].accountId);
    })();
    return () => {
      live = false;
    };
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      account,
      async connect() {
        await connector.current?.connect();
      },
      async disconnect() {
        await connector.current?.disconnect();
        setAccount(null);
      },
      async call(c) {
        const full = { gas: TGAS(100), deposit: "0", ...c };
        if (testDriver.current) return testDriver.current.call(full);
        const w = await connector.current!.wallet();
        return w.signAndSendTransaction({
          receiverId: REGISTRY,
          actions: [
            {
              type: "FunctionCall",
              params: { methodName: full.method, args: full.args as Record<string, unknown>, gas: full.gas, deposit: full.deposit },
            },
          ],
        });
      },
      async prove(message) {
        const nonce = crypto.getRandomValues(new Uint8Array(32));
        const recipient = "kheer";
        let signed;
        if (testDriver.current) {
          signed = await testDriver.current.sign(message, recipient, nonce);
        } else {
          const w = await connector.current!.wallet();
          signed = await w.signMessage({ message, recipient, nonce });
        }
        return { ...signed, nonce: btoa(String.fromCharCode(...nonce)), message, recipient };
      },
    }),
    [account],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const c = useContext(WalletContext);
  if (!c) throw new Error("WalletProvider missing");
  return c;
}
