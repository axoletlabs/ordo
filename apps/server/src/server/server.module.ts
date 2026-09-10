import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ServerController } from "./server.controller.js";
import { ServerService } from "./server.service.js";

@Module({
  imports: [AuthModule],
  controllers: [ServerController],
  providers: [ServerService],
})
export class ServerModule {}
