# syntax=docker/dockerfile:1

ARG GO_VERSION=1.22
ARG ALPINE_VERSION=3.20
ARG CLOUDFLARED_VERSION=2026.6.0

FROM golang:${GO_VERSION}-alpine AS agent-builder
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/tunnel-agent ./cmd/tunnel-agent

FROM alpine:${ALPINE_VERSION} AS cloudflared
ARG CLOUDFLARED_VERSION
RUN apk add --no-cache ca-certificates curl
RUN curl -fsSL --retry 5 \
      -o /usr/local/bin/cloudflared \
      "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64" \
    && chmod +x /usr/local/bin/cloudflared \
    && /usr/local/bin/cloudflared --version

FROM alpine:${ALPINE_VERSION}
RUN apk add --no-cache ca-certificates libc6-compat tzdata
COPY --from=agent-builder /out/tunnel-agent /usr/local/bin/tunnel-agent
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
RUN mkdir -p /temp-tunnel
VOLUME ["/temp-tunnel"]
HEALTHCHECK --interval=60s --timeout=5s --retries=5 CMD wget -q -O- http://127.0.0.1:1984/health >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/tunnel-agent"]
