import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { HealthController } from "./health.controller.js";
import { ServerController } from "./server.controller.js";
import { ServerService } from "./server.service.js";

@Module({
  imports: [AuthModule],
  controllers: [HealthController, ServerController],
  providers: [ServerService],
})
export class ServerModule {}
