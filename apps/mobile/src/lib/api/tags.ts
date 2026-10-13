/**
 * Tags API endpoints.
 */
import { TagRoutes, buildPath, type TagColor } from "@ordo/shared";
import { api } from "./client";

export const tagsApi = {
  list: () => api.get<typeof TagRoutes.list.response>(TagRoutes.list.path),

  create: (name: string, color?: TagColor) =>
    api.post<typeof TagRoutes.create.response>(TagRoutes.create.path, { name, color }),

  update: (id: string, input: { name?: string; color?: TagColor }) =>
    api.patch<typeof TagRoutes.update.response>(
      buildPath(TagRoutes.update.path, { id }),
      input,
    ),

  remove: (id: string) =>
    api.delete<typeof TagRoutes.remove.response>(buildPath(TagRoutes.remove.path, { id })),
};
