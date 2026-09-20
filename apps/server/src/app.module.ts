import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_PIPE } from "@nestjs/core";
import { AppConfigModule } from "./config/config.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter.js";
import { CsrfGuard } from "./common/guards/csrf.guard.js";
import { ClientIpMiddleware } from "./common/middleware/client-ip.middleware.js";
import { createStandardSchemaPipe } from "./common/pipes/standard-schema-pipe.js";
import { RateLimitModule } from "./common/rate-limit/rate-limit.module.js";
import { LibraryCryptoModule } from "./crypto/library-crypto.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { BookmarksModule } from "./bookmarks/bookmarks.module.js";
import { ImportExportModule } from "./import-export/import-export.module.js";
import { ServerModule } from "./server/server.module.js";
import { TelemetryModule } from "./telemetry/telemetry.module.js";

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    LibraryCryptoModule,
    RateLimitModule,
    AuthModule,
    BookmarksModule,
    ImportExportModule,
    ServerModule,
    TelemetryModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useFactory: createStandardSchemaPipe },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ClientIpMiddleware).forRoutes("*");
  }
}
