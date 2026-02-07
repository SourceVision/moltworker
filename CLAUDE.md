# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains **Moltworker** (branded as "Effi"), a Cloudflare Worker that runs [OpenClaw](https://github.com/openclaw/openclaw) (formerly Moltbot) personal AI assistant in a Cloudflare Sandbox container. The project uses a Hono-based worker to manage a containerized OpenClaw instance, providing persistent storage, authentication, and integration with Cloudflare services.

**Important naming note:** The upstream CLI tool is still named `clawdbot` internally, so you'll see this name in paths (`~/.clawdbot/`), process names, and CLI commands throughout the codebase.

## Architecture

```
Cloudflare Worker (Hono)
├── Routes
│   ├── / → Proxy to OpenClaw gateway (web UI + WebSocket)
│   ├── /_admin/ → React admin UI (device pairing, R2 status)
│   ├── /api/* → Device management API
│   ├── /debug/* → Debug endpoints (processes, logs, version)
│   └── /cdp/* → Chrome DevTools Protocol shim for browser automation
├── Cloudflare Sandbox Container
│   ├── OpenClaw Gateway (Node.js, port 18789)
│   ├── Pre-installed skills (/root/clawd/skills/)
│   └── R2 Backup Mount (/data/moltbot)
└── Integrations
    ├── Cloudflare Access (JWT auth for admin routes)
    ├── R2 Storage (persistent data via sync)
    └── Browser Rendering (CDP proxy)
```

## Project Structure

```
moltworker/
├── src/
│   ├── index.ts              # Main Hono app, sandbox lifecycle
│   ├── types.ts              # TypeScript interfaces
│   ├── config.ts             # Constants (ports, timeouts)
│   ├── auth/                 # Cloudflare Access JWT verification
│   │   ├── jwt.ts            # JWT decoding/validation
│   │   ├── jwks.ts           # JWKS fetching/caching
│   │   └── middleware.ts     # Hono auth middleware
│   ├── gateway/              # OpenClaw gateway management
│   │   ├── process.ts        # Process lifecycle (find, start)
│   │   ├── env.ts            # Container env var building
│   │   ├── r2.ts             # R2 bucket mounting
│   │   ├── sync.ts           # R2 backup sync logic
│   │   └── utils.ts          # Shared utilities
│   ├── routes/               # Route handlers
│   │   ├── api.ts            # /api/* (devices, gateway control)
│   │   ├── admin.ts          # /_admin/* (admin UI)
│   │   ├── debug.ts          # /debug/* (troubleshooting)
│   │   └── cdp.ts            # /cdp/* (browser automation)
│   ├── utils/                # Shared utilities
│   └── client/               # React admin UI (built with Vite)
│       ├── App.tsx
│       ├── api.ts            # API client
│       └── pages/            # Admin UI pages
├── Dockerfile                # Container image (Node 22 + OpenClaw)
├── start-moltbot.sh          # Container startup script
├── moltbot.json.template     # Default OpenClaw config
├── skills/                   # Pre-installed skills
│   └── cloudflare-browser/   # Browser automation skill
├── wrangler.jsonc            # Cloudflare Worker config
└── vite.config.ts            # Vite config for admin UI
```

## Development Commands

```bash
# Install dependencies
npm install

# Development (Vite dev server for admin UI)
npm run dev

# Development (Wrangler local worker)
npm run start

# Build worker + admin UI
npm run build

# Deploy to Cloudflare
npm run deploy

# Tests
npm test                 # Run all tests (vitest)
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report

# Type checking
npm run typecheck        # TypeScript type checking
npm run types            # Generate Wrangler types
```

## Local Development Setup

Create `.dev.vars` file:
```bash
ANTHROPIC_API_KEY=sk-ant-...
DEV_MODE=true           # Skip CF Access auth + device pairing
DEBUG_ROUTES=true       # Enable /debug/* routes
MOLTBOT_GATEWAY_TOKEN=your-token-here
```

**Important:** `wrangler dev` has WebSocket proxying issues through the sandbox. HTTP routes work but WebSocket connections may fail locally. Deploy to Cloudflare for full WebSocket functionality.

## Key Technical Details

### Environment Variables

The worker uses two layers of environment variables:
1. **Worker secrets** (set via `wrangler secret put`) → MoltbotEnv interface
2. **Container env vars** (built in `gateway/env.ts`) → Passed to OpenClaw process

Variable mapping:
- `MOLTBOT_GATEWAY_TOKEN` → `CLAWDBOT_GATEWAY_TOKEN` (container)
- `DEV_MODE` → `CLAWDBOT_DEV_MODE` (container)
- API keys passed directly

