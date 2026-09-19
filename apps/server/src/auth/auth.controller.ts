import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import {
  ChangeDisplayNameSchema,
  ChangeEmailSchema,
  ChangePasswordSchema,
  DeleteAccountSchema,
  ForgotPasswordSchema,
  LoginMfaEmailSchema,
  LoginMfaEmailVerifySchema,
  LoginMfaSchema,
  LoginSchema,
  MfaCodeBodySchema,
  RegisterSchema,
  ResetPasswordSchema,
  TotpBeginSchema,
  TotpConfirmSchema,
  UpdateReaderPreferencesSchema,
  VerifyEmailChangeSchema,
  VerifyEmailSchema,
  isMfaRequiredResponse,
  type AuthResponse,
  type BackupCodesDto,
  type ForgotPasswordInput,
  type LoginResponse,
  type MfaStatusDto,
  type ResetPasswordInput,
  type SessionDto,
  type TotpBeginDto,
  type TotpConfirmDto,
  type UpdateReaderPreferencesInput,
  type UserDto,
  type VerifyEmailChangeInput,
  type VerifyEmailInput,
} from "@ordo/shared";
import {
  CurrentUser,
  type AuthContext,
  type AuthenticatedRequest,
} from "../common/decorators/current-user.decorator.js";
import { AuthService } from "./auth.service.js";
import { MfaService } from "./mfa.service.js";
import { AvatarService } from "./avatar.service.js";
import {
  getDeviceMetadata,
  getClientIp,
  getAccessToken,
  getRefreshToken,
  isMobileClient,
} from "../common/utils/request.js";
import { clearAuthCookies, setAuthCookies } from "./cookies.js";
import { AuthGuard } from "./auth.guard.js";
import { AllowWithoutMfa } from "./allow-without-mfa.decorator.js";
import { RateLimit } from "../common/rate-limit/rate-limit.decorator.js";
import { AppError } from "../common/errors/app-error.js";
import { ErrorCode } from "@ordo/shared";
import { toUserDto } from "../common/mappers.js";

