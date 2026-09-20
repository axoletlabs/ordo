import { z } from "zod";
import { EMAIL_OTP, MFA } from "../constants.js";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: "Enter a valid email." })
  .max(254);
const password = z
  .string()
  .min(8, { message: "Password must be at least 8 characters." })
  .max(256);
const displayName = z
  .string()
  .trim()
  .min(1, { message: "Enter a display name." })
  .max(64, { message: "Display name must be 64 characters or fewer." });
const optionalMfaCode = z
  .string()
  .trim()
  .min(1, { message: "Enter your authenticator or backup code." })
  .max(32)
  .optional();
const requiredMfaCode = z
  .string()
  .trim()
  .min(1, { message: "Enter your authenticator or backup code." })
  .max(32);
const totpCode = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${MFA.TOTP_DIGITS}}$`), {
    message: `Enter the ${MFA.TOTP_DIGITS}-digit code.`,
  });
const challengeToken = z.string().trim().min(1).max(256);

export const RegisterSchema = z.object({
  displayName,
  email,
  password,
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z
  .union([
    z.object({ identifier: email, password }),
    z.object({ email, password }),
  ])
  .transform((input) => ({
    identifier: "identifier" in input ? input.identifier : input.email,
    password: input.password,
  }));
export type LoginInput = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type RefreshInput = z.infer<typeof RefreshSchema>;

const emailOtp = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${EMAIL_OTP.LENGTH}}$`), {
    message: `Enter the ${EMAIL_OTP.LENGTH}-digit code.`,
  });

export const VerifyEmailSchema = z.object({
  email,
  token: emailOtp,
});
export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;

export const ChangeDisplayNameSchema = z.object({
  displayName,
});
export type ChangeDisplayNameInput = z.infer<typeof ChangeDisplayNameSchema>;

export const ChangeEmailSchema = z.object({
  currentPassword: password,
  newEmail: email,
});
export type ChangeEmailInput = z.infer<typeof ChangeEmailSchema>;

export const ChangePasswordSchema = z
  .object({
    currentPassword: password,
    newPassword: password,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from your current password.",
    path: ["newPassword"],
  });
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

export const DELETE_ACCOUNT_CONFIRMATION = "DELETE MY ACCOUNT";
export const DeleteAccountSchema = z.object({
  currentPassword: password,
  confirmation: z.string().refine((value) => value === DELETE_ACCOUNT_CONFIRMATION, {
    message: `Type ${DELETE_ACCOUNT_CONFIRMATION} exactly.`,
  }),
  mfaCode: optionalMfaCode,
});
export type DeleteAccountInput = z.infer<typeof DeleteAccountSchema>;

export const VerifyEmailChangeSchema = z.object({
  token: emailOtp,
});
export type VerifyEmailChangeInput = z.infer<typeof VerifyEmailChangeSchema>;

export const ForgotPasswordSchema = z.object({
  email,
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResendVerificationSchema = ForgotPasswordSchema;
export type ResendVerificationInput = ForgotPasswordInput;

export const ResetPasswordSchema = z.object({
  email,
  token: emailOtp,
  newPassword: password,
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

export const LoginMfaSchema = z.object({
  challengeToken,
  code: z
    .string()
    .trim()
    .min(1, { message: "Enter your authenticator or backup code." })
    .max(32),
});
export type LoginMfaInput = z.infer<typeof LoginMfaSchema>;

export const LoginMfaEmailSchema = z.object({
  challengeToken,
});
export type LoginMfaEmailInput = z.infer<typeof LoginMfaEmailSchema>;

export const LoginMfaEmailVerifySchema = z.object({
  challengeToken,
  token: emailOtp,
});
export type LoginMfaEmailVerifyInput = z.infer<typeof LoginMfaEmailVerifySchema>;

export const TotpBeginSchema = z.preprocess(
  (value) => value ?? {},
  z.object({
    mfaCode: optionalMfaCode,
  }),
);
export type TotpBeginInput = z.infer<typeof TotpBeginSchema>;

export const TotpConfirmSchema = z.object({
  code: totpCode,
});
export type TotpConfirmInput = z.infer<typeof TotpConfirmSchema>;

export const MfaCodeBodySchema = z.object({
  mfaCode: requiredMfaCode,
});
export type MfaCodeBodyInput = z.infer<typeof MfaCodeBodySchema>;
