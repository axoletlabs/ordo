import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  BatchFoldersSchema,
  CreateFolderSchema,
  RemoveFolderPasswordSchema,
  SetFolderPasswordSchema,
  UnlockFolderSchema,
  UpdateFolderSchema,
  type BatchFoldersInput,
  type CreateFolderInput,
  type FolderDto,
  type RemoveFolderPasswordInput,
  type SetFolderPasswordInput,
  type UpdateFolderInput,
} from "@ordo/shared";
import { AuthGuard } from "../auth/auth.guard.js";
import {
  CurrentUser,
  type AuthContext,
  type AuthenticatedRequest,
} from "../common/decorators/current-user.decorator.js";
import { FoldersService } from "./folders.service.js";

@UseGuards(AuthGuard)
@Controller("api/folders")
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  async list(@CurrentUser() user: AuthContext): Promise<FolderDto[]> {
    return this.folders.list(user.userId);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthContext,
    @Body({ schema: CreateFolderSchema }) body: CreateFolderInput,
  ): Promise<FolderDto> {
    return this.folders.create(user.userId, body);
  }

  @Post("batch")
  @HttpCode(200)
  async batch(
    @CurrentUser() user: AuthContext,
    @Body({ schema: BatchFoldersSchema }) body: BatchFoldersInput,
  ): Promise<{ updated: number }> {
    return this.folders.batch(user.userId, body);
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
    @Body({ schema: UpdateFolderSchema }) body: UpdateFolderInput,
  ): Promise<FolderDto> {
    return this.folders.update(id, user.userId, body);
  }

  @Delete(":id")
  @HttpCode(200)
  async remove(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
  ): Promise<{ success: true }> {
    await this.folders.remove(id, user.userId);
    return { success: true };
  }

  @Post(":id/password")
  @HttpCode(200)
  async setPassword(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
    @Body({ schema: SetFolderPasswordSchema }) body: SetFolderPasswordInput,
  ): Promise<{ success: true }> {
    await this.folders.setPassword(id, user.userId, body);
    return { success: true };
  }

  @Post(":id/remove-password")
  @HttpCode(200)
  async removePassword(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
    @Body({ schema: RemoveFolderPasswordSchema }) body: RemoveFolderPasswordInput,
  ): Promise<{ success: true }> {
    await this.folders.removePassword(id, user.userId, body);
    return { success: true };
  }

  @Post(":id/unlock")
  @HttpCode(200)
  async unlock(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
    @Body({ schema: UnlockFolderSchema }) body: { password: string },
  ): Promise<{ token: string; expiresIn: number }> {
    return this.folders.unlock(id, user.userId, body.password);
  }
}

export type { AuthenticatedRequest };
