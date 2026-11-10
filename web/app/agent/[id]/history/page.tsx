"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Loading, NotFound } from "@/components/States";
import { AgentView, HistoryEntry, near, useLoad, usePageTitle, view } from "@/lib/near";

const LABELS: Record<string, string> = {
  minted: "Created",
  hired: "Hired",
  delivered: "Delivered",
  accepted: "Accepted and paid",
  auto_accepted: "Paid automatically",
  refunded: "Refunded",
  withdrawn: "Paid out",
  withdraw_failed: "Payout failed",
  transferred: "Transferred",
  sold: "Sold",
};

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function History() {
  usePageTitle("History");
  const { id } = useParams<{ id: string }>();
  const { data, loaded, error } = useLoad(async () => {
    const [v, h] = await Promise.all([
      view<AgentView | null>("get_agent", { token_id: id }),
      view<HistoryEntry[]>("get_history", { token_id: id }),
    ]);
    return { v, h };
  }, [id], 5000);
  if (!loaded) return <Loading error={error} />;
  if (!data?.v) return <NotFound what="agent" />;
  const { v, h } = data;

  const holders = [v.agent.creator];
  for (const e of h) if ((e.kind === "sold" || e.kind === "transferred") && e.counterparty) holders.push(e.counterparty);

  return (
    <div className="narrow stage">
      <h1 className="title">History</h1>
      <div className="stats">
        <div className="stat"><b>{near(v.agent.lifetime_earned)}</b><span>NEAR earned</span></div>
        <div className="stat"><b>{near(v.agent.lifetime_withdrawn)}</b><span>NEAR paid out</span></div>
        <div className="stat"><b>{holders.length}</b><span>{holders.length === 1 ? "Holder" : "Holders"}</span></div>
      </div>

      <div className="section">
        <h2>Held by</h2>
        {holders.map((who, i) => (
          <div className="row" key={`${who}${i}`}>
            <span>{who}</span>
            {i === holders.length - 1 && <span className="chip plain">Now</span>}
          </div>
        ))}
      </div>

      <div className="section">
        <h2>Activity</h2>
        {[...h].reverse().map((e) => (
          <div className="row" key={e.seq}>
            <span>
              {LABELS[e.kind] ?? e.kind}
              <br />
              <span className="muted small">
                {e.kind === "sold" ? `${e.account} to ${e.counterparty}` : e.account}, {when.format(e.timestamp_ms)}
              </span>
            </span>
            {e.amount && <span className="amount">{near(e.amount)} NEAR</span>}
          </div>
        ))}
      </div>

      <div className="links"><Link href={`/agent/${id}`}>Back to agent</Link></div>
    </div>
  );
}
