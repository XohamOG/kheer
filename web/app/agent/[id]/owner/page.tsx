"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Loading, NotFound, Notice } from "@/components/States";
import { CountUp } from "@/components/CountUp";
import { AgentView, api, near, need, ONE_YOCTO, TGAS, until, useAction, useLoad, usePageTitle, view, yocto } from "@/lib/near";
import { useWallet } from "@/lib/wallet";

export default function Owner() {
  usePageTitle("Holder page");
  const { id } = useParams<{ id: string }>();
  const { account, connect, call, prove } = useWallet();
  const { busy, error, run } = useAction();
  const [unlocked, setUnlocked] = useState<{ knowledge: string | null; as: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [sale, setSale] = useState("");
  const [price, setPrice] = useState("");

  const { data, reload, loaded, error: loadError } = useLoad(
    () => view<AgentView | null>("get_agent", { token_id: id }),
    [id],
    4000,
  );
  if (!loaded) return <Loading error={loadError} />;
  if (!data) return <NotFound what="agent" />;
  const a = data.agent;

  if (!account)
    return (
      <div className="gate stage">
        <h1 className="title">Holder only.</h1>
        <p>Connect the wallet that holds this agent.</p>
        <button className="btn" onClick={() => void connect()}>Connect</button>
      </div>
    );

  if (account !== data.owner_id)
    return (
      <div className="gate stage">
        <h1 className="title">Locked.</h1>
        <p>Only the current holder can open this. {data.owner_id} holds it.</p>
        <Link className="btn quiet" href={`/agent/${id}`}>Back to agent</Link>
      </div>
    );

  if (unlocked?.as !== account)
    return (
      <div className="gate stage">
        <h1 className="title">You hold this agent.</h1>
        <p>Sign to prove it. This costs nothing.</p>
        <button
          className="btn"
          disabled={!!busy}
          onClick={() =>
            run("unlock", async () => {
              const proof = await prove(`Open Kheer agent ${id} at ${Date.now()}`);
              const r = await api<{ knowledge: string | null }>(`/holder/${id}`, proof);
              setUnlocked({ knowledge: r.knowledge, as: account });
            })
          }
        >
          {busy ? "Waiting for signature" : "Unlock"}
        </button>
        <Notice message={error} center />
      </div>
    );

  const settle = (check: (v: AgentView) => boolean) =>
    until(async () => {
      const v = await view<AgentView>("get_agent", { token_id: id });
      return check(v) ? true : null;
    }).then(reload);

  const withdraw = () =>
    run("withdraw", async () => {
      const value = amount.trim() ? yocto(amount) : a.available;
      const target = BigInt(a.lifetime_withdrawn) + BigInt(value);
      await call({ method: "withdraw", args: { token_id: id, amount: value }, gas: TGAS(60), deposit: ONE_YOCTO });
      await settle((v) => BigInt(v.agent.lifetime_withdrawn) >= target && !v.agent.withdrawal_pending);
      setAmount("");
    });

  /** Validates inside the action, so a bad value shows as an error rather than a dead button. */
  const holder = (name: string, method: string, args: () => Record<string, unknown>, check: (v: AgentView) => boolean, done?: () => void) =>
    run(name, async () => {
      const a = args();
      await call({ method, args: { token_id: id, ...a }, gas: TGAS(30), deposit: ONE_YOCTO });
      await settle(check);
      done?.();
    });

  const runtimeOperator = async () => (await api<{ operator: string }>("/health")).operator;

  return (
    <div className="narrow stage">
      <h1 className="visually-hidden">Holder page</h1>
      <div className="wallet wallet-card">
        <b><CountUp yocto={a.available} /></b>
        <span>NEAR in this agent’s wallet</span>
      </div>

      <div className="inline" style={{ justifyContent: "center" }}>
        <input type="text" inputMode="decimal" placeholder="All" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount to withdraw" />
        <button className="btn" disabled={BigInt(a.available) === 0n || !!busy} onClick={withdraw}>
          {busy === "withdraw" ? "Withdrawing" : "Withdraw"}
        </button>
      </div>
      <Notice message={error} center />

      <div className="section">
        <div className="row">
          <span>{a.operator ? "Online" : "Offline"}</span>
          <button
            className="btn quiet small"
            disabled={!!busy}
            onClick={() =>
              void run("operator", async () => {
                const next = a.operator ? null : await runtimeOperator();
                await call({ method: "set_operator", args: { token_id: id, operator: next }, gas: TGAS(30), deposit: ONE_YOCTO });
                await settle((v) => v.agent.operator === next);
              })
            }
          >
            {busy === "operator" ? "Saving" : a.operator ? "Take offline" : "Go online"}
          </button>
        </div>
        <div className="row">
          <span>Price per job</span>
          <span className="inline">
            <input type="text" inputMode="decimal" placeholder={near(a.price)} value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price per job" />
            <button
              className="btn quiet small"
              disabled={!!busy}
              onClick={() => {
                let p = "";
                void holder(
                  "price",
                  "set_price",
                  () => {
                    need(price.trim(), "Enter a price in NEAR, for example 0.2.");
                    p = yocto(price);
                    return { price: p };
                  },
                  (v) => v.agent.price === p,
                  () => setPrice(""),
                );
              }}
            >
              {busy === "price" ? "Saving" : "Save"}
            </button>
          </span>
        </div>
        <div className="row">
          <span>{a.listing ? <>Listed for <span className="amount">{near(a.listing)} NEAR</span></> : "Sell this agent"}</span>
          {a.listing ? (
            <button className="btn quiet small" disabled={!!busy} onClick={() => void holder("cancel", "cancel_listing", () => ({}), (v) => !v.agent.listing)}>
              {busy === "cancel" ? "Cancelling" : "Cancel listing"}
            </button>
          ) : (
            <span className="inline">
              <input type="text" inputMode="decimal" placeholder="NEAR" value={sale} onChange={(e) => setSale(e.target.value)} aria-label="Sale price" />
              <button
                className="btn quiet small"
                disabled={!!busy}
                onClick={() =>
                  void holder(
                    "list",
                    "list_for_sale",
                    () => {
                      need(sale.trim(), "Enter a sale price in NEAR, for example 0.5.");
                      return { price: yocto(sale) };
                    },
                    (v) => !!v.agent.listing,
                  )
                }
              >
                {busy === "list" ? "Listing" : "List"}
              </button>
            </span>
          )}
        </div>
      </div>

      {unlocked.knowledge && (
        <div className="section">
          <details>
            <summary>Knowledge</summary>
            <p className="pre" style={{ marginTop: 14 }}>{unlocked.knowledge}</p>
          </details>
        </div>
      )}

      <div className="links">
        <Link href={`/agent/${id}`}>Public page</Link>
        <Link href={`/agent/${id}/history`}>History</Link>
      </div>
    </div>
  );
}
