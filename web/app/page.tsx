"use client";

import Link from "next/link";
import { AgentView, agentLabel, near, rating, TokenView, useLoad, view } from "@/lib/near";

export default function Home() {
  const { data, error } = useLoad(async () => {
    const [agents, tokens] = await Promise.all([
      view<AgentView[]>("get_agents", { from_index: 0, limit: 60 }),
      view<TokenView[]>("nft_tokens", { from_index: "0", limit: 60 }),
    ]);
    return agents.map((a) => ({ a, t: tokens.find((t) => t.token_id === a.token_id) })).reverse();
  }, []);

  return (
    <div className="page">
      <section className="hero">
        <h1>
          AI is learning your job.
          <br />
          Own the AI that does it.
        </h1>
        <p>Teach an agent your skill. It&apos;s an NFT with its own wallet. It earns, and you can sell it.</p>
        <Link href="/create" className="btn">Teach yours</Link>
      </section>

      {error && <p className="error">{error}</p>}
      {data && data.length === 0 && <p className="muted" style={{ textAlign: "center" }}>No agents yet. Teach the first one.</p>}
      <div className="tiles">
        {data?.map(({ a, t }) => (
          <Link key={a.token_id} href={`/agent/${a.token_id}`} className="tile">
            <h3>{t?.metadata.title}</h3>
            <p className="who">{t?.metadata.description}</p>
            {agentLabel(t) === "synthetic" && <p style={{ marginTop: 12 }}><span className="chip">Synthetic test data</span></p>}
            <div className="meta">
              <span>{rating(a.agent)} rating, {a.agent.jobs_completed} jobs</span>
              <span>{near(a.agent.price)} NEAR</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
