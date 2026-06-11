# Cloudflare Tunnel Subscription Manager

Cloudflare Tunnel Subscription Manager manages fixed Cloudflare Tunnel and TryCloudflare quick tunnels for Docker Swarm services, records tunnel state in a Cloudflare Worker control plane, and generates V2Ray, PassWall2, and sing-box subscriptions from those tunnel-aware proxy nodes.

The project has two deployable parts:

- `worker/`: Cloudflare Worker control plane with D1 persistence, admin UI, tunnel health checks, restart command queue, import-source management, and subscription endpoints.
- `agent/`: Docker image that runs `cloudflared`, supervises fixed and quick tunnels, reports status to the Worker, and polls restart commands.

## Release Artifacts

- GitHub repository: `https://github.com/Loongel/cf-tunnel-subscription-manager`
- Worker deployment URL: `https://cf-tunnel-control-plane.officesline.workers.dev`
- Agent image: `ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.2`
- Latest verified Worker version: `020883a3-fb90-4e2d-89ec-b1e99f5510b3`
- Pinned `cloudflared` version in the agent image: `2026.6.0`

Use a versioned agent image tag in production. `latest` is published for convenience, but production Swarm stacks should pin a release tag.

## Quick Start

1. Deploy the Worker and D1 database using [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
2. Copy [deploy/.env.template](deploy/.env.template) to a private `.env` file and fill in `WORKER_BASE_URL`, `AGENT_TOKEN`, `DEPLOY_NODE`, and tunnel targets.
3. Deploy the Swarm stack:

   ```bash
   docker stack deploy --with-registry-auth -c deploy/docker-stack.example.yml edge
   ```

4. Open the admin UI:

   ```text
   https://cf-tunnel-control-plane.officesline.workers.dev/admin
   ```

## Documentation

- [Deployment guide](docs/DEPLOYMENT.md): production deployment, cutover order, image usage, and configuration reference.
- [Verification guide](docs/VERIFICATION.md): build, test, deployment, smoke, and UI checks.
- [User validation guide](docs/USER_VALIDATION.md): manual UI checks against the deployed Worker.
- [Subscription adapter notes](docs/SUBSCRIPTION_ADAPTERS.md): supported proxy protocols and conversion boundaries.
- [Project requirements](docs/PROJECT_REQUIREMENTS.md): original product and technical specification.
- [Completion audit](docs/COMPLETION_AUDIT.md): delivery evidence.

## Security

Do not commit Cloudflare API tokens, tunnel tokens, admin tokens, agent tokens, or subscription tokens.

Use `wrangler secret put` for Worker secrets and runtime environment variables or Docker secrets for Swarm values.
