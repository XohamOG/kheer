// Writes .env for a registry, using the operator's function-call key from the
// legacy keychain. Usage: node scripts/write-env.cjs <registry> <operator>
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execSync } = require("child_process");

const [registry, operator] = process.argv.slice(2);
if (!registry || !operator) throw new Error("Usage: write-env.cjs <registry> <operator>");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  console.log(".env already exists. Move it aside to regenerate it.");
  process.exit(1);
}
const keys = execSync(`near account list-keys ${operator} network-config testnet now 2>&1`).toString();
const line = keys.split("\n").find((l) => l.includes(`on ${registry}`)) || "";
const pub = (line.match(/ed25519:[1-9A-HJ-NP-Za-km-z]+/) || [])[0];
if (!pub) throw new Error(`No function-call key on ${operator} for ${registry}`);

const dir = path.join(os.homedir(), ".near-credentials", "testnet", operator);
const key = fs
  .readdirSync(dir)
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f))))
  .find((k) => k.public_key === pub);
if (!key) throw new Error("Key file not found");

fs.writeFileSync(
  envPath,
  [
    "NEAR_NETWORK=testnet",
    `REGISTRY_ACCOUNT=${registry}`,
    `RUNTIME_ACCOUNT=${operator}`,
    `RUNTIME_PRIVATE_KEY=${key.private_key}`,
    "NEARAI_API_KEY=",
    "NEARAI_MODEL=z-ai/glm-5.3-flash",
    `KNOWLEDGE_ENCRYPTION_KEY=${crypto.randomBytes(32).toString("hex")}`,
    "",
  ].join("\n"),
);
console.log(".env written");
