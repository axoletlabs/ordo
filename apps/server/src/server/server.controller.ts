import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import {
  ChangeServerNameSchema,
  type ChangeServerNameInput,
  type ServerInfoDto,
} from "@ordo/shared";
import { AuthGuard } from "../auth/auth.guard.js";
import { ServerService } from "./server.service.js";

@Controller("api/server")
export class ServerController {
  constructor(private readonly server: ServerService) {}

  @Get("info")
  info(): Promise<ServerInfoDto> {
    return this.server.info();
  }

  @Patch("name")
  @UseGuards(AuthGuard)
  async rename(
    @Body({ schema: ChangeServerNameSchema }) body: ChangeServerNameInput,
  ): Promise<ServerInfoDto> {
    await this.server.setDisplayName(body.name);
    return this.server.info();
  }
}
