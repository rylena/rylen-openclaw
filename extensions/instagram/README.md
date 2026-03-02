# Instagram Channel (instagram-cli)

This plugin wires Instagram DMs into OpenClaw using `instagram-cli` (LLM mode).

## Requirements

- Recommended fork: `instagram-cli-4llm` with `llm` commands.
- If `instagram-cli` is missing and `cliPath` is default, plugin auto-bootstraps with:
  - `npm install -g @i7m/instagram-cli`

## Config

```json
{
  "channels": {
    "instagram": {
      "enabled": true,
      "username": "your_ig_username",
      "passwordEnv": "INSTAGRAM_PASSWORD",
      "cliPath": "instagram-cli",
      "pollIntervalMs": 6000,
      "dmPolicy": "pairing"
    }
  }
}
```

Set password via env (default env key is `INSTAGRAM_PASSWORD`):

```bash
export INSTAGRAM_PASSWORD='...'
```

## Behavior

- Polls inbox threads + recent messages using:
  - `instagram-cli llm threads`
  - `instagram-cli llm messages`
- Routes inbound messages to OpenClaw sessions.
- Sends replies using:
  - `instagram-cli llm send <threadId> <text>`

## Notes

- This relies on unofficial Instagram client behavior.
- Keep poll intervals conservative to reduce account risk.
