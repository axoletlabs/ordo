import { APP_NAME } from "@ordo/shared";
import { toUserDto, type UserDtoFields } from "../common/mappers.js";
import type { AppConfig } from "../config/config.module.js";
import type { UserDto } from "@ordo/shared";

export const INSTANCE_SETTINGS_ID = "instance";

export type InstanceAdminConfig = Pick<AppConfig, "instanceRenameEnabled" | "instanceAdminEmail">;

type InstanceSettingsRow = {
  id: string;
  name: string;
  ownerUserId: string | null;
};

export type OwnerStore = {
  instanceSettings: {
    findUnique: (args: { where: { id: string } }) => Promise<InstanceSettingsRow | null>;
    create: (args: { data: { id: string; name: string; ownerUserId: string } }) => Promise<unknown>;
    update: (args: { where: { id: string }; data: { ownerUserId: string } }) => Promise<unknown>;
  };
  user: {
    findUnique: (args: { where: { id: string }; select?: { id: true } }) => Promise<{ id: string } | null>;
    findFirst: (args: {
      orderBy: Array<{ createdAt?: "asc"; id?: "asc" }>;
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
};

export function instanceDisplayName(stored: string | null | undefined): string {
  const value = stored?.trim();
  return value || APP_NAME;
}

/** First account to exist owns the instance name, unless an admin email is set. */
export async function claimInstanceOwner(prisma: OwnerStore, userId: string): Promise<void> {
  const row = await prisma.instanceSettings.findUnique({
    where: { id: INSTANCE_SETTINGS_ID },
  });
  if (!row) {
    await prisma.instanceSettings.create({
      data: { id: INSTANCE_SETTINGS_ID, name: APP_NAME, ownerUserId: userId },
    });
    return;
  }
  if (row.ownerUserId) {
    const owner = await prisma.user.findUnique({
      where: { id: row.ownerUserId },
      select: { id: true },
    });
    if (owner) return;
  }
  await prisma.instanceSettings.update({
    where: { id: INSTANCE_SETTINGS_ID },
    data: { ownerUserId: userId },
  });
}

export async function userCanRenameInstance(
  prisma: OwnerStore,
  cfg: InstanceAdminConfig,
  user: { id: string; email: string },
): Promise<boolean> {
  if (!cfg.instanceRenameEnabled) return false;
  const adminEmail = cfg.instanceAdminEmail;
  if (adminEmail) return user.email.trim().toLowerCase() === adminEmail;
  const ownerId = await resolveOwnerUserId(prisma);
  return ownerId === user.id;
}

export async function userDtoWithRename(
  prisma: OwnerStore,
  cfg: InstanceAdminConfig,
  user: UserDtoFields,
): Promise<UserDto> {
  return toUserDto(user, await userCanRenameInstance(prisma, cfg, user));
}

async function resolveOwnerUserId(prisma: OwnerStore): Promise<string | null> {
  const row = await prisma.instanceSettings.findUnique({
    where: { id: INSTANCE_SETTINGS_ID },
  });
  if (row?.ownerUserId) {
    const owner = await prisma.user.findUnique({
      where: { id: row.ownerUserId },
      select: { id: true },
    });
    if (owner) return owner.id;
  }
  const first = await prisma.user.findFirst({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!first) return null;
  await claimInstanceOwner(prisma, first.id);
  return first.id;
}
