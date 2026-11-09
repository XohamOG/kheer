"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AgentView, api, near, ONE_YOCTO, TGAS, until, useAction, useLoad, view, yocto } from "@/lib/near";
import { useWallet } from "@/lib/wallet";

export default function Owner() {
  const { id } = useParams<{ id: string }>();
  const { account, connect, call, prove } = useWallet();
  const { busy, error, run } = useAction();
  const [unlocked, setUnlocked] = useState<{ knowledge: string | null; as: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [sale, setSale] = useState("");
  const [price, setPrice] = useState("");

  const { data, reload } = useLoad(() => view<AgentView | null>("get_agent", { token_id: id }), [id], 4000);
  if (!data) return null;
  const a = data.agent;

  if (!account)
    return (
      <div className="gate">
        <h1 className="title">Holder only.</h1>
        <p>Connect the wallet that holds this agent.</p>
        <button className="btn" onClick={() => void connect()}>Connect</button>
      </div>
    );

  if (account !== data.owner_id)
    return (
      <div className="gate">
        <h1 className="title">Locked.</h1>
        <p>Only the current holder can open this. {data.owner_id} holds it.</p>
        <Link className="btn quiet" href={`/agent/${id}`}>Back to agent</Link>
      </div>
    );

  if (unlocked?.as !== account)
    return (
      <div className="gate">
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
        {error && <p className="error">{error}</p>}
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

  const holder = (name: string, method: string, args: object, check: (v: AgentView) => boolean) =>
    run(name, async () => {
      await call({ method, args: { token_id: id, ...args }, gas: TGAS(30), deposit: ONE_YOCTO });
      await settle(check);
    });

  const runtimeOperator = async () => (await api<{ operator: string }>("/health")).operator;

  return (
    <div className="narrow">
      <div className="wallet">
        <b>{near(a.available)}</b>
        <span>NEAR in this agent&apos;s wallet</span>
      </div>

      <div className="inline" style={{ justifyContent: "center" }}>
        <input type="text" placeholder="All" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount to withdraw" />
        <button className="btn" disabled={BigInt(a.available) === 0n || !!busy} onClick={withdraw}>
          {busy === "withdraw" ? "Withdrawing" : "Withdraw"}
        </button>
      </div>
      {error && <p className="error" style={{ textAlign: "center" }}>{error}</p>}

      <div className="section">
        <div className="row">
          <span>{a.operator ? "Online" : "Offline"}</span>
          <button
            className="btn quiet small"
            disabled={!!busy}
            onClick={async () => {
              const next = a.operator ? null : await runtimeOperator();
              await holder("operator", "set_operator", { operator: next }, (v) => v.agent.operator === next);
            }}
          >
            {busy === "operator" ? "Saving" : a.operator ? "Take offline" : "Go online"}
          </button>
        </div>
        <div className="row">
          <span>Price per job</span>
          <span className="inline">
            <input type="text" placeholder={near(a.price)} value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price per job" />
            <button
              className="btn quiet small"
              disabled={!price.trim() || !!busy}
              onClick={() => {
                const p = yocto(price);
                void holder("price", "set_price", { price: p }, (v) => v.agent.price === p).then(() => setPrice(""));
              }}
            >
              Save
            </button>
          </span>
        </div>
        <div className="row">
          <span>{a.listing ? `Listed for ${near(a.listing)} NEAR` : "Sell this agent"}</span>
          {a.listing ? (
            <button className="btn quiet small" disabled={!!busy} onClick={() => void holder("cancel", "cancel_listing", {}, (v) => !v.agent.listing)}>Cancel</button>
          ) : (
            <span className="inline">
              <input type="text" placeholder="NEAR" value={sale} onChange={(e) => setSale(e.target.value)} aria-label="Sale price" />
              <button
                className="btn quiet small"
                disabled={!sale.trim() || !!busy}
                onClick={() => void holder("list", "list_for_sale", { price: yocto(sale) }, (v) => !!v.agent.listing)}
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
