# Repository Instructions

Project display name: Cloudflare Tunnel Subscription Manager.

Target GitHub repository slug: `cf-tunnel-subscription-manager`.

## Project Shape

- `worker/` is a Cloudflare Workers TypeScript application using D1.
- `agent/` is a Go application that supervises `cloudflared`.
- `deploy/` contains Docker Swarm templates.
- `docs/` contains requirements, deployment, verification, and adapter notes.

## Secrets

Never commit real Cloudflare tokens, tunnel tokens, or subscription tokens. Use `wrangler secret put` and runtime environment variables.

## Build Location

The user requires build and compile work to run on `ssh hd01`; do not perform heavy local compilation. Use the current default SSH agent environment; do not hardcode a stale `SSH_AUTH_SOCK` path.

## Verification Commands

Run on `ssh hd01` once available:

```bash
./scripts/diagnose-hd01-ssh.sh
./scripts/remote-build-hd01.sh
./scripts/deploy-worker.sh
```

The expanded validation inside the remote build script is:

```bash
cd worker && npm ci && npm run check && npm test
cd ../agent && go test ./... && docker build --build-arg CLOUDFLARED_VERSION=2026.6.0 -t cf-tunnel-agent:test .
```

`./scripts/deploy-worker.sh` requires a Cloudflare API token that can manage D1 databases, apply D1 migrations, write Worker secrets, and deploy Workers.
