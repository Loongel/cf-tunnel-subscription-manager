# Deployment Guide

This guide intentionally uses placeholders. Do not commit real Cloudflare tokens.

## Worker

1. Create Cloudflare resources:

   ```bash
   cd worker
   npx wrangler d1 create cf-tunnel-control-plane
   npx wrangler kv namespace create SUB_CACHE
   ```

2. Update `worker/wrangler.toml` with the D1 and KV IDs.

3. Set secrets:

   ```bash
   cd worker
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler secret put AGENT_TOKEN
   npx wrangler secret put SUBSCRIPTION_TOKEN
   ```

   `SUBSCRIPTION_TOKEN` is the initial subscription token. After deployment, the admin UI can rotate it and store the active token in D1.

4. Apply migrations and deploy:

   ```bash
   cd worker
   npx wrangler d1 migrations apply cf-tunnel-control-plane --remote
   npx wrangler deploy
   ```

   Or run the helper on `ssh hd01` after `worker/wrangler.toml` contains the real D1 database ID:

   ```bash
   CLOUDFLARE_API_TOKEN=... \
   CLOUDFLARE_ACCOUNT_ID=... \
   ADMIN_TOKEN=... \
   AGENT_TOKEN=... \
   SUBSCRIPTION_TOKEN=... \
   ./scripts/deploy-worker.sh
   ```

   The token must include D1 database access, Workers script deploy access, and Worker secret edit access. A token that can only identify the account is not enough.

## Agent Image

Build on `ssh hd01`:

```bash
cd /path/to/CF-temp-tunnels-auto-update-to-subs/agent
docker build \
  --build-arg CLOUDFLARED_VERSION=2026.6.0 \
  -t ghcr.io/your-org/cf-tunnel-agent:0.1.0 .
```

Push the image to your registry, then update `deploy/docker-stack.example.yml`.

## Docker Swarm

Use `deploy/.env.template` as a template and provide runtime values outside Git.

```bash
docker stack deploy -c deploy/docker-stack.example.yml edge
```

The agent health endpoint is `127.0.0.1:1984/health` inside the container.
