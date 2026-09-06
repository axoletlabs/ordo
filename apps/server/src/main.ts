import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { APP_NAME } from "@ordo/shared";
import { AppModule } from "./app.module.js";
import { APP_CONFIG } from "./config/config.module.js";
import type { AppConfig } from "./config/config.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const cfg = app.get<AppConfig>(APP_CONFIG);

  // CORS — configurable; defaults to reflecting the request origin.
  app.enableCors({
    origin: (origin, callback) => {
      const allowed = cfg.corsAllowedOrigins;
      if (!allowed.length) {
        // no allowlist configured → reflect origin (self-host friendly default)
        return callback(null, origin ?? true);
      }
      if (!origin || allowed.includes(origin)) {
        return callback(null, origin ?? true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  });

  app.use(cookieParser());

  await app.listen(cfg.port, () => {
    new Logger("Bootstrap").log(`${APP_NAME} server listening on http://localhost:${cfg.port}`);
  });
}

bootstrap().catch((err) => {
  console.error("Failed to bootstrap", err);
  process.exit(1);
});
