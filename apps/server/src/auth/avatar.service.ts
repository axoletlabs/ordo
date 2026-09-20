import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import sharp from "sharp";
import { AVATAR, ErrorCode } from "@ordo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { AppError } from "../common/errors/app-error.js";
import { APP_CONFIG, type AppConfig } from "../config/config.module.js";
import { userDtoWithRename } from "../server/instance-admin.js";
import type { UserDto } from "@ordo/shared";

const WEBP_QUALITY = 82;
const MAX_INPUT_PIXELS = 4096 * 4096;

export interface AvatarPayload {
  buffer: Buffer;
  mime: string;
  updatedAt: Date;
}

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async upload(userId: string, file: { buffer: Buffer; mimetype?: string; size: number }): Promise<UserDto> {
    if (!file?.buffer?.length) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Choose an image to upload.");
    }
    if (file.size > this.cfg.profilePictureMaxBytes || file.buffer.length > this.cfg.profilePictureMaxBytes) {
      throw new AppError(
        ErrorCode.AVATAR_TOO_LARGE,
        `Profile pictures must be ${Math.round(this.cfg.profilePictureMaxBytes / (1024 * 1024))} MB or smaller.`,
      );
    }
    const kind = sniffImage(file.buffer);
    if (!kind) {
      throw new AppError(
        ErrorCode.AVATAR_UNSUPPORTED_TYPE,
        "Use a JPEG, PNG, or WebP image.",
      );
    }

    let processed: Buffer;
    try {
      processed = await this.reencode(file.buffer);
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.logger.warn(`Avatar decode failed: ${(err as Error).message}`);
      throw new AppError(ErrorCode.AVATAR_UNSUPPORTED_TYPE, "Use a JPEG, PNG, or WebP image.");
    }

    const now = new Date();
    if (this.cfg.avatarStorage === "database") {
      await this.deleteFile(userId);
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          avatarBytes: new Uint8Array(processed),
          avatarMime: AVATAR.MIME,
          avatarUpdatedAt: now,
        },
      });
      return userDtoWithRename(this.prisma, this.cfg, user);
    }

    await this.writeFile(userId, processed);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatarBytes: null,
        avatarMime: AVATAR.MIME,
        avatarUpdatedAt: now,
      },
    });
    return userDtoWithRename(this.prisma, this.cfg, user);
  }

  async get(userId: string): Promise<AvatarPayload | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarBytes: true, avatarMime: true, avatarUpdatedAt: true },
    });
    if (!user?.avatarUpdatedAt) return null;

    const preferDb = this.cfg.avatarStorage === "database";
    if (preferDb && user.avatarBytes) {
      return {
        buffer: Buffer.from(user.avatarBytes),
        mime: user.avatarMime || AVATAR.MIME,
        updatedAt: user.avatarUpdatedAt,
      };
    }
    const fromDisk = await this.readFile(userId);
    if (fromDisk) {
      return { buffer: fromDisk, mime: user.avatarMime || AVATAR.MIME, updatedAt: user.avatarUpdatedAt };
    }
    if (user.avatarBytes) {
      return {
        buffer: Buffer.from(user.avatarBytes),
        mime: user.avatarMime || AVATAR.MIME,
        updatedAt: user.avatarUpdatedAt,
      };
    }
    return null;
  }

  async remove(userId: string): Promise<UserDto> {
    await this.deleteFile(userId);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarBytes: null, avatarMime: null, avatarUpdatedAt: null },
    });
    return userDtoWithRename(this.prisma, this.cfg, user);
  }

  /** Best-effort disk cleanup when the account row is deleted. */
  async deleteStored(userId: string): Promise<void> {
    await this.deleteFile(userId);
  }

  private async reencode(input: Buffer): Promise<Buffer> {
    const probe = sharp(input, { animated: true, limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    const meta = await probe.metadata();
    const pages = meta.pages ?? 1;
    if (pages > 1 && !this.cfg.avatarAllowAnimated) {
      throw new AppError(
        ErrorCode.AVATAR_ANIMATED_DISABLED,
        "Animated images are disabled on this server.",
      );
    }
    const keepAnimation = pages > 1 && this.cfg.avatarAllowAnimated;
    return sharp(input, {
      animated: keepAnimation,
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "error",
      pages: keepAnimation ? -1 : 1,
    })
      .rotate()
      .resize(AVATAR.MAX_PX, AVATAR.MAX_PX, { fit: "cover", position: "centre" })
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toBuffer();
  }

  private filePath(userId: string): string {
    return join(this.cfg.avatarDir, `${userId}.webp`);
  }

  private async writeFile(userId: string, buffer: Buffer): Promise<void> {
    await mkdir(this.cfg.avatarDir, { recursive: true });
    await writeFile(this.filePath(userId), buffer, { mode: 0o600 });
  }

  private async readFile(userId: string): Promise<Buffer | null> {
    try {
      return await readFile(this.filePath(userId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  private async deleteFile(userId: string): Promise<void> {
    try {
      await unlink(this.filePath(userId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

function sniffImage(buf: Buffer): "jpeg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}
