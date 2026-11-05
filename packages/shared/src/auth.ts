import { z } from 'zod';
export const loginSchema = z.strictObject({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(1024),
});
export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(12).max(1024),
});
export const deleteAccountSchema = z.strictObject({
  password: z.string().min(1).max(1024),
});
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const currentUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  locale: z.string(),
  createdAt: z.iso.datetime(),
});
export const csrfResponseSchema = z.object({ csrfToken: z.string().min(1) });
export const loginResponseSchema = z.object({
  user: currentUserSchema.omit({ createdAt: true }),
  csrfToken: z.string().min(1),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;