const AVATAR_UPLOAD = FileInterceptor("file", {
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

@Controller("api/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly avatars: AvatarService,
  ) {}

  /** Strip tokens from the body when the client is web (it uses cookies). */
  private maybeStripTokens(body: AuthResponse, mobile: boolean): AuthResponse {
    if (mobile) return body;
    return { ...body, tokens: { accessToken: "", refreshToken: "", expiresIn: body.tokens.expiresIn } };
  }

  private clientMeta(req: Request) {
    return { ...getDeviceMetadata(req), ip: getClientIp(req) };
  }

  @Post("register")
  @RateLimit("register")
  async register(
    @Body({ schema: RegisterSchema }) body: { displayName: string; email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const mobile = isMobileClient(req);
    const result = await this.auth.register(body, this.clientMeta(req));
    if (!mobile) setAuthCookies(res, result.tokens);
    return this.maybeStripTokens(result, mobile);
  }

  @Post("login")
  @HttpCode(200)
  async login(
    @Body({ schema: LoginSchema }) body: { identifier: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const mobile = isMobileClient(req);
    const result = await this.auth.login(body, this.clientMeta(req));
    if (isMfaRequiredResponse(result)) return result;
    if (!mobile) setAuthCookies(res, result.tokens);
    return this.maybeStripTokens(result, mobile);
  }

  @Post("login/mfa")
  @RateLimit("mfa-verify")
  @HttpCode(200)
  async loginMfa(
    @Body({ schema: LoginMfaSchema }) body: { challengeToken: string; code: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const mobile = isMobileClient(req);
    const result = await this.auth.completeMfaLogin(body.challengeToken, body.code, this.clientMeta(req));
    if (!mobile) setAuthCookies(res, result.tokens);
    return this.maybeStripTokens(result, mobile);
  }

  @Post("login/mfa/email")
  @RateLimit("mfa-verify")
  @HttpCode(200)
  async loginMfaEmail(
    @Body({ schema: LoginMfaEmailSchema }) body: { challengeToken: string },
  ): Promise<{ success: true }> {
    await this.auth.requestMfaEmailRecovery(body.challengeToken);
    return { success: true };
  }

  @Post("login/mfa/email/verify")
  @RateLimit("mfa-verify")
  @HttpCode(200)
  async loginMfaEmailVerify(
    @Body({ schema: LoginMfaEmailVerifySchema }) body: { challengeToken: string; token: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const mobile = isMobileClient(req);
    const result = await this.auth.completeMfaEmailRecovery(
      body.challengeToken,
      body.token,
      this.clientMeta(req),
    );
    if (!mobile) setAuthCookies(res, result.tokens);
    return this.maybeStripTokens(result, mobile);
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const mobile = isMobileClient(req);
    const result = await this.auth.refresh(getRefreshToken(req), getDeviceMetadata(req));
    if (!mobile) setAuthCookies(res, result.tokens);
    return this.maybeStripTokens(result, mobile);
  }

  @Post("forgot-password")
  @RateLimit("forgot-password")
  @HttpCode(200)
  async forgotPassword(
    @Body({ schema: ForgotPasswordSchema }) body: ForgotPasswordInput,
  ): Promise<{ success: true }> {
    await this.auth.requestPasswordReset(body.email);
    return { success: true };
  }

  @Post("reset-password")
  @RateLimit("reset-password")
  @HttpCode(200)
  async resetPassword(
    @Body({ schema: ResetPasswordSchema }) body: ResetPasswordInput,
  ): Promise<{ success: true }> {
    await this.auth.resetPassword(body.email, body.token, body.newPassword, body.recoveryKey);
    return { success: true };
  }

  @Post("logout")
  @UseGuards(AuthGuard)
  @AllowWithoutMfa()
  @HttpCode(200)
  async logout(
    @CurrentUser() user: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    const access = getAccessToken(req);
    await this.auth.logout(user.sessionId, access);
    clearAuthCookies(res);
    return { success: true };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  @AllowWithoutMfa()
  async me(@CurrentUser() user: AuthContext): Promise<UserDto> {
    return this.auth.me(user.userId);
  }

  @Patch("preferences")
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async updatePreferences(
    @CurrentUser() user: AuthContext,
    @Body({ schema: UpdateReaderPreferencesSchema })
    body: UpdateReaderPreferencesInput,
  ): Promise<UserDto> {
    return this.auth.updatePreferences(user.userId, body);
  }

  @Get("sessions")
  @UseGuards(AuthGuard)
  async sessions(@CurrentUser() user: AuthContext): Promise<SessionDto[]> {
    return this.auth.listSessions(user.userId, user.sessionId);
  }

  @Delete("sessions/:id")
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async revokeSession(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
  ): Promise<{ success: true }> {
    await this.auth.revokeSession(user.userId, id);
    return { success: true };
  }

  @Post("verify-email")
  @HttpCode(200)
  async verifyEmail(
    @Body({ schema: VerifyEmailSchema }) body: VerifyEmailInput,
  ): Promise<{ success: true }> {
    await this.auth.verifyEmail(body.email, body.token);
    return { success: true };
  }

  @Post("display-name")
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async changeDisplayName(
    @CurrentUser() user: AuthContext,
    @Body({ schema: ChangeDisplayNameSchema }) body: { displayName: string },
  ): Promise<UserDto> {
    return this.auth.changeDisplayName(user.userId, body.displayName);
  }

  @Post("email/change")
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async changeEmail(
    @CurrentUser() user: AuthContext,
    @Body({ schema: ChangeEmailSchema })
    body: { currentPassword: string; newEmail: string },
  ): Promise<{ success: true }> {
    await this.auth.requestEmailChange(user.userId, body.currentPassword, body.newEmail);
    return { success: true };
  }

  @Post("email/change/resend")
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async resendEmailChange(@CurrentUser() user: AuthContext): Promise<{ success: true }> {
    await this.auth.resendEmailChange(user.userId);
    return { success: true };
  }

  @Post("email/verify-change")
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async verifyEmailChange(
    @CurrentUser() user: AuthContext,
    @Body({ schema: VerifyEmailChangeSchema }) body: VerifyEmailChangeInput,
  ): Promise<UserDto> {
    return this.auth.verifyEmailChange(user.userId, body.token);
  }

  @Post("password")
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthContext,
    @Body({ schema: ChangePasswordSchema })
    body: { currentPassword: string; newPassword: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const mobile = isMobileClient(req);
    const result = await this.auth.changePassword(
      user.userId,
      body.currentPassword,
      body.newPassword,
      this.clientMeta(req),
    );
    if (!mobile) setAuthCookies(res, result.tokens);
    return this.maybeStripTokens(result, mobile);
  }

  @Delete("account")
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async deleteAccount(
    @CurrentUser() user: AuthContext,
    @Body({ schema: DeleteAccountSchema })
    body: { currentPassword: string; confirmation: string; mfaCode?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    await this.auth.deleteAccount(user.userId, body.currentPassword, body.mfaCode);
    clearAuthCookies(res);
    return { success: true };
  }

  @Get("mfa")
  @UseGuards(AuthGuard)
  @AllowWithoutMfa()
  async mfaStatus(@CurrentUser() user: AuthContext): Promise<MfaStatusDto> {
    return this.mfa.status(user.userId);
  }

  @Post("mfa/totp/begin")
  @UseGuards(AuthGuard)
  @AllowWithoutMfa()
  @HttpCode(200)
  async totpBegin(
    @CurrentUser() user: AuthContext,
    @Body({ schema: TotpBeginSchema }) body: { mfaCode?: string },
  ): Promise<TotpBeginDto> {
    return this.mfa.beginTotp(user.userId, body.mfaCode);
  }

  @Post("mfa/totp/confirm")
  @UseGuards(AuthGuard)
  @AllowWithoutMfa()
  @HttpCode(200)
  async totpConfirm(
    @CurrentUser() user: AuthContext,
    @Body({ schema: TotpConfirmSchema }) body: { code: string },
  ): Promise<TotpConfirmDto> {
    return this.mfa.confirmTotp(user.userId, body.code);
  }

  @Post("mfa/totp/disable")
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async totpDisable(
    @CurrentUser() user: AuthContext,
    @Body({ schema: MfaCodeBodySchema }) body: { mfaCode: string },
  ): Promise<UserDto> {
    const updated = await this.mfa.disableTotp(user.userId, body.mfaCode);
    return toUserDto(updated);
  }

  @Post("mfa/backup-codes/regenerate")
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async regenerateBackupCodes(
    @CurrentUser() user: AuthContext,
    @Body({ schema: MfaCodeBodySchema }) body: { mfaCode: string },
  ): Promise<BackupCodesDto> {
    const backupCodes = await this.mfa.regenerateBackupCodes(user.userId, body.mfaCode);
    return { backupCodes };
  }

  @Post("avatar")
  @UseGuards(AuthGuard)
  @RateLimit("avatar-upload")
  @UseInterceptors(AVATAR_UPLOAD)
  @HttpCode(200)
  async uploadAvatar(
    @CurrentUser() user: AuthContext,
    @UploadedFile() file?: { buffer: Buffer; size: number; mimetype: string },
  ): Promise<UserDto> {
    if (!file) throw new AppError(ErrorCode.VALIDATION_ERROR, "Choose an image to upload.");
    return this.avatars.upload(user.userId, file);
  }

  @Get("avatar")
  @UseGuards(AuthGuard)
  async getAvatar(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | void> {
    const payload = await this.avatars.get(user.userId);
    if (!payload) throw new AppError(ErrorCode.AVATAR_NOT_FOUND, "No profile picture yet.");
    const etag = `"${payload.updatedAt.getTime().toString(16)}"`;
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("ETag", etag);
    res.setHeader("Content-Type", payload.mime);
    if (req.headers["if-none-match"] === etag) {
      res.status(304);
      return;
    }
    return new StreamableFile(payload.buffer);
  }

  @Delete("avatar")
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async deleteAvatar(@CurrentUser() user: AuthContext): Promise<UserDto> {
    return this.avatars.remove(user.userId);
  }
}
