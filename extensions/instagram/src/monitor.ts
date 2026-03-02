import {
  createReplyPrefixOptions,
  type OpenClawConfig,
  type ReplyPayload,
} from "openclaw/plugin-sdk";
import { getInstagramRuntime } from "./runtime.js";
import type { ResolvedInstagramAccount } from "./types.js";

type JsonEnvelope<T> = { ok: boolean; data?: T; error?: { message?: string } };

type ThreadLite = { id: string; title?: string; usernames?: string[] };
type MsgLite = {
  id: string;
  threadId: string;
  userId: string;
  username: string;
  isOutgoing?: boolean;
  timestamp?: string;
  text?: string;
};

type MonitorOptions = {
  account: ResolvedInstagramAccount;
  accountId: string;
  cfg: OpenClawConfig;
  abortSignal: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

function parseLastJsonObject<T>(raw: string): JsonEnvelope<T> | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();
  for (const line of lines) {
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line) as JsonEnvelope<T>;
    } catch {
      // ignore
    }
  }
  return null;
}

async function runLlmCommand<T>(cliPath: string, args: string[]): Promise<JsonEnvelope<T>> {
  const runtime = getInstagramRuntime();
  const argv = [cliPath, "llm", ...args];
  const result = await runtime.system.runCommandWithTimeout(argv, 60_000);
  const parsed = parseLastJsonObject<T>(result.stdout ?? "");
  if (parsed) return parsed;
  if (result.code !== 0) {
    return {
      ok: false,
      error: { message: result.stderr?.trim() || `Command failed: ${argv.join(" ")}` },
    };
  }
  return { ok: false, error: { message: "Invalid JSON output from instagram-cli" } };
}

async function deliverInstagramReply(params: {
  payload: ReplyPayload;
  threadId: string;
  account: ResolvedInstagramAccount;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { payload, threadId, account, statusSink } = params;
  if (!payload.text?.trim()) return;
  await runLlmCommand(account.cliPath, ["send", threadId, payload.text, account.username ?? ""]);
  statusSink?.({ lastOutboundAt: Date.now() });
}

export async function monitorInstagramProvider(
  options: MonitorOptions,
): Promise<{ stop: () => void }> {
  const { account, accountId, cfg, abortSignal, statusSink } = options;
  const core = getInstagramRuntime();
  const logger = core.logging.getChildLogger({ module: "instagram", accountId });

  const threadHighWater = new Map<string, number>();
  let stopped = false;

  const processMessage = async (message: MsgLite): Promise<void> => {
    const rawBody = message.text?.trim() ?? "";
    if (!rawBody) return;

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "instagram",
      accountId,
      peer: {
        kind: "direct",
        id: message.threadId,
      },
    });

    const body = core.channel.reply.formatAgentEnvelope({
      channel: "Instagram",
      from: message.username,
      timestamp: message.timestamp ? Date.parse(message.timestamp) : undefined,
      envelope: core.channel.reply.resolveEnvelopeFormatOptions(cfg),
      body: rawBody,
    });

    const ctx = core.channel.reply.finalizeInboundContext({
      Body: body,
      BodyForAgent: rawBody,
      RawBody: rawBody,
      CommandBody: rawBody,
      From: `instagram:user:${message.userId}`,
      To: `instagram:thread:${message.threadId}`,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: "direct",
      ConversationLabel: message.threadId,
      SenderName: message.username,
      SenderUsername: message.username,
      SenderId: message.userId,
      Provider: "instagram",
      Surface: "instagram",
      MessageSid: message.id,
      OriginatingChannel: "instagram",
      OriginatingTo: `instagram:thread:${message.threadId}`,
    });

    const storePath = core.channel.session.resolveStorePath(cfg.session?.store, {
      agentId: route.agentId,
    });
    await core.channel.session.recordInboundSession({
      storePath,
      sessionKey: ctx.SessionKey ?? route.sessionKey,
      ctx,
      onRecordError: (err) => logger.warn(`Failed updating session meta: ${String(err)}`),
    });

    const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
      cfg,
      agentId: route.agentId,
      channel: "instagram",
      accountId,
    });

    await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx,
      cfg,
      dispatcherOptions: {
        ...prefixOptions,
        deliver: async (payload) =>
          await deliverInstagramReply({
            payload,
            threadId: message.threadId,
            account,
            statusSink,
          }),
      },
      replyOptions: { onModelSelected },
    });
  };

  const pollOnce = async (): Promise<void> => {
    const threads = await runLlmCommand<ThreadLite[]>(account.cliPath, [
      "threads",
      account.username ?? "",
      "--limit",
      "30",
      "--fields",
      "id,title,usernames",
    ]);
    if (!threads.ok || !threads.data) {
      if (threads.error?.message) logger.warn(`threads poll failed: ${threads.error.message}`);
      return;
    }

    for (const thread of threads.data) {
      const since = threadHighWater.get(thread.id);
      const args = [
        "messages",
        thread.id,
        account.username ?? "",
        "--limit",
        "20",
        "--fields",
        "id,threadId,userId,username,isOutgoing,timestamp,text",
      ];
      if (since) args.push("--since", new Date(since).toISOString());
      const messages = await runLlmCommand<MsgLite[]>(account.cliPath, args);
      if (!messages.ok || !messages.data) continue;
      for (const message of messages.data) {
        const ts = message.timestamp ? Date.parse(message.timestamp) : Date.now();
        const prev = threadHighWater.get(thread.id) ?? 0;
        if (ts > prev) threadHighWater.set(thread.id, ts);
        if (message.isOutgoing) continue;
        await processMessage(message);
        statusSink?.({ lastInboundAt: Date.now() });
      }
    }
  };

  const loop = async () => {
    while (!stopped && !abortSignal.aborted) {
      try {
        await pollOnce();
      } catch (error) {
        logger.error(`Instagram poll loop failed: ${String(error)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, account.pollIntervalMs));
    }
  };

  void loop();

  return {
    stop: () => {
      stopped = true;
    },
  };
}
