import { Controller, Get, Inject } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/config.module.js";
import { APP_NAME, type ServerInfoDto } from "@ordo/shared";
import { MailService } from "../auth/mail.service.js";

const VERSION = "0.1.0";

@Controller("api/server")
export class ServerController {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly mail: MailService,
  ) {}

  @Get("info")
  info(): ServerInfoDto {
    return {
      name: APP_NAME,
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
