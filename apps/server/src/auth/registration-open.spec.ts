import { isRegistrationOpen } from "./registration-open.js";

describe("isRegistrationOpen", () => {
  it("follows the flag when registration is enabled", async () => {
    const prisma = { user: { count: jest.fn() } };
    await expect(isRegistrationOpen(prisma, true)).resolves.toBe(true);
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it("allows the first account when registration is otherwise closed", async () => {
    const prisma = { user: { count: jest.fn().mockResolvedValue(0) } };
    await expect(isRegistrationOpen(prisma, false)).resolves.toBe(true);
  });

  it("stays closed after the first account", async () => {
    const prisma = { user: { count: jest.fn().mockResolvedValue(1) } };
    await expect(isRegistrationOpen(prisma, false)).resolves.toBe(false);
  });
});
