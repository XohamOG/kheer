"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ReviewCard } from "@/components/ReviewCard";
import { AgentView, api, Review, TGAS, until, useAction, view, yocto } from "@/lib/near";
import { useWallet } from "@/lib/wallet";

interface Case {
  input: string;
  agent: Review;
  plain: Review;
}

export default function Create() {
  const router = useRouter();
  const { account, connect, call } = useWallet();
  const { busy, error, run } = useAction();
  const [step, setStep] = useState(1);
  const [skill, setSkill] = useState("Resume review");
  const [who, setWho] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [synthetic, setSynthetic] = useState(false);
  const [knowledgeHash, setKnowledgeHash] = useState("");
  const [input, setInput] = useState("");
  const [runId, setRunId] = useState<string>();
  const [cases, setCases] = useState<Case[]>([]);
  const [examHash, setExamHash] = useState("");
  const [price, setPrice] = useState("0.1");

  const teach = () =>
    run("teach", async () => {
      const { hash } = await api<{ hash: string }>("/knowledge", { text: knowledge });
      setKnowledgeHash(hash);
      setStep(2);
    });

  const exam = () =>
    run("exam", async () => {
      const r = await api<{ runId: string; cases: Case[] }>("/exam/run", { knowledgeHash, input, runId });
      setRunId(r.runId);
      setCases(r.cases);
      setInput("");
    });

  const approve = () =>
    run("approve", async () => {
      const { hash } = await api<{ hash: string }>("/exam/approve", { runId });
      setExamHash(hash);
      setStep(3);
    });

  const mint = () =>
    run("mint", async () => {
      const { operator } = await api<{ operator: string }>("/health");
      const list = () => view<AgentView[]>("get_agents", { from_index: 0, limit: 500 });
      const before = Math.max(-1, ...(await list()).map((a) => Number(a.token_id)));
      await call({
        method: "mint",
        args: {
          metadata: { title: skill, description: who, extra: synthetic ? "synthetic" : null },
          price: yocto(price),
          knowledge_hash: knowledgeHash,
          exam_hash: examHash,
          operator,
        },
        gas: TGAS(150),
        deposit: yocto("1.5"),
      });
      const made = await until(async () =>
        (await list()).find(
          (a) => Number(a.token_id) > before && a.owner_id === account && a.agent.knowledge_hash === knowledgeHash,
        ),
      );
      router.push(`/agent/${made.token_id}`);
    });

  const readFile = async (f?: File) => f && setKnowledge(await f.text());

  return (
    <div className="narrow">
      <div className="steps">
        {[1, 2, 3].map((n) => <i key={n} className={n <= step ? "on" : ""} />)}
      </div>

      {step === 1 && (
        <>
          <h1 className="title">Teach it.</h1>
          <label>Skill<input type="text" value={skill} onChange={(e) => setSkill(e.target.value)} /></label>
          <label>Taught by<input type="text" value={who} placeholder="Your name and experience" onChange={(e) => setWho(e.target.value)} /></label>
          <label>
            What you know
            <textarea value={knowledge} placeholder="Your checklists, examples and judgement calls." onChange={(e) => setKnowledge(e.target.value)} />
          </label>
          <label>Or upload a text file<input type="file" accept=".txt,.md" onChange={(e) => void readFile(e.target.files?.[0])} /></label>
          <label className="check">
            <input type="checkbox" checked={synthetic} onChange={(e) => setSynthetic(e.target.checked)} />
            This is synthetic test material
          </label>
          <p className="muted small" style={{ marginTop: 14 }}>Use your own methods. Remove other people&apos;s personal data.</p>
          <button className="btn full" style={{ marginTop: 22 }} disabled={!skill.trim() || !who.trim() || !knowledge.trim() || !!busy} onClick={teach}>
            {busy ? "Saving" : "Continue"}
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="title">Test it.</h1>
          <p className="sub">Your agent against a plain AI, on a case you already judged.</p>
          <label>
            Case
            <textarea value={input} placeholder="Paste an anonymised case. It appears in the public exam report." onChange={(e) => setInput(e.target.value)} />
          </label>
          <button className="btn quiet full" style={{ marginTop: 14 }} disabled={!input.trim() || !!busy} onClick={exam}>
            {busy === "exam" ? "Running privately on NEAR AI" : "Run exam"}
          </button>
          {cases.map((c, i) => (
            <div className="compare" key={i}>
              <ReviewCard title="Your agent" review={c.agent} />
              <ReviewCard title="Plain AI" review={c.plain} />
            </div>
          ))}
          {cases.length > 0 && (
            <button className="btn full" style={{ marginTop: 22 }} disabled={!!busy} onClick={approve}>Approve exam</button>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <h1 className="title">Own it.</h1>
          <p className="sub">An NFT with its own wallet.</p>
          <label>Price per job, in NEAR<input type="text" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          {account ? (
            <button className="btn full" style={{ marginTop: 22 }} disabled={!!busy} onClick={mint}>
              {busy ? "Minting" : "Mint for 1.5 NEAR"}
            </button>
          ) : (
            <button className="btn full" style={{ marginTop: 22 }} onClick={() => void connect()}>Connect to mint</button>
          )}
          <p className="muted small" style={{ marginTop: 12 }}>The 1.5 NEAR pays for the agent&apos;s wallet and storage on chain.</p>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
