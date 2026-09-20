/**
 * Auth API endpoints. Types come from @ordo/shared's contract.
 */
import { AuthRoutes, buildPath } from "@ordo/shared";
import type {
  AuthResponse,
  BackupCodesDto,
  LoginResponse,
  MfaStatusDto,
  RegisterResponse,
  TotpBeginDto,
  TotpConfirmDto,
  UpdateReaderPreferencesInput,
  UserDto,
} from "@ordo/shared";
import { api } from "./client";

export const authApi = {
  register: (body: { displayName: string; email: string; password: string }) =>
    api.post<RegisterResponse>(AuthRoutes.register.path, body, { auth: false }),

  login: ({ identifier, password }: { identifier: string; password: string }) =>
    api.post<LoginResponse>(
      AuthRoutes.login.path,
      { identifier, password },
      { auth: false },
    ),

  loginMfa: (body: { challengeToken: string; code: string }) =>
    api.post<AuthResponse>(AuthRoutes.loginMfa.path, body, { auth: false }),

  loginMfaEmail: (body: { challengeToken: string }) =>
    api.post<{ success: true }>(AuthRoutes.loginMfaEmail.path, body, { auth: false }),

  loginMfaEmailVerify: (body: { challengeToken: string; token: string }) =>
    api.post<AuthResponse>(AuthRoutes.loginMfaEmailVerify.path, body, { auth: false }),

  me: () => api.get<typeof AuthRoutes.me.response>(AuthRoutes.me.path),

  logout: () => api.post<typeof AuthRoutes.logout.response>(AuthRoutes.logout.path),

  listSessions: () => api.get<typeof AuthRoutes.listSessions.response>(AuthRoutes.listSessions.path),

  revokeSession: (id: string) =>
    api.delete<typeof AuthRoutes.revokeSession.response>(
      buildPath(AuthRoutes.revokeSession.path, { id }),
    ),

  verifyEmail: (body: { email: string; token: string }) =>
    api.post<typeof AuthRoutes.verifyEmail.response>(
      AuthRoutes.verifyEmail.path,
      body,
      { auth: false },
    ),

  resendVerification: (body: { email: string }) =>
    api.post<typeof AuthRoutes.resendVerification.response>(
      AuthRoutes.resendVerification.path,
      body,
      { auth: false },
    ),

  changeDisplayName: (body: { displayName: string }) =>
    api.post<typeof AuthRoutes.changeDisplayName.response>(AuthRoutes.changeDisplayName.path, body),

  requestEmailChange: (body: { currentPassword: string; newEmail: string; mfaCode?: string }) =>
    api.post<typeof AuthRoutes.changeEmail.response>(AuthRoutes.changeEmail.path, body),

  resendEmailChange: () =>
    api.post<typeof AuthRoutes.resendEmailChange.response>(AuthRoutes.resendEmailChange.path),

  verifyEmailChange: (token: string) =>
    api.post<typeof AuthRoutes.verifyEmailChange.response>(
      AuthRoutes.verifyEmailChange.path,
      { token },
    ),

  changePassword: (body: { currentPassword: string; newPassword: string; mfaCode?: string }) =>
    api.post<typeof AuthRoutes.changePassword.response>(AuthRoutes.changePassword.path, body),

  forgotPassword: (body: { email: string }) =>
    api.post<typeof AuthRoutes.forgotPassword.response>(
      AuthRoutes.forgotPassword.path,
      body,
      { auth: false },
    ),

  resetPassword: (body: { email: string; token: string; newPassword: string }) =>
    api.post<typeof AuthRoutes.resetPassword.response>(
      AuthRoutes.resetPassword.path,
      body,
      { auth: false },
    ),

  updatePreferences: (body: UpdateReaderPreferencesInput) =>
    api.patch<typeof AuthRoutes.updatePreferences.response>(
      AuthRoutes.updatePreferences.path,
      body,
    ),

  deleteAccount: (body: { currentPassword: string; confirmation: string; mfaCode?: string }) =>
    api.delete<typeof AuthRoutes.deleteAccount.response>(AuthRoutes.deleteAccount.path, { body }),

  mfaStatus: () => api.get<MfaStatusDto>(AuthRoutes.mfaStatus.path),

  totpBegin: (body: { mfaCode?: string } = {}) =>
    api.post<TotpBeginDto>(AuthRoutes.totpBegin.path, body),

  totpConfirm: (body: { code: string }) =>
    api.post<TotpConfirmDto>(AuthRoutes.totpConfirm.path, body),

  totpDisable: (body: { mfaCode: string }) =>
    api.post<UserDto>(AuthRoutes.totpDisable.path, body),

  regenerateBackupCodes: (body: { mfaCode: string }) =>
    api.post<BackupCodesDto>(AuthRoutes.regenerateBackupCodes.path, body),

  uploadAvatar: (formData: FormData) =>
    api.postForm<UserDto>(AuthRoutes.uploadAvatar.path, formData),

  getAvatar: () => api.getBlob(AuthRoutes.getAvatar.path),

  deleteAvatar: () => api.delete<UserDto>(AuthRoutes.deleteAvatar.path),
};
