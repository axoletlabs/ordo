import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import {
  CreateTagSchema,
  UpdateTagSchema,
  type CreateTagInput,
  type TagDto,
  type UpdateTagInput,
} from "@ordo/shared";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type AuthContext } from "../common/decorators/current-user.decorator.js";
import { getPresentedFolderTokens } from "../common/utils/folder-tokens.js";
import { TagsService } from "./tags.service.js";

@UseGuards(AuthGuard)
@Controller("api/tags")
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
  ): Promise<TagDto[]> {
    return this.tags.list(user.userId, getPresentedFolderTokens(req));
  }

  @Post()
  create(
    @CurrentUser() user: AuthContext,
    @Body({ schema: CreateTagSchema }) body: CreateTagInput,
  ): Promise<TagDto> {
    return this.tags.create(user.userId, body);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
    @Body({ schema: UpdateTagSchema }) body: UpdateTagInput,
  ): Promise<TagDto> {
    return this.tags.update(user.userId, id, body);
  }

  @Delete(":id")
  @HttpCode(200)
  async remove(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
  ): Promise<{ success: true }> {
    await this.tags.remove(user.userId, id);
    return { success: true };
  }
}
