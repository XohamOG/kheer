import { config as load } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
load({ path: path.join(root, ".env"), quiet: true });

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name} in .env (see .env.example)`);
  return v;
}

export const config = {
  registry: need("REGISTRY_ACCOUNT"),
  runtimeAccount: need("RUNTIME_ACCOUNT"),
  runtimeKey: need("RUNTIME_PRIVATE_KEY"),
  encryptionKey: Buffer.from(need("KNOWLEDGE_ENCRYPTION_KEY"), "hex"),
  rpcUrl: process.env.RPC_URL ?? "https://test.rpc.fastnear.com",
  nearAiKey: process.env.NEARAI_API_KEY ?? "",
  model: process.env.NEARAI_MODEL ?? "z-ai/glm-5.3-flash",
  stub: process.env.INFERENCE_STUB === "1",
  port: Number(process.env.PORT ?? 8787),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  dataDir: process.env.DATA_DIR ?? path.join(root, "runtime", "data"),
  root,
};
if (config.encryptionKey.length !== 32) throw new Error("KNOWLEDGE_ENCRYPTION_KEY must be 64 hex characters");
