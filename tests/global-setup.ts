import { execSync } from "child_process";
import path from "path";

/**
 * Creates a FRESH test database (tests/test.db) via prisma db push.
 * The dev database (prisma/dev.db) is never touched.
 */
export default function globalSetup() {
  const testDb = path.resolve(__dirname, "test.db");
  execSync(`npx prisma db push --force-reset --skip-generate`, {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: `file:${testDb.replace(/\\/g, "/")}` },
    stdio: "pipe",
  });
}
