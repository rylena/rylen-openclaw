import { z } from "zod";

export const InstagramAccountConfigSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  passwordEnv: z.string().optional(),
  cliPath: z.string().optional(),
  pollIntervalMs: z.number().int().min(2000).max(120000).optional(),
  dmPolicy: z.enum(["allowlist", "pairing", "open", "off"]).optional(),
  allowFrom: z.array(z.string()).optional(),
});

export const InstagramConfigSchema = z.object({
  enabled: z.boolean().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  passwordEnv: z.string().optional(),
  cliPath: z.string().optional(),
  pollIntervalMs: z.number().int().min(2000).max(120000).optional(),
  dmPolicy: z.enum(["allowlist", "pairing", "open", "off"]).optional(),
  allowFrom: z.array(z.string()).optional(),
  accounts: z.record(z.string(), InstagramAccountConfigSchema).optional(),
});

export type InstagramConfig = z.infer<typeof InstagramConfigSchema>;
