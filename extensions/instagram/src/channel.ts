import {
  buildChannelConfigSchema,
  createDefaultChannelRuntimeState,
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
  type ChannelPlugin,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";
import { InstagramConfigSchema, type InstagramConfig } from "./config-schema.js";
import { monitorInstagramProvider } from "./monitor.js";
import { getInstagramRuntime } from "./runtime.js";
import {
  listInstagramAccountIds,
  resolveDefaultInstagramAccountId,
  resolveInstagramAccount,
  type ResolvedInstagramAccount,
} from "./types.js";

async function ensureInstagramCliAvailable(cliPath: string): Promise<void> {
  const runtime = getInstagramRuntime();
  const check = await runtime.system.runCommandWithTimeout(`${cliPath} --version`, 20_000);
  if (check.exitCode === 0) return;

  // Fallback bootstrap for default CLI name so integration behaves like a built-in channel dependency.
  if (cliPath.trim() === "instagram-cli") {
    await runtime.system.runCommandWithTimeout("npm install -g @i7m/instagram-cli", 180_000);
    const recheck = await runtime.system.runCommandWithTimeout(`${cliPath} --version`, 20_000);
    if (recheck.exitCode === 0) return;
  }

  throw new Error(
    `Instagram CLI not available. Set channels.instagram.cliPath or install @i7m/instagram-cli.`,
  );
}

export const instagramPlugin: ChannelPlugin<ResolvedInstagramAccount> = {
  id: "instagram",
  meta: {
    id: "instagram",
    label: "Instagram",
    selectionLabel: "Instagram",
    detailLabel: "Instagram DM",
    docsPath: "/channels/instagram",
    docsLabel: "instagram",
    blurb: "Instagram DM integration via instagram-cli",
    quickstartAllowFrom: true,
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: false,
    reactions: false,
    threads: true,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.instagram"] },
  configSchema: buildChannelConfigSchema(InstagramConfigSchema),
  config: {
    listAccountIds: (cfg) => listInstagramAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveInstagramAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultInstagramAccountId(cfg),
    isConfigured: (account) => Boolean(account.username),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      username: account.username,
      cliPath: account.cliPath,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveInstagramAccount({ cfg, accountId }).config.allowFrom ?? []).map(String),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^instagram:(?:user:)?/i, "")),
  },
  pairing: {
    idLabel: "instagramUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^instagram:(?:user:)?/i, ""),
    notifyApproval: async ({ cfg, id, accountId }) => {
      const account = resolveInstagramAccount({ cfg, accountId });
      await getInstagramRuntime().system.runCommandWithTimeout(
        `${account.cliPath} llm send ${JSON.stringify(id)} ${JSON.stringify("Your OpenClaw pairing request was approved.")} ${JSON.stringify(account.username ?? "")}`,
        45_000,
      );
    },
  },
  security: {
    resolveDmPolicy: ({ account, accountId }) => ({
      policy: account.config.dmPolicy ?? "pairing",
      allowFrom: account.config.allowFrom ?? [],
      policyPath:
        accountId && accountId !== DEFAULT_ACCOUNT_ID
          ? `channels.instagram.accounts.${accountId}.dmPolicy`
          : "channels.instagram.dmPolicy",
      allowFromPath:
        accountId && accountId !== DEFAULT_ACCOUNT_ID
          ? `channels.instagram.accounts.${accountId}`
          : "channels.instagram",
      approveHint: formatPairingApproveHint("instagram"),
      normalizeEntry: (raw) => raw.replace(/^instagram:(?:user:)?/i, ""),
    }),
  },
  messaging: {
    normalizeTarget: (target) => target.trim().replace(/^instagram:(?:thread:)?/i, ""),
    targetResolver: {
      looksLikeId: (id) => Boolean(id?.trim()),
      hint: "<threadId>",
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getInstagramRuntime().channel.text.chunkMarkdownText(text, limit),
    textChunkLimit: 1200,
    sendText: async ({ to, text, accountId, cfg }) => {
      const account = resolveInstagramAccount({ cfg, accountId });
      const quotedTo = JSON.stringify(to);
      const quotedText = JSON.stringify(text);
      const quotedUser = JSON.stringify(account.username ?? "");
      await getInstagramRuntime().system.runCommandWithTimeout(
        `${account.cliPath} llm send ${quotedTo} ${quotedText} ${quotedUser}`,
        45_000,
      );
      return { channel: "instagram" as const, messageId: `ig-${Date.now()}`, chatId: to };
    },
  },
  status: {
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
    collectStatusIssues: (accounts) =>
      accounts
        .filter((account) => !account.username)
        .map((account) => ({
          channel: "instagram" as const,
          accountId: account.accountId,
          kind: "config" as const,
          message: "Instagram username is not configured",
        })),
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      username: account.username,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
    }),
  },
  setup: {
    resolveAccountId: ({ accountId }) => accountId?.trim() || DEFAULT_ACCOUNT_ID,
    applyAccountName: ({ cfg, accountId, name }) => {
      const current = (cfg.channels?.instagram ?? {}) as InstagramConfig;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...cfg,
          channels: { ...cfg.channels, instagram: { ...current, name } },
        };
      }
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          instagram: {
            ...current,
            accounts: {
              ...current.accounts,
              [accountId]: { ...current.accounts?.[accountId], name },
            },
          },
        },
      };
    },
    validateInput: ({ input }) => {
      const i = input as {
        username?: string;
      };
      if (!i.username) return "Instagram requires username in setup.";
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const i = input as {
        name?: string;
        username?: string;
        password?: string;
        passwordEnv?: string;
        cliPath?: string;
        pollIntervalMs?: number;
      };
      const current = (cfg.channels?.instagram ?? {}) as InstagramConfig;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            instagram: {
              ...current,
              enabled: true,
              ...(i.name ? { name: i.name } : {}),
              ...(i.username ? { username: i.username } : {}),
              ...(i.password ? { password: i.password } : {}),
              ...(i.passwordEnv ? { passwordEnv: i.passwordEnv } : {}),
              ...(i.cliPath ? { cliPath: i.cliPath } : {}),
              ...(i.pollIntervalMs ? { pollIntervalMs: i.pollIntervalMs } : {}),
            },
          },
        };
      }
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          instagram: {
            ...current,
            enabled: true,
            accounts: {
              ...current.accounts,
              [accountId]: {
                ...current.accounts?.[accountId],
                enabled: true,
                ...(i.name ? { name: i.name } : {}),
                ...(i.username ? { username: i.username } : {}),
                ...(i.password ? { password: i.password } : {}),
                ...(i.passwordEnv ? { passwordEnv: i.passwordEnv } : {}),
                ...(i.cliPath ? { cliPath: i.cliPath } : {}),
                ...(i.pollIntervalMs ? { pollIntervalMs: i.pollIntervalMs } : {}),
              },
            },
          },
        },
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      await ensureInstagramCliAvailable(account.cliPath);
      const pwd = account.passwordEnv
        ? (process.env[account.passwordEnv]?.trim() ?? "")
        : (account.password ?? "");
      if (account.username && pwd) {
        const loginCmd = `${account.cliPath} auth login --username ${JSON.stringify(account.username)} ${JSON.stringify(pwd)}`;
        await getInstagramRuntime().system.runCommandWithTimeout(loginCmd, 120_000);
      }
      return monitorInstagramProvider({
        account,
        accountId: account.accountId,
        cfg: ctx.cfg,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus(patch),
      });
    },
    logoutAccount: async ({ cfg, accountId }) => {
      const nextCfg = { ...cfg } as OpenClawConfig;
      const ig = ((cfg.channels?.instagram ?? {}) as InstagramConfig) ?? {};
      if (accountId === DEFAULT_ACCOUNT_ID) {
        delete ig.username;
        delete ig.password;
        delete ig.passwordEnv;
        nextCfg.channels = { ...nextCfg.channels, instagram: ig };
        await getInstagramRuntime().config.writeConfigFile(nextCfg);
        return { cleared: true, envToken: false, loggedOut: true };
      }
      const accounts = { ...(ig.accounts ?? {}) };
      delete accounts[accountId];
      ig.accounts = accounts;
      nextCfg.channels = { ...nextCfg.channels, instagram: ig };
      await getInstagramRuntime().config.writeConfigFile(nextCfg);
      return { cleared: true, envToken: false, loggedOut: true };
    },
  },
};
