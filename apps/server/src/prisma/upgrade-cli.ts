import { loadConfig } from "../config/configuration.js";
import { PrismaClient } from "./client.js";
import { createPrismaAdapter } from "./create-adapter.js";
import { applyDatabaseUpgrades } from "./schema-boot.js";

/**
 * One-shot schema upgrade for `./scripts/deploy-server update`.
 * Applies pending Prisma migrations, adopts old db-push files, and refreshes FTS.
 */
async function main(): Promise<void> {
  const cfg = loadConfig();
  const prisma = new PrismaClient({
    adapter: createPrismaAdapter(cfg.databaseUrl),
    log: ["warn", "error"],
  });
  try {
    const result = await applyDatabaseUpgrades(prisma, cfg.databaseUrl, (message) => {
      console.log(message);
    });
    const db = cfg.databaseUrl.startsWith("file:")
      ? cfg.databaseUrl.slice("file:".length).split("/").pop()
      : cfg.databaseUrl;
    console.log(`Database ready (${result}) file:${db}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exit(1);
});
