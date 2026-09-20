import { Logger } from "@nestjs/common";
import { ErrorCode } from "@ordo/shared";
import { MailService } from "./mail.service.js";
import { AppError } from "../common/errors/app-error.js";
import type { AppConfig } from "../config/config.module.js";

const baseCfg = {
  smtpFrom: "ordo <noreply@ordo.local>",
  smtpRequired: false,
} as AppConfig;

describe("MailService", () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, "log").mockImplementation();
  });

  afterEach(() => {
    log.mockRestore();
  });

  it("is not configured and prints the OTP when SMTP_URL is unset", async () => {
    const mail = new MailService({ ...baseCfg, smtpUrl: null });
    expect(mail.isConfigured).toBe(false);

    await mail.sendVerification("dev@ordo.app", "482193");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Printing the one-time code"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("dev@ordo.app"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("482193"));
  });

  it("prints password-reset codes to the console without SMTP", async () => {
    const mail = new MailService({ ...baseCfg, smtpUrl: null });
    await mail.sendPasswordReset("dev@ordo.app", "000111");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("password reset code"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("000111"));
  });

  it("prints MFA recovery notices to the console without SMTP", async () => {
    const mail = new MailService({ ...baseCfg, smtpUrl: null });
    await mail.sendMfaRecoveryNotice("dev@ordo.app");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("signed in"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("dev@ordo.app"));
  });

  it("is configured when SMTP_URL is provided", () => {
    const mail = new MailService({ ...baseCfg, smtpUrl: "smtp://127.0.0.1:1025" });
    expect(mail.isConfigured).toBe(true);
  });

  it("never prints the OTP when SMTP is required and unset", async () => {
    const mail = new MailService({ ...baseCfg, smtpUrl: null, smtpRequired: true });
    await expect(mail.sendVerification("dev@ordo.app", "482193")).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("does not print the OTP when a configured SMTP send fails", async () => {
    const mail = new MailService({ ...baseCfg, smtpUrl: "smtp://127.0.0.1:1025" });
    (
      mail as unknown as { transporter: { sendMail: () => Promise<never> } }
    ).transporter = {
      sendMail: async () => {
        throw new Error("upstream rejected");
      },
    };

    await expect(mail.sendVerification("dev@ordo.app", "999888")).rejects.toBeInstanceOf(AppError);
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("999888"));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("Printing the one-time code"));
  });
});
