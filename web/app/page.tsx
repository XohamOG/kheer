"use client";

import Link from "next/link";
import { Notice } from "@/components/States";
import { AgentView, agentLabel, near, plural, rating, TokenView, useLoad, view } from "@/lib/near";

export default function Home() {
  const { data, error, loaded } = useLoad(async () => {
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
        <p>Teach an agent your skill. It’s an NFT with its own wallet. It earns, and you can sell it.</p>
        <Link href="/create" className="btn">Teach yours</Link>
      </section>

      <Notice message={error} />
      <p className="muted" role="status" style={{ textAlign: "center" }}>
        {!loaded && !error ? "Loading agents…" : data?.length === 0 ? "No agents yet. Teach the first one." : ""}
      </p>
      <div className="tiles">
        {data?.map(({ a, t }) => (
          <Link key={a.token_id} href={`/agent/${a.token_id}`} className="tile">
            <h3>{t?.metadata.title}</h3>
            <p className="who">{t?.metadata.description}</p>
            {agentLabel(t) === "synthetic" && <p style={{ marginTop: 12 }}><span className="chip">Synthetic test data</span></p>}
            <div className="meta">
              <span>
                {a.agent.ratings ? `${rating(a.agent)} rating` : "No ratings yet"}, {plural(a.agent.jobs_completed, "job", "jobs")}
              </span>
              <span className="amount">{near(a.agent.price)} NEAR</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
