import { createHash } from "node:crypto";
import bs58 from "bs58";

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest();
export const hashB58 = (text: string) => bs58.encode(sha256(text));
export const hashHex = (text: string) => sha256(text).toString("hex");
