import { z } from "zod";

export const ChangeServerNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Enter a server name." })
    .max(64, { message: "Server name must be 64 characters or fewer." }),
});
export type ChangeServerNameInput = z.infer<typeof ChangeServerNameSchema>;
