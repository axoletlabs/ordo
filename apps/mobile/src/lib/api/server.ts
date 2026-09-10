/**
 * Server info endpoint (unauthenticated) and instance name (authenticated).
 */
import { ServerRoutes, type ChangeServerNameInput } from "@ordo/shared";
import { api } from "./client";

export const serverApi = {
  info: () => api.get<typeof ServerRoutes.info.response>(ServerRoutes.info.path, { auth: false }),
  rename: (body: ChangeServerNameInput) =>
    api.patch<typeof ServerRoutes.rename.response>(ServerRoutes.rename.path, body),
};
