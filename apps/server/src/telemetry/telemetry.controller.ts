import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import {
  TelemetryHeartbeatSchema,
  type TelemetryHeartbeatInput,
  type TelemetryHeartbeatResponse,
} from "@ordo/shared";
import { getClientIp } from "../common/utils/request.js";
import { TelemetryService } from "./telemetry.service.js";

@Controller("api/telemetry")
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Post("heartbeat")
  @HttpCode(200)
  heartbeat(
    @Body({ schema: TelemetryHeartbeatSchema }) body: TelemetryHeartbeatInput,
    @Req() req: Request,
  ): Promise<TelemetryHeartbeatResponse> {
    return this.telemetry.heartbeat(body, getClientIp(req));
  }
}
