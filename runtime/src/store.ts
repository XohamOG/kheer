import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** AES-256-GCM files on disk. Holds knowledge packs, requests and results. */
export class Store {
  constructor(private dir: string, private key: Buffer) {}

  private file(kind: string, id: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Bad id");
    const d = path.join(this.dir, kind);
    mkdirSync(d, { recursive: true });
    return path.join(d, id);
  }

  put(kind: string, id: string, value: unknown) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
    writeFileSync(this.file(kind, id), Buffer.concat([iv, c.getAuthTag(), body]));
  }

  get<T>(kind: string, id: string): T | null {
    const f = this.file(kind, id);
    if (!existsSync(f)) return null;
    const raw = readFileSync(f);
    const d = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8"));
  }
}
