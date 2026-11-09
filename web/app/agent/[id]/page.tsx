"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ReviewCard } from "@/components/ReviewCard";
import {
  AgentView, agentLabel, api, JOB_FEE, Job, near, rating, Review, RUNTIME, sha256Hex, TGAS, TokenView, until, useAction, useLoad, view,
} from "@/lib/near";
import { useWallet } from "@/lib/wallet";

interface Exam {
  approved: number;
  cases: { agent: Review; plain: Review }[];
}

export default function Agent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { account, connect, call } = useWallet();
  const { busy, error, run } = useAction();
  const [text, setText] = useState("");

  const { data, error: loadError, reload } = useLoad(async () => {
    const [v, t] = await Promise.all([
      view<AgentView | null>("get_agent", { token_id: id }),
      view<TokenView | null>("nft_token", { token_id: id }),
    ]);
    const exam = v?.agent.exam_hash ? await api<Exam>(`/exam/${v.agent.exam_hash}`).catch(() => null) : null;
    return { v, t, exam };
  }, [id]);

  if (loadError) return <div className="gate"><p>{loadError}</p></div>;
  if (!data) return null;
  if (!data.v) return <div className="gate"><h1 className="title">Agent not found.</h1></div>;
  const { v, t, exam } = data;
  const a = v.agent;
  const total = BigInt(a.price) + JOB_FEE;
  const holder = account === v.owner_id;

  const hire = () =>
    run("hire", async () => {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const viewKey = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const { hash } = await api<{ hash: string }>("/requests", { submission: text, viewKeyHash: await sha256Hex(viewKey) });
      localStorage.setItem(`kheer:key:${hash}`, viewKey);
      await call({ method: "hire", args: { token_id: id, request_hash: hash }, gas: TGAS(30), deposit: total.toString() });
      const job = await until(async () => {
        const jobs = await view<Job[]>("get_agent_jobs", { token_id: id, from_index: Math.max(0, a.jobs_total - 5), limit: 50 });
        return jobs.find((j) => j.request_hash === hash);
      });
      router.push(`/job/${job.id}`);
    });

  const buy = () =>
    run("buy", async () => {
      await call({ method: "buy", args: { token_id: id, min_available: a.available }, gas: TGAS(60), deposit: a.listing! });
      await until(async () => ((await view<AgentView>("get_agent", { token_id: id })).owner_id === account ? true : null));
      router.push(`/agent/${id}/owner`);
    });

  return (
    <div className="narrow">
      <h1 className="title">{t?.metadata.title}</h1>
      <p className="sub">{t?.metadata.description}</p>
      <p style={{ marginTop: 14, display: "flex", gap: 8 }}>
        {exam && <span className="chip plain">Passed exam</span>}
        {agentLabel(t) === "synthetic" && <span className="chip">Synthetic test data</span>}
      </p>

      <div className="stats">
        <div className="stat"><b>{a.jobs_completed}</b><span>Jobs</span></div>
        <div className="stat"><b>{rating(a)}</b><span>Rating</span></div>
        <div className="stat"><b>{near(a.lifetime_earned)}</b><span>NEAR earned</span></div>
      </div>

      <div className="section">
        {a.operator ? (
          <>
            <label style={{ marginTop: 0 }}>
              Paste your work
              <textarea value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            {account ? (
              <button className="btn full" style={{ marginTop: 14 }} disabled={!text.trim() || !!busy} onClick={hire}>
                {busy === "hire" ? "Hiring" : `Hire for ${near(total)} NEAR`}
              </button>
            ) : (
              <button className="btn full" style={{ marginTop: 14 }} onClick={() => void connect()}>Connect to hire</button>
            )}
            <p className="muted small" style={{ marginTop: 10 }}>Held in escrow until you accept the result.</p>
          </>
        ) : (
          <p className="muted">This agent is offline.</p>
        )}
      </div>

      {a.listing && !holder && (
        <div className="section">
          <h2>For sale</h2>
          <div className="row"><span className="muted">Price</span><span>{near(a.listing)} NEAR</span></div>
          <div className="row"><span className="muted">Wallet comes with</span><span>{near(a.available)} NEAR</span></div>
          <div className="row"><span className="muted">Record comes with</span><span>{a.jobs_completed} jobs</span></div>
          {account ? (
            <button className="btn full" style={{ marginTop: 14 }} disabled={!!busy} onClick={buy}>
              {busy === "buy" ? "Buying" : `Buy for ${near(a.listing)} NEAR`}
            </button>
          ) : (
            <button className="btn full" style={{ marginTop: 14 }} onClick={() => void connect()}>Connect to buy</button>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <button hidden onClick={() => void reload()} />

      {exam?.cases[0] && (
        <div className="section">
          <h2>Exam</h2>
          <div className="compare" style={{ marginTop: 0 }}>
            <ReviewCard title="This agent" review={exam.cases[0].agent} />
            <ReviewCard title="Plain AI" review={exam.cases[0].plain} />
          </div>
        </div>
      )}

      <div className="links">
        {holder && <Link href={`/agent/${id}/owner`}>Holder page</Link>}
        <Link href={`/agent/${id}/history`}>History</Link>
        <a href={`https://testnet.nearblocks.io/address/${a.vault}`} target="_blank" rel="noreferrer">Wallet on chain</a>
        <a href={`${RUNTIME}/attestation`} target="_blank" rel="noreferrer">Private AI proof</a>
      </div>
    </div>
  );
}
