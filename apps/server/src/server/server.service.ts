import { Injectable, Inject } from "@nestjs/common";
import { ErrorCode, type HealthDto, type ServerInfoDto } from "@ordo/shared";
import { APP_CONFIG, type AppConfig } from "../config/config.module.js";
import { AppError } from "../common/errors/app-error.js";
import { MailService } from "../auth/mail.service.js";
import { isRegistrationOpen } from "../auth/registration-open.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  INSTANCE_SETTINGS_ID,
  instanceDisplayName,
  userCanRenameInstance,
} from "./instance-admin.js";
import { readServerVersion } from "./release-version.js";

@Injectable()
export class ServerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly mail: MailService,
  ) {}

  async displayName(): Promise<string> {
    const row = await this.prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
    });
    return instanceDisplayName(row?.name);
  }

  async setDisplayName(userId: string, name: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) throw new AppError(ErrorCode.UNAUTHORIZED, "Sign in to continue.");
    if (!(await userCanRenameInstance(this.prisma, this.cfg, user))) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        this.cfg.instanceRenameEnabled
          ? "Only the server owner can rename this instance."
          : "This server does not allow renaming.",
      );
    }
    const trimmed = name.trim();
    await this.prisma.instanceSettings.upsert({
      where: { id: INSTANCE_SETTINGS_ID },
      create: { id: INSTANCE_SETTINGS_ID, name: trimmed, ownerUserId: user.id },
      update: { name: trimmed },
    });
    return trimmed;
  }

  async health(): Promise<HealthDto> {
    try {
      await this.prisma.$queryRawUnsafe("SELECT 1");
    } catch {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "Database is unavailable.");
    }
    return { status: "ok" };
  }

  async info(): Promise<ServerInfoDto> {
    return {
      name: await this.displayName(),
      version: readServerVersion(),
      registrationEnabled: await isRegistrationOpen(this.prisma, this.cfg.registrationEnabled),
      emailVerificationRequired: this.cfg.emailVerificationRequired,
      smtpConfigured: this.mail.isConfigured,
      profilePictureMaxBytes: this.cfg.profilePictureMaxBytes,
      avatarAllowAnimated: this.cfg.avatarAllowAnimated,
      mfaRequired: this.cfg.mfaRequired,
      folderLockTypes: true,
      reminders: true,
    };
  }
}
