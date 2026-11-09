import { config } from "./config.js";
import { Agent, deliver, Job, view } from "./chain.js";
import { inferenceReady, reviewWithKnowledge, Review } from "./ai.js";
import { hashB58 } from "./hash.js";
import { Store } from "./store.js";

export interface StoredRequest {
  submission: string;
  viewKeyHash: string;
}
export interface StoredResult {
  body: string;
}

const POLL_MS = 3000;
const MAX_ATTEMPTS = 3;

export async function processJob(store: Store, job: Job): Promise<"done" | "skip"> {
  const agent = await view<Agent | null>("get_agent", { token_id: job.token_id });
  if (!agent || agent.agent.operator !== config.runtimeAccount) return "skip";
  if (Date.now() > job.deliver_by_ms) return "skip";

  let saved = store.get<StoredResult>("results", String(job.id));
  if (!saved) {
    const request = store.get<StoredRequest>("requests", job.request_hash);
    const knowledge = store.get<{ text: string }>("knowledge", agent.agent.knowledge_hash);
    if (!request || !knowledge) return "skip";
    const review: Review = await reviewWithKnowledge(knowledge.text, request.submission);
    saved = { body: JSON.stringify({ ...review, model: config.model, job: job.id }) };
    store.put("results", String(job.id), saved);
  }
  await deliver(job.id, hashB58(saved.body));
  return "done";
}

export function startWorker(store: Store) {
  let cursor = 0;
  const attempts = new Map<number, number>();

  async function tick() {
    if (!inferenceReady()) return;
    const jobs = await view<Job[]>("get_jobs", { from_index: cursor, limit: 50 });
    let advancing = true;
    for (const job of jobs) {
      if (job.status !== "Hired") {
        if (advancing) cursor = job.id + 1;
        continue;
      }
      advancing = false;
      const tries = attempts.get(job.id) ?? 0;
      if (tries >= MAX_ATTEMPTS) continue;
      try {
        const r = await processJob(store, job);
        if (r === "done") console.log(`delivered job ${job.id}`);
      } catch (e) {
        attempts.set(job.id, tries + 1);
        console.error(`job ${job.id} failed (try ${tries + 1}):`, (e as Error).message);
      }
    }
  }

  const loop = async () => {
    try {
      await tick();
    } catch (e) {
      console.error("poll failed:", (e as Error).message);
    }
    setTimeout(loop, POLL_MS);
  };
  void loop();
}
