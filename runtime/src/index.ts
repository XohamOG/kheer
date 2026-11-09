import { serve } from "@hono/node-server";
import path from "node:path";
import { config } from "./config.js";
import { createApp } from "./server.js";
import { inferenceReady } from "./ai.js";
import { Store } from "./store.js";
import { startWorker } from "./worker.js";

const store = new Store(path.resolve(config.dataDir), config.encryptionKey);
serve({ fetch: createApp(store).fetch, port: config.port }, () => {
  console.log(`runtime on :${config.port}, operator ${config.runtimeAccount}`);
  if (config.stub) console.log("INFERENCE_STUB=1: results are labelled test stubs");
  else if (!inferenceReady()) console.log("NEARAI_API_KEY missing: jobs wait until it is set");
});
startWorker(store);
