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

The user requires build and compile work to run on `ssh hd01`; do not perform heavy local compilation. In this workspace, non-interactive SSH works when `SSH_AUTH_SOCK` points at a signing agent such as `/tmp/ssh-hPdP3ZA6Jo6o/agent.14261` instead of the gpg-agent socket.

## Verification Commands

Run on `ssh hd01` once available:

```bash
SSH_AUTH_SOCK=/tmp/ssh-hPdP3ZA6Jo6o/agent.14261 ./scripts/diagnose-hd01-ssh.sh
SSH_AUTH_SOCK=/tmp/ssh-hPdP3ZA6Jo6o/agent.14261 ./scripts/remote-build-hd01.sh
./scripts/deploy-worker.sh
```

The expanded validation inside the remote build script is:

```bash
cd worker && npm ci && npm run check && npm test
cd ../agent && go test ./... && docker build --build-arg CLOUDFLARED_VERSION=2026.6.0 -t cf-tunnel-agent:test .
```

`./scripts/deploy-worker.sh` requires a Cloudflare API token that can manage D1 databases, apply D1 migrations, write Worker secrets, and deploy Workers.
