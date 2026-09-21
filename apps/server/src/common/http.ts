import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Request } from "express";
import cookieParser from "cookie-parser";
import { CSRF_TOKEN_HEADER, IMPORT_EXPORT } from "@ordo/shared";
import type { AppConfig } from "../config/config.module.js";
import { corsOriginAllowed } from "./utils/cors-origin.js";

/**
 * Shared HTTP setup for `main.ts` and e2e: trust proxy, CORS, cookies,
 * and baseline security headers.
 * CORS never reflects an unknown Origin. Empty allowlist = this API's origin
 * plus loopback (Expo web on another port). A set list (ordo Cloud) is exact.
 */
export function applyHttp(app: NestExpressApplication, cfg: AppConfig): void {
  app.set("trust proxy", cfg.trustProxy);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  // Native import sends the file as JSON; escaping can nearly double the bytes.
  app.useBodyParser("json", { limit: IMPORT_EXPORT.MAX_FILE_BYTES * 2 + 5 * 1024 * 1024 });
  app.enableCors((incoming, callback) => {
    const req = incoming as Request;
    const origin = req.get("origin") || undefined;
    const allowed = corsOriginAllowed(
      origin,
      { protocol: req.protocol, host: req.get("host") ?? "" },
      cfg.corsAllowedOrigins,
    );
    callback(null, {
      origin: allowed ? origin || true : false,
      credentials: true,
      exposedHeaders: [CSRF_TOKEN_HEADER],
    });
  });
  app.use(cookieParser());
}
