/**
 * Transactional email bodies. Table + inline CSS so they survive Gmail,
 * Apple Mail, and Mailpit. Mirrors the app's warm paper / coral palette.
 */
import { APP_NAME } from "@ordo/shared";

export const VERIFICATION_LOGO_CID = "ordo-logo";

const PAPER = "#EFE7D2";
const CARD = "#FBF6E6";
const RULE = "#E7DEC6";
const INK = "#15140F";
const MUTE = "#5A5448";
const FAINT = "#8B8676";
const CODE_WELL = "#F7F1DE";

/** Display size of the coral mark (source PNG is 3× for sharpness). */
const LOGO_W = 64;
const LOGO_H = 70;

export type OtpEmailKind = "verification" | "password_reset" | "mfa_recovery";

const COPY: Record<
  OtpEmailKind,
  { subject: string; kicker: string; body: string; ignore: string; textHeading: string }
> = {
  verification: {
    subject: `Your ${APP_NAME} verification code`,
    kicker: "Verification",
    body: `Enter this code in ${APP_NAME} to continue.`,
    ignore: "If you didn't request this, you can ignore this email.",
    textHeading: "Your verification code",
  },
  password_reset: {
    subject: `Your ${APP_NAME} password reset code`,
    kicker: "Password reset",
    body: `Enter this code in ${APP_NAME} to choose a new password.`,
    ignore: "If you didn't request this, you can ignore this email.",
    textHeading: "Your password reset code",
  },
  mfa_recovery: {
    subject: `Your ${APP_NAME} authenticator recovery code`,
    kicker: "Authenticator recovery",
    body: `Enter this code in ${APP_NAME} to turn off your authenticator app and sign in.`,
    ignore: "If you didn't request this, you can ignore this email. Your authenticator stays on.",
    textHeading: "Your authenticator recovery code",
  },
};

export function otpEmail(
  kind: OtpEmailKind,
  otp: string,
  expiresMinutes: number,
): {
  subject: string;
  text: string;
  html: string;
} {
  const code = otp.replace(/\D/g, "");
  const copy = COPY[kind];
  const subject = copy.subject;
  const text = [
    APP_NAME,
    "",
    copy.textHeading,
    "",
    code,
    "",
    `Expires in ${expiresMinutes} minutes.`,
    copy.ignore,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${escapeHtml(code)} is your ${previewKind(kind)} code. It expires in ${expiresMinutes} minutes.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;border-collapse:separate;border-spacing:0;">
          <tr>
            <td align="center" style="background:${CARD};border:1px solid ${RULE};border-radius:24px;padding:36px 32px 32px;">
              <img src="cid:${VERIFICATION_LOGO_CID}" width="${LOGO_W}" height="${LOGO_H}" alt="${APP_NAME}" style="display:block;margin:0 auto 28px;border:0;outline:none;text-decoration:none;" />
              <p style="margin:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${FAINT};">
                ${escapeHtml(copy.kicker)}
              </p>
              <p style="margin:0 0 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:${MUTE};">
                ${escapeHtml(copy.body)}
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;">
                <tr>
                  <td align="center" style="background:${CODE_WELL};border:1px solid ${RULE};border-radius:14px;padding:20px 12px;">
                    <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:32px;font-weight:600;letter-spacing:0.28em;color:${INK};">
                      ${escapeHtml(code)}
                    </span>
                  </td>
                </tr>
              </table>
              <p style="margin:22px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;line-height:1.5;color:${FAINT};">
                Expires in ${expiresMinutes} minutes. ${escapeHtml(copy.ignore)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

export function verificationEmail(otp: string, expiresMinutes: number) {
  return otpEmail("verification", otp, expiresMinutes);
}

export function passwordResetEmail(otp: string, expiresMinutes: number) {
  return otpEmail("password_reset", otp, expiresMinutes);
}

export function mfaRecoveryEmail(otp: string, expiresMinutes: number) {
  return otpEmail("mfa_recovery", otp, expiresMinutes);
}

function previewKind(kind: OtpEmailKind): string {
  if (kind === "password_reset") return "password reset";
  if (kind === "mfa_recovery") return "authenticator recovery";
  return "verification";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
