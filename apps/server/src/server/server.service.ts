import { hostname as osHostname } from "node:os";
import { isIP } from "node:net";
import { Injectable, Inject } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config.module.js";
import type { ServerInfoDto } from "@ordo/shared";
import { MailService } from "../auth/mail.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const VERSION = "0.1.0";
const INSTANCE_SETTINGS_ID = "instance";

/** Short machine name: first DNS label, or the raw hostname when it is an IP. */
export function machineHostname(): string {
  const raw = osHostname().trim();
  if (!raw) return "ordo";
  const value = isIP(raw) ? raw : (raw.split(".")[0]?.trim() || raw);
  return value.slice(0, 64) || "ordo";
}

@Injectable()
export class ServerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly mail: MailService,
  ) {}

  hostname(): string {
    return machineHostname();
  }

  async displayName(): Promise<string> {
    const row = await this.prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
    });
    const stored = row?.name.trim();
    return stored || this.hostname();
  }

  async setDisplayName(name: string): Promise<string> {
    const trimmed = name.trim();
    await this.prisma.instanceSettings.upsert({
      where: { id: INSTANCE_SETTINGS_ID },
      create: { id: INSTANCE_SETTINGS_ID, name: trimmed },
      update: { name: trimmed },
    });
    return trimmed;
  }

  async info(): Promise<ServerInfoDto> {
    return {
      name: await this.displayName(),
      hostname: this.hostname(),
      version: VERSION,
      registrationEnabled: this.cfg.registrationEnabled,
      emailVerificationRequired: this.cfg.emailVerificationRequired,
      smtpConfigured: this.mail.isConfigured,
      profilePictureMaxBytes: this.cfg.profilePictureMaxBytes,
      avatarAllowAnimated: this.cfg.avatarAllowAnimated,
      mfaRequired: this.cfg.mfaRequired,
      folderLockTypes: true,
    };
  }
}
