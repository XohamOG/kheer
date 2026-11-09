import { randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { verifyMessage } from "near-api-js/nep413";
import { config } from "./config.js";
import { Agent, provider, view } from "./chain.js";
import { inferenceReady, reviewPlain, reviewWithKnowledge, Review } from "./ai.js";
import { hashB58, hashHex } from "./hash.js";
import { Store } from "./store.js";
import { StoredRequest, StoredResult } from "./worker.js";

const MAX_KNOWLEDGE = 64_000;
const MAX_SUBMISSION = 16_000;

interface Case {
  input: string;
  agent: Review;
  plain: Review;
}
interface ExamRun {
  knowledgeHash: string;
  cases: Case[];
}

/** Fixed-window limit per client, to protect the inference budget. */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; at: number }>();
  return (id: string) => {
    const now = Date.now();
    const h = hits.get(id);
    if (!h || now - h.at > windowMs) {
      hits.set(id, { n: 1, at: now });
      return true;
    }
    h.n += 1;
    return h.n <= max;
  };
}

export function createApp(store: Store) {
  const app = new Hono();
  const runs = new Map<string, ExamRun>();
  const seenNonces = new Set<string>();
  const examLimit = limiter(15, 3_600_000);
  const writeLimit = limiter(60, 3_600_000);
  const client = (c: { req: { header(n: string): string | undefined } }) =>
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

  app.use("*", cors({ origin: config.webOrigin.split(",") }));
  app.onError((e, c) => {
    console.error(e.message);
    return c.json({ error: e.message }, 500);
  });

  app.get("/health", (c) =>
    c.json({
      operator: config.runtimeAccount,
      registry: config.registry,
      model: config.model,
      inference: config.stub ? "stub" : inferenceReady() ? "ready" : "missing_key",
    }),
  );

  app.post("/knowledge", async (c) => {
    if (!writeLimit(client(c))) return c.json({ error: "Too many requests. Try again in an hour." }, 429);
    const { text } = await c.req.json<{ text: string }>();
    if (!text?.trim() || text.length > MAX_KNOWLEDGE)
      return c.json({ error: "Knowledge must be 1 to 64,000 characters." }, 400);
    const hash = hashB58(text);
    store.put("knowledge", hash, { text });
    return c.json({ hash });
  });

  app.post("/exam/run", async (c) => {
    if (!inferenceReady()) return c.json({ error: "AI is not configured on this server." }, 503);
    if (!examLimit(client(c))) return c.json({ error: "Exam limit reached. Try again in an hour." }, 429);
    const { knowledgeHash, input, runId } = await c.req.json<{
      knowledgeHash: string;
      input: string;
      runId?: string;
    }>();
    const k = store.get<{ text: string }>("knowledge", knowledgeHash);
    if (!k) return c.json({ error: "Knowledge not found." }, 404);
    if (!input?.trim() || input.length > MAX_SUBMISSION)
      return c.json({ error: "Case must be 1 to 16,000 characters." }, 400);
    const [agent, plain] = await Promise.all([reviewWithKnowledge(k.text, input), reviewPlain(input)]);
    const id = runId && runs.has(runId) ? runId : randomUUID();
    const run = runs.get(id) ?? { knowledgeHash, cases: [] };
    run.cases.push({ input, agent, plain });
    runs.set(id, run);
    return c.json({ runId: id, cases: run.cases });
  });

  app.post("/exam/approve", async (c) => {
    const { runId } = await c.req.json<{ runId: string }>();
    const run = runs.get(runId);
    if (!run?.cases.length) return c.json({ error: "Run the exam first." }, 400);
    const report = JSON.stringify({
      knowledgeHash: run.knowledgeHash,
      model: config.model,
      approved: run.cases.length,
      cases: run.cases,
    });
    const hash = hashB58(report);
    store.put("exams", hash, { report });
    runs.delete(runId);
    return c.json({ hash });
  });

  app.get("/exam/:hash", (c) => {
    const e = store.get<{ report: string }>("exams", c.req.param("hash"));
    return e ? c.body(e.report, 200, { "content-type": "application/json" }) : c.json({ error: "Not found" }, 404);
  });

  app.post("/requests", async (c) => {
    if (!writeLimit(client(c))) return c.json({ error: "Too many requests. Try again in an hour." }, 429);
    const { submission, viewKeyHash } = await c.req.json<StoredRequest>();
    if (!submission?.trim() || submission.length > MAX_SUBMISSION)
      return c.json({ error: "Text must be 1 to 16,000 characters." }, 400);
    if (!/^[0-9a-f]{64}$/.test(viewKeyHash ?? "")) return c.json({ error: "Bad view key." }, 400);
    const hash = hashB58(JSON.stringify({ submission, viewKeyHash }));
    store.put("requests", hash, { submission, viewKeyHash });
    return c.json({ hash });
  });

  /** Only the browser that created the request holds the view key. */
  app.post("/results/:job", async (c) => {
    const { viewKey, requestHash } = await c.req.json<{ viewKey: string; requestHash: string }>();
    const request = store.get<StoredRequest>("requests", requestHash);
    if (!request || request.viewKeyHash !== hashHex(viewKey ?? "")) return c.json({ error: "Not your job." }, 403);
    const job = await view<{ request_hash: string } | null>("get_job", { job_id: Number(c.req.param("job")) });
    if (!job || job.request_hash !== requestHash) return c.json({ error: "Not your job." }, 403);
    const result = store.get<StoredResult>("results", c.req.param("job"));
    return result ? c.json({ body: result.body, submission: request.submission }) : c.json({ pending: true });
  });

  /** NEP-413 proof that the caller holds the token right now. */
  app.post("/holder/:token", async (c) => {
    const token = c.req.param("token");
    const b = await c.req.json<{
      accountId: string;
      publicKey: string;
      signature: string;
      nonce: string;
      message: string;
      recipient: string;
    }>();
    const stamp = Number(b.message?.match(/^Open Kheer agent (\d+) at (\d+)$/)?.[2]);
    if (b.message !== `Open Kheer agent ${token} at ${stamp}` || Math.abs(Date.now() - stamp) > 300_000)
      return c.json({ error: "Expired proof." }, 401);
    if (b.recipient !== "kheer" || seenNonces.has(b.nonce)) return c.json({ error: "Bad proof." }, 401);
    try {
      await verifyMessage({
        signerAccountId: b.accountId,
        signerPublicKey: b.publicKey,
        signature: Buffer.from(b.signature, "base64"),
        payload: { message: b.message, recipient: b.recipient, nonce: Buffer.from(b.nonce, "base64") },
        provider,
      });
    } catch {
      return c.json({ error: "Signature did not verify." }, 401);
    }
    seenNonces.add(b.nonce);
    const agent = await view<Agent | null>("get_agent", { token_id: token });
    if (!agent) return c.json({ error: "Agent not found." }, 404);
    if (agent.owner_id !== b.accountId) return c.json({ error: "Only the current holder can open this." }, 403);
    const k = store.get<{ text: string }>("knowledge", agent.agent.knowledge_hash);
    return c.json({ knowledge: k?.text ?? null });
  });

  /** Fetches NEAR AI's attestation with a fresh client nonce. Evidence, not a local verification. */
  app.get("/attestation", async (c) => {
    const nonce = randomBytes(32).toString("hex");
    const url = `https://cloud-api.near.ai/v1/attestation/report?signing_algo=ecdsa&nonce=${nonce}&model=${encodeURIComponent(config.model)}&provider=near`;
    const res = await fetch(url, { headers: { "x-no-aliasing": "true" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return c.json({ error: `NEAR AI returned ${res.status}` }, 502);
    const body = (await res.json()) as { gateway_attestation?: unknown; model_attestations?: unknown[] };
    return c.json({
      model: config.model,
      nonce,
      gateway_quote: Boolean(body.gateway_attestation),
      model_attestations: body.model_attestations?.length ?? 0,
      report: body,
    });
  });

  return app;
}
