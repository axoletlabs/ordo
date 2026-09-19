import bcrypt from "bcryptjs";
import {
  DELETE_ACCOUNT_CONFIRMATION,
  DeleteAccountSchema,
  ErrorCode,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  VerifyEmailChangeSchema,
  VerifyEmailSchema,
} from "@ordo/shared";
import { AuthService } from "./auth.service.js";

describe("AuthService account deletion", () => {
  const createService = (passwordHash: string) => {
    const findUnique = jest.fn().mockResolvedValue({
      id: "user-1",
      passwordHash,
    });
    const deleteUser = jest.fn().mockResolvedValue({ count: 1 });
    const assertStepUp = jest.fn().mockResolvedValue(undefined);
    const prisma = { user: { findUnique, deleteMany: deleteUser } };
    const service = new AuthService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { enabled: false, checkLogin() {}, recordLoginFailure() {}, clearLogin() {} } as never,
      { assertStepUp } as never,
      { deleteStored: async () => undefined } as never,
      {} as never,
      {} as never,
    );
    return { service, deleteUser, assertStepUp };
  };

  it("requires the exact confirmation phrase", () => {
    expect(DeleteAccountSchema.safeParse({
      currentPassword: "password123",
      confirmation: DELETE_ACCOUNT_CONFIRMATION,
    }).success).toBe(true);
    expect(DeleteAccountSchema.safeParse({
      currentPassword: "password123",
      confirmation: DELETE_ACCOUNT_CONFIRMATION,
      mfaCode: "123456",
    }).success).toBe(true);
    expect(DeleteAccountSchema.safeParse({
      currentPassword: "password123",
      confirmation: "delete my account",
    }).success).toBe(false);
  });

  it("rejects an incorrect password without deleting the user", async () => {
    const passwordHash = await bcrypt.hash("password123", 4);
    const { service, deleteUser, assertStepUp } = createService(passwordHash);

    await expect(service.deleteAccount("user-1", "incorrect123")).rejects.toMatchObject({
      code: ErrorCode.INVALID_CREDENTIALS,
    });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(assertStepUp).not.toHaveBeenCalled();
  });

  it("deletes the user after verifying the password and MFA step-up", async () => {
    const passwordHash = await bcrypt.hash("password123", 4);
    const { service, deleteUser, assertStepUp } = createService(passwordHash);

    await service.deleteAccount("user-1", "password123", "123456");

    expect(assertStepUp).toHaveBeenCalledWith(expect.objectContaining({ id: "user-1" }), "123456");
    expect(deleteUser).toHaveBeenCalledWith({ where: { id: "user-1" } });
  });
});

describe("email OTP schemas", () => {
  it("accepts a 6-digit code with email for signup verification", () => {
    expect(
      VerifyEmailSchema.safeParse({ email: "a@ordo.app", token: "123456" }).success,
    ).toBe(true);
    expect(VerifyEmailSchema.safeParse({ token: "123456" }).success).toBe(false);
    expect(
      VerifyEmailSchema.safeParse({ email: "a@ordo.app", token: "12345" }).success,
    ).toBe(false);
    expect(
      VerifyEmailSchema.safeParse({ email: "a@ordo.app", token: "abcdef" }).success,
    ).toBe(false);
  });

  it("accepts a 6-digit code for email-change verification", () => {
    expect(VerifyEmailChangeSchema.safeParse({ token: "000000" }).success).toBe(true);
    expect(VerifyEmailChangeSchema.safeParse({ token: "12 3456" }).success).toBe(false);
  });

  it("accepts a forgot-password email and a reset payload", () => {
    expect(ForgotPasswordSchema.safeParse({ email: "a@ordo.app" }).success).toBe(true);
    expect(
      ResetPasswordSchema.safeParse({
        email: "a@ordo.app",
        token: "123456",
        newPassword: "newpassword",
      }).success,
    ).toBe(true);
    expect(
      ResetPasswordSchema.safeParse({
        email: "a@ordo.app",
        token: "123456",
        newPassword: "newpassword",
        recoveryKey: "rk1.abc",
      }).success,
    ).toBe(true);
    expect(
      ResetPasswordSchema.safeParse({
        email: "a@ordo.app",
        token: "12345",
        newPassword: "newpassword",
      }).success,
    ).toBe(false);
  });
});
