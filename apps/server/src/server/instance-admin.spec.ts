import { APP_NAME } from "@ordo/shared";
import {
  claimInstanceOwner,
  instanceDisplayName,
  INSTANCE_SETTINGS_ID,
  userCanRenameInstance,
} from "./instance-admin.js";

describe("instanceDisplayName", () => {
  it("falls back to the app name, never an OS hostname", () => {
    expect(instanceDisplayName(null)).toBe(APP_NAME);
    expect(instanceDisplayName("  ")).toBe(APP_NAME);
    expect(instanceDisplayName("Home lab")).toBe("Home lab");
  });
});

describe("instance owner", () => {
  const cfg = { instanceRenameEnabled: true, instanceAdminEmail: null as string | null };

  function store(state: {
    ownerUserId?: string | null;
    users?: Array<{ id: string; email: string; createdAt?: Date }>;
  }) {
    let ownerUserId = state.ownerUserId ?? null;
    let exists = state.ownerUserId !== undefined;
    const users = state.users ?? [];
    return {
      instanceSettings: {
        findUnique: jest.fn(async () =>
          exists ? { id: INSTANCE_SETTINGS_ID, name: APP_NAME, ownerUserId } : null,
        ),
        create: jest.fn(async ({ data }: { data: { ownerUserId: string } }) => {
          exists = true;
          ownerUserId = data.ownerUserId;
          return { id: INSTANCE_SETTINGS_ID, name: APP_NAME, ownerUserId };
        }),
        update: jest.fn(async ({ data }: { data: { ownerUserId: string } }) => {
          ownerUserId = data.ownerUserId;
          return { id: INSTANCE_SETTINGS_ID, name: APP_NAME, ownerUserId };
        }),
      },
      user: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
          users.find((u) => u.id === where.id) ?? null,
        ),
        findFirst: jest.fn(async () => users[0] ?? null),
      },
    };
  }

  it("lets the first user claim and rename", async () => {
    const prisma = store({ users: [{ id: "u1", email: "a@ordo.app" }] });
    await claimInstanceOwner(prisma, "u1");
    expect(await userCanRenameInstance(prisma, cfg, { id: "u1", email: "a@ordo.app" })).toBe(true);
    expect(await userCanRenameInstance(prisma, cfg, { id: "u2", email: "b@ordo.app" })).toBe(false);
  });

  it("refuses everyone when instance rename is disabled", async () => {
    const prisma = store({
      ownerUserId: "u1",
      users: [{ id: "u1", email: "a@ordo.app" }],
    });
    expect(
      await userCanRenameInstance(
        prisma,
        { instanceRenameEnabled: false, instanceAdminEmail: null },
        { id: "u1", email: "a@ordo.app" },
      ),
    ).toBe(false);
  });

  it("limits rename to INSTANCE_ADMIN_EMAIL when set", async () => {
    const prisma = store({
      ownerUserId: "u1",
      users: [
        { id: "u1", email: "first@ordo.app" },
        { id: "u2", email: "admin@ordo.app" },
      ],
    });
    const adminCfg = { instanceRenameEnabled: true, instanceAdminEmail: "admin@ordo.app" };
    expect(await userCanRenameInstance(prisma, adminCfg, { id: "u1", email: "first@ordo.app" })).toBe(
      false,
    );
    expect(await userCanRenameInstance(prisma, adminCfg, { id: "u2", email: "Admin@ordo.app" })).toBe(
      true,
    );
  });

  it("hands rename to the oldest remaining user after the owner is deleted", async () => {
    const prisma = store({
      ownerUserId: "gone",
      users: [{ id: "u2", email: "next@ordo.app" }],
    });
    expect(await userCanRenameInstance(prisma, cfg, { id: "u2", email: "next@ordo.app" })).toBe(true);
  });
});
