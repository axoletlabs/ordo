/**
 * Copy for OTP toasts. Switches on whether the connected server actually
 * delivers mail (SMTP_URL) or prints codes to its console.
 */

export function otpSentToast(
  smtpConfigured: boolean | undefined,
  address: string,
): string {
  if (smtpConfigured === false) {
    return "Code printed in the server console";
  }
  return `Code sent to ${address}`;
}
