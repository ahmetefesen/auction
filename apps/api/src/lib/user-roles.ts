import { prisma, Role as DbRole } from "@auction/db";
import {
  Role,
  hasRole,
  sortRoles,
  type PublicUser,
  type Role as RoleType,
} from "@auction/shared";

export async function loadUserRoles(userId: string): Promise<RoleType[]> {
  const rows = await prisma.userRole.findMany({
    where: { userId },
    select: { role: true },
  });
  return sortRoles(rows.map((r) => r.role as RoleType));
}

export function rolesFromInclude(
  roles: Array<{ role: DbRole | RoleType }> | undefined,
): RoleType[] {
  return sortRoles((roles ?? []).map((r) => r.role as RoleType));
}

/** Create UserRole rows + matching profile stubs for the given roles. */
export async function assignRolesAndProfiles(
  userId: string,
  roles: readonly RoleType[],
): Promise<void> {
  const unique = [...new Set(roles)];
  await prisma.$transaction(async (tx) => {
    await tx.userRole.createMany({
      data: unique.map((role) => ({ userId, role })),
      skipDuplicates: true,
    });
    if (hasRole(unique, Role.SELLER)) {
      await tx.sellerProfile.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
    }
    if (hasRole(unique, Role.BUYER)) {
      await tx.buyerProfile.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
    }
    if (hasRole(unique, Role.ADMIN)) {
      await tx.adminProfile.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
    }
  });
}

export function toPublicUser(user: {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: Date;
  roles: Array<{ role: DbRole | RoleType }> | RoleType[];
}): PublicUser {
  const first = user.roles[0];
  const roles =
    typeof first === "string"
      ? sortRoles(user.roles as RoleType[])
      : rolesFromInclude(user.roles as Array<{ role: DbRole | RoleType }>);

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roles,
    status: user.status as PublicUser["status"],
    createdAt: user.createdAt.toISOString(),
  };
}
