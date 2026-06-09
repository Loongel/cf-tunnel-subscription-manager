package config

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	TunnelToken          string
	QuickTunnels         []string
	FixedMetricsPortBase int
	QuickMetricsPortBase int
	LogFile              string
	MapFile              string
	StatusDir            string
	WorkerBaseURL        string
	AgentToken           string
	AgentID              string
	InstanceID           string
	Hostname             string
	SwarmNodeName        string
	StackName            string
	ServiceName          string
	ImageVersion         string
	HeartbeatInterval    time.Duration
	CommandPollInterval  time.Duration
	RestartCooldown      time.Duration
	CloudflaredPath      string
	HealthAddr           string
	FixedEdgeIPVersion   string
	QuickStartSpacing    time.Duration
}

func FromEnv() (Config, error) {
	hostname, _ := os.Hostname()
	cfg := Config{
		TunnelToken:          os.Getenv("TUNNEL_TOKEN"),
		QuickTunnels:         SplitTargets(os.Getenv("QUICK_TUNNELS")),
		FixedMetricsPortBase: intEnv("FIXED_METRICS_PORT_BASE", 2000),
		QuickMetricsPortBase: intEnv("QUICK_METRICS_PORT_BASE", 2100),
		LogFile:              stringEnv("LOG_FILE", "/temp-tunnel/history.log"),
		MapFile:              stringEnv("MAP_FILE", "/temp-tunnel/tunnels.list"),
		WorkerBaseURL:        strings.TrimRight(os.Getenv("WORKER_BASE_URL"), "/"),
		AgentToken:           os.Getenv("AGENT_TOKEN"),
		Hostname:             stringEnv("HOSTNAME", hostname),
		SwarmNodeName:        os.Getenv("SWARM_NODE_NAME"),
		StackName:            os.Getenv("STACK_NAME"),
		ServiceName:          stringEnv("SERVICE_NAME", "cloudflared"),
		ImageVersion:         stringEnv("IMAGE_VERSION", "cf-tunnel-agent:0.1.0"),
		HeartbeatInterval:    durationEnv("HEARTBEAT_INTERVAL", 30*time.Second),
		CommandPollInterval:  durationEnv("COMMAND_POLL_INTERVAL", 20*time.Second),
		RestartCooldown:      durationEnv("RESTART_COOLDOWN_SECONDS", 610*time.Second),
		CloudflaredPath:      stringEnv("CLOUDFLARED_PATH", "/usr/local/bin/cloudflared"),
		HealthAddr:           stringEnv("HEALTH_ADDR", "127.0.0.1:1984"),
		FixedEdgeIPVersion:   stringEnv("EDGE_IP_VERSION", "6"),
		QuickStartSpacing:    durationEnv("QUICK_START_SPACING", 20*time.Second),
	}
	cfg.StatusDir = statusDirFromMap(cfg.MapFile)
	cfg.InstanceID = newInstanceID()
	cfg.AgentID = os.Getenv("AGENT_ID")
	if cfg.AgentID == "" {
		cfg.AgentID = deriveAgentID(cfg)
	}
	if cfg.WorkerBaseURL == "" {
		return cfg, errors.New("WORKER_BASE_URL is required")
	}
	if cfg.AgentToken == "" {
		return cfg, errors.New("AGENT_TOKEN is required")
	}
	if cfg.TunnelToken == "" && len(cfg.QuickTunnels) == 0 {
		return cfg, errors.New("no tunnels configured: set TUNNEL_TOKEN or QUICK_TUNNELS")
	}
	return cfg, nil
}

func SplitTargets(input string) []string {
	trimmed := strings.TrimSpace(input)
	trimmed = strings.Trim(trimmed, `"'`)
	trimmed = strings.ReplaceAll(trimmed, ",", " ")
	fields := strings.Fields(trimmed)
	out := make([]string, 0, len(fields))
	seen := map[string]struct{}{}
	for _, field := range fields {
		if _, ok := seen[field]; ok {
			continue
		}
		seen[field] = struct{}{}
		out = append(out, field)
	}
	return out
}

func SafeKey(input string) string {
	var b strings.Builder
	lastUnderscore := false
	for _, r := range input {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			b.WriteByte('_')
			lastUnderscore = true
		}
	}
	result := strings.Trim(b.String(), "_")
	if result == "" {
		return "target"
	}
	return result
}

func intEnv(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func stringEnv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	if parsed, err := time.ParseDuration(value); err == nil {
		return parsed
	}
	if seconds, err := strconv.Atoi(value); err == nil {
		return time.Duration(seconds) * time.Second
	}
	return fallback
}

func deriveAgentID(cfg Config) string {
	parts := []string{cfg.SwarmNodeName, cfg.StackName, cfg.ServiceName, cfg.Hostname}
	joined := strings.Join(parts, "-")
	return SafeKey(joined)
}

func statusDirFromMap(mapFile string) string {
	idx := strings.LastIndex(mapFile, "/")
	if idx < 0 {
		return ".status_cache"
	}
	return mapFile[:idx] + "/.status_cache"
}

func newInstanceID() string {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return fmt.Sprintf("instance-%d", time.Now().UnixNano())
	}
	return "instance-" + hex.EncodeToString(buf[:])
}
