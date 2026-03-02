import { DEFAULT_ACCOUNT_ID, type OpenClawConfig } from "openclaw/plugin-sdk";
import type { InstagramConfig } from "./config-schema.js";

export type ResolvedInstagramAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  username?: string;
  password?: string;
  passwordEnv?: string;
  cliPath: string;
  pollIntervalMs: number;
  config: {
    dmPolicy?: "allowlist" | "pairing" | "open" | "off";
    allowFrom?: string[];
  };
};

export function listInstagramAccountIds(cfg: OpenClawConfig): string[] {
  const base = (cfg.channels?.instagram ?? {}) as InstagramConfig;
  const ids = new Set<string>([DEFAULT_ACCOUNT_ID]);
  for (const id of Object.keys(base.accounts ?? {})) ids.add(id);
  return [...ids];
}

export function resolveDefaultInstagramAccountId(_cfg: OpenClawConfig): string {
  return DEFAULT_ACCOUNT_ID;
}

export function resolveInstagramAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string;
}): ResolvedInstagramAccount {
  const { cfg } = params;
  const accountId = params.accountId ?? DEFAULT_ACCOUNT_ID;
  const base = (cfg.channels?.instagram ?? {}) as InstagramConfig;
  const scoped = accountId === DEFAULT_ACCOUNT_ID ? undefined : base.accounts?.[accountId];
  const username = scoped?.username ?? base.username;
  const password = scoped?.password ?? base.password;
  const passwordEnv = scoped?.passwordEnv ?? base.passwordEnv;
  const cliPath = scoped?.cliPath ?? base.cliPath ?? "instagram-cli";
  const pollIntervalMs = scoped?.pollIntervalMs ?? base.pollIntervalMs ?? 6000;
  const enabled = (scoped?.enabled ?? base.enabled ?? true) !== false;
  return {
    accountId,
    name: scoped?.name,
    enabled,
    configured: Boolean(username),
    username,
    password,
    passwordEnv,
    cliPath,
    pollIntervalMs,
    config: {
      dmPolicy: scoped?.dmPolicy ?? base.dmPolicy,
      allowFrom: scoped?.allowFrom ?? base.allowFrom,
    },
  };
}
