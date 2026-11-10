"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const REGISTRY = process.env.NEXT_PUBLIC_REGISTRY ?? "app.kheer-demo.testnet";
export const RUNTIME = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:8787";
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "https://test.rpc.fastnear.com";
export const JOB_FEE = 10n ** 22n;
export const TGAS = (n: number) => `${n}000000000000`;
export const ONE_YOCTO = "1";

export interface AgentData {
  vault: string;
  creator: string;
  operator: string | null;
  price: string;
  knowledge_hash: string;
  exam_hash: string | null;
  jobs_total: number;
  jobs_completed: number;
  jobs_refunded: number;
  unique_customers: number;
  rating_sum: number;
  ratings: number;
  lifetime_earned: string;
  lifetime_withdrawn: string;
  available: string;
  withdrawal_pending: boolean;
  listing: string | null;
}
export interface AgentView {
  token_id: string;
  owner_id: string;
  agent: AgentData;
}
export interface TokenView {
  token_id: string;
  metadata: { title: string | null; description: string | null; extra: string | null };
}
export interface Job {
  id: number;
  token_id: string;
  customer: string;
  amount: string;
  request_hash: string;
  result_hash: string | null;
  deliver_by_ms: number;
  accept_by_ms: number | null;
  status: "Hired" | "Delivered" | "Accepted" | "Refunded";
  rating: number | null;
}
export interface HistoryEntry {
  seq: number;
  kind: string;
  account: string;
  counterparty: string | null;
  amount: string | null;
  job_id: number | null;
  timestamp_ms: number;
}
export interface Review {
  score: number | null;
  verdict: string;
  strengths: string[];
  fixes: string[];
  flags: string[];
  stub?: boolean;
}

export async function view<T>(method: string, args: object = {}): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "kheer",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: REGISTRY,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const j = await res.json();
  if (j.error || j.result?.error) throw new Error("Could not read the chain. Refresh to try again.");
  return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
}

export async function api<T>(path: string, body?: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${RUNTIME}${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("The agent runtime is offline.");
  }
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "Request failed.");
  return j;
}

export function near(y: string | bigint): string {
  const v = BigInt(y);
  const unit = 10n ** 24n;
  const frac = (v % unit).toString().padStart(24, "0").slice(0, 3).replace(/0+$/, "");
  return frac ? `${v / unit}.${frac}` : `${v / unit}`;
}

export function yocto(n: string): string {
  if (!/^\d*\.?\d+$/.test(n.trim())) throw new Error("Enter an amount in NEAR.");
  const [w, f = ""] = n.trim().split(".");
  return (BigInt(w || "0") * 10n ** 24n + BigInt(f.padEnd(24, "0").slice(0, 24))).toString();
}

export function rating(a: AgentData): string {
  return a.ratings ? (a.rating_sum / a.ratings).toFixed(1) : "New";
}

export function agentLabel(t: TokenView | null | undefined): string | null {
  try {
    return JSON.parse(t?.metadata.extra ?? "{}").label ?? null;
  } catch {
    return null;
  }
}

async function digest(text: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
export async function sha256Hex(text: string) {
  return Array.from(await digest(text), (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function sha256B58(text: string) {
  const bs58 = (await import("bs58")).default;
  return bs58.encode(await digest(text));
}

export async function until<T>(fn: () => Promise<T | null | undefined>, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("The chain is taking too long. Refresh in a moment.");
}

const plurals = new Intl.PluralRules("en");
export const plural = (n: number, one: string, other: string) => `${n} ${plurals.select(n) === "one" ? one : other}`;

export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} – Kheer` : "Kheer";
  }, [title]);
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(fn);
  ref.current = fn;
  const reload = useCallback(async () => {
    try {
      setData(await ref.current());
      setLoaded(true);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
    if (!pollMs) return;
    const t = setInterval(reload, pollMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pollMs]);
  return { data, error, reload, loaded };
}

/** Throws a message the action's error region will show. */
export function need(ok: unknown, message: string) {
  if (!ok) throw new Error(message);
}

export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const m = (e as Error).message ?? "That did not go through.";
      setError(m.match(/panicked: ([^"\\]+)/)?.[1] ?? m);
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, error, run };
}
