# Cloudflare Tunnel Subscription Manager

Cloudflare Tunnel Subscription Manager keeps Docker Swarm services reachable through fixed Cloudflare Tunnel and TryCloudflare quick tunnels, then turns those tunnel-aware proxy nodes into V2Ray, PassWall2, and sing-box subscriptions.

GitHub repository slug: `cf-tunnel-subscription-manager`.

## Components

- `worker/`: Cloudflare Worker control plane with D1 persistence, admin UI, cron health checks, restart command queue, import-source management, and subscription outputs.
- `agent/`: Go tunnel agent that starts `cloudflared`, records quick tunnel URLs, reports status, and polls restart commands.
- `deploy/`: Docker Swarm compose and environment templates.
- `docs/`: requirements and deployment documentation.

## Safety

Do not commit real Cloudflare tokens. Use Wrangler secrets and runtime environment variables.

## Current Status

First release is complete, build-tested on `ssh hd01`, and deployed to Cloudflare Workers at `https://cf-tunnel-control-plane.officesline.workers.dev`.

Latest verified deployment: Worker version `020883a3-fb90-4e2d-89ec-b1e99f5510b3` on 2026-06-11.

See:

- [Project requirements](docs/PROJECT_REQUIREMENTS.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Verification plan](docs/VERIFICATION.md)
- [Current status](docs/STATUS.md)
- [Completion audit](docs/COMPLETION_AUDIT.md)
- [User validation guide](docs/USER_VALIDATION.md)
