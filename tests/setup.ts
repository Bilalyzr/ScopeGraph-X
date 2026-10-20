import path from "path";

// Point the app's Prisma client at the fresh test database BEFORE any module import.
process.env.DATABASE_URL = `file:${path.resolve(__dirname, "test.db").replace(/\\/g, "/")}`;
process.env.EVIDENCE_STORE_DIR = ".data/test-evidence";
process.env.EVIDENCE_ENCRYPTION_KEY = "ab".repeat(32); // deterministic test key
