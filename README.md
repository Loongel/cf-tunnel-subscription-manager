# CF Temporary Tunnel Registry and Subscription Manager

Control plane and tunnel agent for Docker Swarm services exposed through fixed Cloudflare Tunnel and TryCloudflare quick tunnels.

## Components

- `worker/`: Cloudflare Worker control plane with D1 persistence, admin UI, cron health checks, command queue, and subscription outputs.
- `agent/`: Go tunnel agent that starts `cloudflared`, records quick tunnel URLs, reports status, and polls restart commands.
- `deploy/`: Docker Swarm compose and environment templates.
- `docs/`: requirements and deployment documentation.

## Safety

Do not commit real Cloudflare tokens. Use Wrangler secrets and runtime environment variables.

## Current Status

Source implementation is complete for the first release and has been build-tested on `ssh hd01`. Live Cloudflare deployment still needs an API token with D1 and Workers permissions.

See:

- [Project requirements](docs/PROJECT_REQUIREMENTS.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Verification plan](docs/VERIFICATION.md)
- [Current status](docs/STATUS.md)
- [Completion audit](docs/COMPLETION_AUDIT.md)
