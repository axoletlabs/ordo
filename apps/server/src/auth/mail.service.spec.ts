import { Logger } from "@nestjs/common";
import { MailService } from "./mail.service.js";
import type { AppConfig } from "../config/config.module.js";

const baseCfg = {
  smtpFrom: "ordo <noreply@ordo.local>",
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

  it("is configured when SMTP_URL is provided", () => {
    const mail = new MailService({ ...baseCfg, smtpUrl: "smtp://127.0.0.1:1025" });
    expect(mail.isConfigured).toBe(true);
  });
});
