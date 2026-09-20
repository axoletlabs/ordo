import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "@nestjs/common";
import { APP_NAME } from "@ordo/shared";
import { AppModule } from "./app.module.js";
import { APP_CONFIG } from "./config/config.module.js";
import type { AppConfig } from "./config/config.module.js";
import { applyHttp } from "./common/http.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const cfg = app.get<AppConfig>(APP_CONFIG);
  applyHttp(app, cfg);

  await app.listen(cfg.port, () => {
    new Logger("Bootstrap").log(`${APP_NAME} server listening on http://localhost:${cfg.port}`);
  });
}

bootstrap().catch((err) => {
  console.error("Failed to bootstrap", err);
  process.exit(1);
});
