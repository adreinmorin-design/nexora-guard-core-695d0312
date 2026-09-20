import { z } from "zod";

export const MAIL_HOST = "mail.privateemail.com";
export const mailboxInput = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z
    .string()
    .min(1)
    .max(512)
    .refine((s) => !/[\r\n\0]/.test(s), "Invalid password"),
});
export const messageInput = z.object({
  to: z.string().trim().email().max(254),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((s) => !/[\r\n\0]/.test(s)),
  text: z.string().min(1).max(20000),
  requestId: z.string().uuid(),
});
export const uidInput = z.object({
  uid: z.number().int().positive().max(4294967295),
  validity: z.string().regex(/^\d{1,20}$/),
});
export function requireEmailAdmin(roles: string[]) {
  if (!roles.some((role) => ["platform_admin", "org_admin"].includes(role))) {
    throw new Error("Organization administrator role required.");
  }
}
