import { Injectable } from "@nestjs/common";
import { Prisma, type Tag } from "../prisma/client.js";
import {
  DEFAULT_TAG_COLOR,
  ErrorCode,
  tagNameKey,
  type CreateTagInput,
  type TagDto,
  type UpdateTagInput,
} from "@ordo/shared";
import { AppError } from "../common/errors/app-error.js";
import { toTagDto } from "../common/mappers.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { FolderAccessService } from "./folder-access.service.js";

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FolderAccessService,
  ) {}

  /** Tags with visible bookmark counts: protected-folder assignments are
   *  excluded unless one of the presented unlock tokens opens the folder. */
  async list(userId: string, folderTokens: readonly string[] = []): Promise<TagDto[]> {
    const authorized = await this.access.authorizedFolderIds(userId, folderTokens);
    const tags = await this.prisma.tag.findMany({
      where: { userId },
      include: {
        _count: {
          select: {
            bookmarks: { where: { bookmark: this.access.visibleBookmarksFilter(authorized) } },
          },
        },
      },
    });
    return tags
      .map((tag) => toTagDto(tag))
      .sort((a, b) => b.bookmarkCount - a.bookmarkCount || a.name.localeCompare(b.name));
  }

  async create(userId: string, input: CreateTagInput): Promise<TagDto> {
    try {
      const tag = await this.prisma.tag.create({
        data: {
          userId,
          name: input.name,
          normalizedName: tagNameKey(input.name),
          color: input.color ?? DEFAULT_TAG_COLOR,
        },
      });
      return toTagDto(tag);
    } catch (error) {
      this.rethrowUniqueName(error);
    }
  }

  async update(userId: string, tagId: string, input: UpdateTagInput): Promise<TagDto> {
    await this.requireOwned(userId, tagId);
    try {
      const tag = await this.prisma.tag.update({
        where: { id: tagId },
        data: {
          ...(input.name === undefined
            ? {}
            : { name: input.name, normalizedName: tagNameKey(input.name) }),
          ...(input.color === undefined ? {} : { color: input.color }),
        },
        include: { _count: { select: { bookmarks: true } } },
      });
      return toTagDto(tag);
    } catch (error) {
      this.rethrowUniqueName(error);
    }
  }

  async remove(userId: string, tagId: string): Promise<void> {
    await this.requireOwned(userId, tagId);
    await this.prisma.tag.delete({ where: { id: tagId } });
  }

  async requireOwned(userId: string, tagId: string): Promise<Tag> {
    const tag = await this.prisma.tag.findFirst({ where: { id: tagId, userId } });
    if (!tag) throw new AppError(ErrorCode.TAG_NOT_FOUND, "This tag no longer exists.");
    return tag;
  }

  async requireOwnedIds(userId: string, tagIds: readonly string[]): Promise<void> {
    if (tagIds.length === 0) return;
    const count = await this.prisma.tag.count({
      where: { userId, id: { in: [...new Set(tagIds)] } },
    });
    if (count !== new Set(tagIds).size) {
      throw new AppError(ErrorCode.TAG_NOT_FOUND, "One or more tags no longer exist.");
    }
  }

  private rethrowUniqueName(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(ErrorCode.TAG_ALREADY_EXISTS, "A tag with this name already exists.");
    }
    throw error;
  }
}
