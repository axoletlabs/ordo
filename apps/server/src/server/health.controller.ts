import { Controller, Get } from "@nestjs/common";
import type { HealthDto } from "@ordo/shared";
import { ServerService } from "./server.service.js";

@Controller("api")
export class HealthController {
  constructor(private readonly server: ServerService) {}

  @Get("health")
  health(): Promise<HealthDto> {
    return this.server.health();
  }
}
