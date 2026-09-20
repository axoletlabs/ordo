import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  TelemetryHeartbeatSchema,
  type TelemetryHeartbeatInput,
  type TelemetryHeartbeatResponse,
} from "@ordo/shared";
import { getClientIp } from "../common/utils/request.js";
import { extractStatsSecret, wantsHtml } from "./telemetry-access.js";
import { renderTelemetryHtml } from "./telemetry-html.js";
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

  @Get("stats")
  async stats(@Req() req: Request, @Res() res: Response): Promise<void> {
    this.telemetry.assertStatsAccess(extractStatsSecret(req));
    const payload = await this.telemetry.stats();
    res.setHeader("Cache-Control", "no-store");
    if (wantsHtml(req)) {
      res.type("html").send(renderTelemetryHtml(payload));
      return;
    }
    res.json(payload);
  }
}
