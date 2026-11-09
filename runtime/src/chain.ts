import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, teraToGas } from "near-api-js";
import { config } from "./config.js";

export const provider = new JsonRpcProvider({ url: config.rpcUrl });

export interface Agent {
  owner_id: string;
  token_id: string;
  agent: { operator: string | null; knowledge_hash: string; exam_hash: string | null };
}
export interface Job {
  id: number;
  token_id: string;
  customer: string;
  status: string;
  request_hash: string;
  result_hash: string | null;
  deliver_by_ms: number;
}

export const view = <T>(method: string, args: Record<string, unknown>) =>
  provider.callFunction({ contractId: config.registry, method, args }) as Promise<T>;

const signer = new KeyPairSigner(KeyPair.fromString(config.runtimeKey as `ed25519:${string}`));
const account = new Account(config.runtimeAccount, provider, signer);

export const deliver = (jobId: number, resultHash: string) =>
  account.callFunction({
    contractId: config.registry,
    methodName: "deliver",
    args: { job_id: jobId, result_hash: resultHash },
    gas: teraToGas(30),
  });
