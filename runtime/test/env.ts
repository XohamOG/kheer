// Placeholder values so unit tests run from a clean clone with no .env.
// Unit tests never touch the chain, so the key is never parsed. Real values win.
process.env.REGISTRY_ACCOUNT ??= "registry.test";
process.env.RUNTIME_ACCOUNT ??= "operator.test";
process.env.RUNTIME_PRIVATE_KEY ??= "unit-test-placeholder";
process.env.KNOWLEDGE_ENCRYPTION_KEY ??= "00".repeat(32);