### CLI Commands

When calling OpenClaw CLI from the worker:
```typescript
// ✓ Correct - always include --url
sandbox.startProcess('clawdbot devices list --json --url ws://localhost:18789')

// ✗ Wrong - CLI will hang without --url
sandbox.startProcess('clawdbot devices list --json')
```

CLI commands take 10-15 seconds due to WebSocket connection overhead. Use `waitForProcess()` helper from `gateway/utils.ts`.

### R2 Storage Architecture

R2 is mounted via s3fs at `/data/moltbot` in the container. The sync strategy is **backup/restore**, not real-time:

**Startup:**
1. Check if R2 backup exists and is newer than local
2. If yes, restore from R2 to `~/.clawdbot/`
3. OpenClaw uses its default local paths

**Runtime:**
- Cron job every 5 minutes: sync local config → R2
- Manual trigger available via admin UI
- Sync uses `rsync -r --no-times` (s3fs doesn't support timestamps)

**Critical R2 gotchas:**
- `/data/moltbot` IS the R2 bucket when mounted - never `rm -rf` this directory
- Always check `mount | grep s3fs` before destructive operations
- Don't rely on `mountBucket()` error messages for "already mounted" detection

### Authentication Layers

1. **Cloudflare Access** - JWT verification for `/_admin/*`, `/api/*`, `/debug/*`
2. **Gateway Token** - Required for Control UI access via `?token=` query param
3. **Device Pairing** - Each device must be approved via admin UI

Bypass all auth in local dev: `DEV_MODE=true`

### OpenClaw Configuration

- Config template: `moltbot.json.template`
- Runtime location: `~/.clawdbot/clawdbot.json`
- Modified by `start-moltbot.sh` from env vars
- Uses `--allow-unconfigured` flag to skip onboarding

**Schema gotchas:**
- `agents.defaults.model` must be `{ "primary": "model/name" }` not a string
- `gateway.mode` must be `"local"` for headless operation
- No `webchat` channel - Control UI is automatic
- `gateway.bind` is not valid config - use `--bind` CLI flag

## Testing

Tests use Vitest with Node environment. Test files are colocated with source code (`*.test.ts`).

Coverage areas:
- JWT/JWKS authentication (`auth/*.test.ts`)
- Environment variable building (`gateway/env.test.ts`)
- Process management (`gateway/process.test.ts`)
- R2 mounting logic (`gateway/r2.test.ts`)

Client code (`src/client/**`) is excluded from tests.

## Success Detection Patterns

When parsing CLI output for success:
```typescript
// ✓ Case-insensitive check
stdout.toLowerCase().includes('approved')

// ✗ Case-sensitive will miss "Approved"
stdout.includes('approved')
```

## Docker Cache Busting

When modifying `moltbot.json.template` or `start-moltbot.sh`, update the cache bust comment in `Dockerfile`:
```dockerfile
# Build cache bust: 2026-01-28-v26-browser-skill
```

## Contributing Guidelines

Per `CONTRIBUTING.md`:
- **Create issues first** for non-trivial changes
- **Disclose all AI usage** - state the tool and extent of AI assistance
- **Test thoroughly** - demonstrate manual or automated testing
- **Human-in-the-loop required** - AI-generated content must be reviewed/edited
- PRs with AI assistance can only be for accepted issues

## Common Pitfalls

1. **Don't use `git add -A` for commits** - stage specific files to avoid secrets/binaries
2. **Don't amend commits after hook failures** - create NEW commits instead
3. **Always include `--url ws://localhost:18789` in CLI commands**
4. **Check `mount | grep s3fs` before any filesystem operations in `/data/moltbot`**
5. **Use `rsync -r --no-times` for R2 syncs** - s3fs doesn't support timestamps
6. **Wait 10-15 seconds for CLI commands** - they need WebSocket connection time

## Debugging

```bash
# Live logs
npx wrangler tail

# List secrets
npx wrangler secret list

# Check container processes (requires DEBUG_ROUTES=true)
curl https://your-worker.workers.dev/debug/processes -H "Cf-Access-Jwt-Assertion: ..."

# View process logs
curl https://your-worker.workers.dev/debug/logs?id=<pid> -H "Cf-Access-Jwt-Assertion: ..."
```

## External Resources

- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [OpenClaw Docs](https://docs.openclaw.ai/)
- [Cloudflare Sandbox Docs](https://developers.cloudflare.com/sandbox/)
- [Cloudflare Access Docs](https://developers.cloudflare.com/cloudflare-one/policies/access/)
