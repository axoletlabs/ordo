import { existsSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import { EMAIL_OTP } from "@ordo/shared";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/config.module.js";
import {
  VERIFICATION_LOGO_CID,
  emailChangedNotice,
  emailChangeRequestedNotice,
  mfaRecoveryEmail,
  mfaRecoveryNoticeEmail,
  passwordResetEmail,
  verificationEmail,
} from "./mail.templates.js";
import { AppError } from "../common/errors/app-error.js";
import { ErrorCode } from "@ordo/shared";

/** Resolved from both `src/auth` and compiled `dist/auth`. */
function emailLogoPath(): string {
  return join(__dirname, "..", "..", "assets", "email-logo.png");
}

/**
 * Email delivery. Uses SMTP when SMTP_URL is configured, otherwise logs the
 * one-time code to the console (dev / self-host without mail).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null = null;
  private readonly from: string;
  private readonly smtpRequired: boolean;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.from = cfg.smtpFrom;
    this.smtpRequired = cfg.smtpRequired;
    if (cfg.smtpUrl) {
      try {
        this.transporter = nodemailer.createTransport(cfg.smtpUrl);
      } catch (err) {
        this.logger.warn(
          `Failed to initialize SMTP transport: ${(err as Error).message}`,
        );
        this.transporter = null;
      }
    }
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  async sendVerification(to: string, token: string): Promise<void> {
    const minutes = Math.round(EMAIL_OTP.TTL_MS / 60_000);
    const { subject, text, html } = verificationEmail(token, minutes);
    await this.send({ to, subject, text, html });
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const minutes = Math.round(EMAIL_OTP.TTL_MS / 60_000);
    const { subject, text, html } = passwordResetEmail(token, minutes);
    await this.send({ to, subject, text, html });
  }

  async sendMfaRecovery(to: string, token: string): Promise<void> {
    const minutes = Math.round(EMAIL_OTP.TTL_MS / 60_000);
    const { subject, text, html } = mfaRecoveryEmail(token, minutes);
    await this.send({ to, subject, text, html });
  }

  async sendMfaRecoveryNotice(to: string): Promise<void> {
    const { subject, text, html } = mfaRecoveryNoticeEmail();
    await this.send({ to, subject, text, html });
  }

  async sendEmailChangeNotice(to: string, newEmail: string): Promise<void> {
    const { subject, text, html } = emailChangeRequestedNotice(newEmail);
    await this.send({ to, subject, text, html });
  }

  async sendEmailChangedNotice(to: string, newEmail: string): Promise<void> {
    const { subject, text, html } = emailChangedNotice(newEmail);
    await this.send({ to, subject, text, html });
  }

  private async send(opts: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    if (!this.transporter) {
      if (this.smtpRequired) {
        throw new AppError(
          ErrorCode.INTERNAL_ERROR,
          "This server can't send email. Ask the owner to configure SMTP.",
        );
      }
      this.logConsole(opts);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
        attachments: logoAttachment(),
      });
    } catch (err) {
      this.logger.warn(`SMTP send failed: ${(err as Error).message}`);
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        "Couldn't send that email. Try again in a moment.",
      );
    }
  }

  private logConsole(opts: { to: string; subject: string; text: string }): void {
    this.logger.log(
      [
        "[console-mail] Printing the one-time code.",
        `To: ${opts.to}`,
        `Subject: ${opts.subject}`,
        opts.text,
      ].join("\n"),
    );
  }
}

function logoAttachment(): Array<{
  filename: string;
  path: string;
  cid: string;
  contentDisposition: "inline";
}> {
  const path = emailLogoPath();
  if (!existsSync(path)) return [];
  return [
    {
      filename: "ordo-logo.png",
      path,
      cid: VERIFICATION_LOGO_CID,
      contentDisposition: "inline",
    },
  ];
}
