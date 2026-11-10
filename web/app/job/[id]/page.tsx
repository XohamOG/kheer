"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ReviewCard } from "@/components/ReviewCard";
import { Loading, NotFound, Notice } from "@/components/States";
import { api, Job, near, ONE_YOCTO, Review, sha256B58, TGAS, useAction, useLoad, usePageTitle, view } from "@/lib/near";
import { useWallet } from "@/lib/wallet";

const ORDER = ["Hired", "Delivered", "Accepted"];

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const { account, call } = useWallet();
  const { busy, error, run } = useAction();
  const [stars, setStars] = useState(5);

  usePageTitle(`Job ${id}`);
  const { data, reload, loaded, error: loadError } = useLoad(async () => {
    const job = await view<Job | null>("get_job", { job_id: Number(id) });
    if (!job) return null;
    const viewKey = localStorage.getItem(`kheer:key:${job.request_hash}`);
    let review: Review | null = null;
    let verified = false;
    if (viewKey && job.result_hash) {
      const r = await api<{ body?: string }>(`/results/${id}`, { viewKey, requestHash: job.request_hash });
      if (r.body) {
        review = JSON.parse(r.body);
        verified = (await sha256B58(r.body)) === job.result_hash;
      }
    }
    return { job, review, verified, mine: Boolean(viewKey) };
  }, [id], 3000);

  if (!loaded) return <Loading error={loadError} />;
  if (!data?.job) return <NotFound what="job" />;
  const { job, review, verified, mine } = data;
  const reached = job.status === "Refunded" ? 1 : ORDER.indexOf(job.status) + 1;
  const now = Date.now();
  const customer = account === job.customer;

  const send = (name: string, method: string, args: object, deposit = "0") =>
    run(name, async () => {
      await call({ method, args: { job_id: job.id, ...args }, gas: TGAS(30), deposit });
      await reload();
    });

  const heading: Record<Job["status"], string> = {
    Hired: "Working on it.",
    Delivered: "Your result.",
    Accepted: "Paid.",
    Refunded: "Refunded.",
  };

  return (
    <div className="narrow stage">
      <div className="steps" aria-hidden="true">
        {ORDER.map((s, i) => <i key={s} className={i < reached ? "on" : ""} />)}
      </div>
      <div role="status">
      <h1 className="title">{heading[job.status]}</h1>
      <p className="sub">
        {job.status === "Accepted"
          ? `${near(job.amount)} NEAR moved to the agent's wallet.`
          : job.status === "Refunded"
            ? `${near(job.amount)} NEAR returned to ${job.customer}.`
            : `${near(job.amount)} NEAR in escrow.`}
      </p>
      </div>

      {review && (
        <div className="section">
          <ReviewCard title="Review" review={review} />
          {verified && <p className="muted small" style={{ marginTop: 10 }}>Matches the hash on chain.</p>}
        </div>
      )}
      {job.result_hash && !mine && <p className="muted section">Only the customer who hired it can read this result.</p>}

      {job.status === "Delivered" && customer && (
        <div className="section">
          <h2>Rate it</h2>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={n === stars ? "on" : ""} onClick={() => setStars(n)} aria-label={`${n} of 5`}>{n}</button>
            ))}
          </div>
          <button className="btn full" disabled={!!busy} onClick={() => send("accept", "accept", { rating: stars }, ONE_YOCTO)}>
            {busy ? "Paying" : "Accept and pay"}
          </button>
        </div>
      )}

      {job.status === "Hired" && now > job.deliver_by_ms && account && (
        <button className="btn full section" disabled={!!busy} onClick={() => send("refund", "refund", {})}>Refund</button>
      )}
      {job.status === "Delivered" && job.accept_by_ms !== null && now > job.accept_by_ms && account && !customer && (
        <button className="btn full section" disabled={!!busy} onClick={() => send("finalize", "finalize", {})}>Release payment</button>
      )}

      <Notice message={error} />
      <div className="links">
        <Link href={`/agent/${job.token_id}`}>Agent</Link>
        <Link href={`/agent/${job.token_id}/history`}>History</Link>
      </div>
    </div>
  );
}
