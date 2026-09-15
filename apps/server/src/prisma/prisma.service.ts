import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaClient } from "./client.js";
import { createPrismaAdapter } from "./create-adapter.js";
import { applyDatabaseUpgrades } from "./schema-boot.js";

/**
 * Wraps PrismaClient with lifecycle hooks. Resolves the database URL from
 * resolved config so the app works with zero env config (SQLite default).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(APP_CONFIG) private readonly cfg: { databaseUrl: string }) {
    super({
      adapter: createPrismaAdapter(cfg.databaseUrl),
      log: ["warn", "error"],
    });
  }

  async onModuleInit() {
    await applyDatabaseUpgrades(this, this.cfg.databaseUrl, (message) => this.logger.log(message));
    this.logger.log(`Connected to database (${this.mask(this.cfg.databaseUrl)})`);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private mask(url: string): string {
    return url.startsWith("file:") ? `file:${url.slice(5).split("/").pop()}` : "postgres";
  }
}
