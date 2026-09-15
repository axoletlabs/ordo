import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL ?? "file:./ordo.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
