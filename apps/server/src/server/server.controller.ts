import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import {
  ChangeServerNameSchema,
  type ChangeServerNameInput,
  type ServerInfoDto,
} from "@ordo/shared";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type AuthContext } from "../common/decorators/current-user.decorator.js";
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
    @CurrentUser() user: AuthContext,
    @Body({ schema: ChangeServerNameSchema }) body: ChangeServerNameInput,
  ): Promise<ServerInfoDto> {
    await this.server.setDisplayName(user.userId, body.name);
    return this.server.info();
  }
}
