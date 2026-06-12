# Cloudflare Tunnel Subscription Manager

Cloudflare Tunnel Subscription Manager manages fixed Cloudflare Tunnel and TryCloudflare quick tunnels for Docker Swarm services, records tunnel state in a Cloudflare Worker control plane, and generates V2Ray, PassWall2, and sing-box subscriptions from those tunnel-aware proxy nodes.

The project has two deployable parts:

- `worker/`: Cloudflare Worker control plane with D1 persistence, admin UI, tunnel health checks, restart command queue, import-source management, and subscription endpoints.
- `agent/`: Docker image that runs `cloudflared`, supervises fixed and quick tunnels, reports status to the Worker, and polls restart commands.

## Release Artifacts

- GitHub repository: `https://github.com/Loongel/cf-tunnel-subscription-manager`
- Worker deployment URL: `https://cf-tunnel-control-plane.officesline.workers.dev`
- Agent image: `ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.4`
- Agent image digest: `sha256:ed88e369233ad841d4a17d1a3483e07f45161b1594593add7bab091ede06515b`
- Latest verified Worker version: `4bb0d76c-ad99-48a8-ad75-a25595e2f59a`
- Pinned `cloudflared` version in the agent image: `2026.6.0`

Use a versioned agent image tag in production. `latest` is published for convenience, but production Swarm stacks should pin a release tag.

Verify the image before deploying a stack:

```bash
docker pull ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.4
docker run --rm --entrypoint cloudflared ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.4 --version
```

## Quick Start

1. Deploy the Worker and D1 database using [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
2. Create local secret files from the templates:

   ```bash
   install -m 700 -d .secrets
   cp deploy/worker.env.template .secrets/worker.env
   cp deploy/.env.template .secrets/swarm.env
   chmod 600 .secrets/*.env
   ```

3. Fill `.secrets/worker.env` for Worker deployment and `.secrets/swarm.env` for Docker Swarm deployment. The `.secrets/` directory is ignored by Git.
4. Deploy the Worker. The deploy helper backs up the remote D1 database before applying migrations:

   ```bash
   ./scripts/deploy-worker.sh
   ```

5. Deploy the Swarm stack:

   ```bash
   ./scripts/deploy-swarm.sh
   ```

6. Open the admin UI:

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

Use `.secrets/worker.env` and `.secrets/swarm.env` for local deployment state. Use `wrangler secret put` for Worker runtime secrets and runtime environment variables or Docker secrets for Swarm values.
