package manager

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/linc/cf-tunnel-manager/agent/internal/client"
	"github.com/linc/cf-tunnel-manager/agent/internal/config"
)

var quickURLPattern = regexp.MustCompile(`https://[-a-z0-9]+\.trycloudflare\.com`)

type Manager struct {
	cfg      config.Config
	client   *client.Client
	fixed    *fixedTunnel
	quick    map[string]*quickTunnel
	quickIDs map[string]*quickTunnel
	mapMu    sync.Mutex
}

func New(cfg config.Config, c *client.Client) *Manager {
	return &Manager{
		cfg:      cfg,
		client:   c,
		quick:    map[string]*quickTunnel{},
		quickIDs: map[string]*quickTunnel{},
	}
}

func (m *Manager) Run(ctx context.Context) error {
	if err := os.MkdirAll(m.cfg.StatusDir, 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(m.cfg.LogFile), 0o755); err != nil {
		return err
	}
	_ = os.RemoveAll(m.cfg.StatusDir)
	if err := os.MkdirAll(m.cfg.StatusDir, 0o755); err != nil {
		return err
	}
	_ = os.Remove(m.cfg.MapFile)
	m.appendLog(fmt.Sprintf("--- Session Start (%s) ---", time.Now().Format(time.RFC3339)))

	registration := m.registration()
	if err := m.client.Register(ctx, registration); err != nil {
		log.Printf("[agent] register failed: %v", err)
	}

	var wg sync.WaitGroup
	if m.cfg.TunnelToken != "" {
		m.fixed = &fixedTunnel{cfg: m.cfg}
		wg.Add(1)
		go func() {
			defer wg.Done()
			m.fixed.run(ctx)
		}()
	}

	for idx, target := range m.cfg.QuickTunnels {
		tunnel := newQuickTunnel(m.cfg, m.client, target, m.cfg.QuickMetricsPortBase+idx+1, m)
		m.quick[tunnel.key] = tunnel
		m.quickIDs[tunnel.tunnelID()] = tunnel
		wg.Add(1)
		go func(delay time.Duration, t *quickTunnel) {
			defer wg.Done()
			select {
			case <-ctx.Done():
				return
			case <-time.After(delay):
			}
			t.run(ctx)
		}(time.Duration(idx)*m.cfg.QuickStartSpacing, tunnel)
	}

	wg.Add(3)
	go func() {
		defer wg.Done()
		m.heartbeatLoop(ctx)
	}()
	go func() {
		defer wg.Done()
		m.commandLoop(ctx)
	}()
	go func() {
		defer wg.Done()
		m.healthServer(ctx)
	}()

	<-ctx.Done()
	wg.Wait()
	return nil
}

func (m *Manager) registration() client.AgentRegistration {
	return client.AgentRegistration{
		AgentID:            m.cfg.AgentID,
		InstanceID:         m.cfg.InstanceID,
		Hostname:           m.cfg.Hostname,
		SwarmNodeName:      m.cfg.SwarmNodeName,
		StackName:          m.cfg.StackName,
		ServiceName:        m.cfg.ServiceName,
		ImageVersion:       m.cfg.ImageVersion,
		CloudflaredVersion: cloudflaredVersion(m.cfg.CloudflaredPath),
		Capabilities: map[string]any{
			"fixedTunnel":    m.cfg.TunnelToken != "",
			"quickTunnel":    len(m.cfg.QuickTunnels) > 0,
			"commandPolling": true,
		},
	}
}

func (m *Manager) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(m.cfg.HeartbeatInterval)
	defer ticker.Stop()
	m.sendHeartbeat(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.sendHeartbeat(ctx)
		}
	}
}

func (m *Manager) sendHeartbeat(ctx context.Context) {
	body := client.Heartbeat{AgentRegistration: m.registration()}
	if m.fixed != nil {
		body.Tunnels = append(body.Tunnels, m.fixed.status())
	}
	keys := make([]string, 0, len(m.quick))
	for key := range m.quick {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		body.Tunnels = append(body.Tunnels, m.quick[key].status())
	}
	if err := m.client.Heartbeat(ctx, body); err != nil {
		log.Printf("[agent] heartbeat failed: %v", err)
	}
}

func (m *Manager) commandLoop(ctx context.Context) {
	ticker := time.NewTicker(m.cfg.CommandPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.pollCommands(ctx)
		}
	}
}

func (m *Manager) pollCommands(ctx context.Context) {
	commands, err := m.client.Commands(ctx, m.cfg.AgentID, m.cfg.InstanceID)
	if err != nil {
		log.Printf("[agent] command poll failed: %v", err)
		return
	}
	for _, cmd := range commands {
		status := "succeeded"
		result := map[string]any{"message": "ok"}
		if err := m.executeCommand(cmd); err != nil {
			status = "failed"
			result = map[string]any{"error": err.Error()}
		}
		if err := m.client.Ack(ctx, cmd.ID, status, result); err != nil {
			log.Printf("[agent] command ack failed: %v", err)
		}
	}
}

func (m *Manager) executeCommand(cmd client.Command) error {
	switch cmd.Type {
	case "restart_tunnel":
		return m.restartTunnel(cmd)
	case "refresh_status":
		m.sendHeartbeat(context.Background())
		return nil
	default:
		return fmt.Errorf("unsupported command type %q", cmd.Type)
	}
}

func (m *Manager) restartTunnel(cmd client.Command) error {
	if cmd.TunnelID != "" {
		if tunnel := m.quickIDs[cmd.TunnelID]; tunnel != nil {
			tunnel.restart("worker command")
			return nil
		}
	}
	if key, ok := cmd.Payload["tunnelKey"].(string); ok {
		if tunnel := m.quick[key]; tunnel != nil {
			tunnel.restart("worker command")
			return nil
		}
	}
	if target, ok := cmd.Payload["targetUrl"].(string); ok {
		key := config.SafeKey(target)
		if tunnel := m.quick[key]; tunnel != nil {
			tunnel.restart("worker command")
			return nil
		}
	}
	return errors.New("matching quick tunnel not found")
}

func (m *Manager) refreshMapFile() {
	m.mapMu.Lock()
	defer m.mapMu.Unlock()
	entries, err := os.ReadDir(m.cfg.StatusDir)
	if err != nil {
		_ = os.WriteFile(m.cfg.MapFile, nil, 0o644)
		return
	}
	var lines []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(m.cfg.StatusDir, entry.Name()))
		if err == nil && len(data) > 0 {
			lines = append(lines, strings.TrimSpace(string(data)))
		}
	}
	sort.Strings(lines)
	content := strings.Join(lines, "\n")
	if content != "" {
		content += "\n"
	}
	_ = os.WriteFile(m.cfg.MapFile, []byte(content), 0o644)
}

func (m *Manager) appendLog(line string) {
	file, err := os.OpenFile(m.cfg.LogFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		log.Printf("[agent] open log failed: %v", err)
		return
	}
	defer file.Close()
	_, _ = fmt.Fprintln(file, line)
}

func (m *Manager) healthServer(ctx context.Context) {
	listener, err := net.Listen("tcp", m.cfg.HealthAddr)
	if err != nil {
		log.Printf("[agent] health server disabled: %v", err)
		return
	}
	server := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("content-type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
		}),
		ReadHeaderTimeout: 3 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("[agent] health server failed: %v", err)
	}
}

type fixedTunnel struct {
	cfg          config.Config
	restartCount int
	lastError    string
	startedAt    string
	statusValue  string
	mu           sync.Mutex
}

func (f *fixedTunnel) run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		f.setStatus("running", "", time.Now())
		args := []string{
			"tunnel", "--edge-ip-version", f.cfg.FixedEdgeIPVersion, "--no-autoupdate",
			"--metrics", fmt.Sprintf("127.0.0.1:%d", f.cfg.FixedMetricsPortBase),
			"run", "--token", f.cfg.TunnelToken,
		}
		log.Printf("[fixed] starting token tunnel")
		cmd := exec.CommandContext(ctx, f.cfg.CloudflaredPath, args...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		err := cmd.Run()
		if ctx.Err() != nil {
			return
		}
		f.mu.Lock()
		f.restartCount++
		f.lastError = fmt.Sprint(err)
		f.statusValue = "error"
		f.mu.Unlock()
		log.Printf("[fixed] crashed: %v; restarting in 10s", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Second):
		}
	}
}

func (f *fixedTunnel) setStatus(status, lastError string, startedAt time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.statusValue = status
	f.lastError = lastError
	f.startedAt = startedAt.Format(time.RFC3339)
}

func (f *fixedTunnel) status() client.TunnelStatus {
	f.mu.Lock()
	defer f.mu.Unlock()
	return client.TunnelStatus{
		TunnelKey:     "fixed_token_tunnel",
		Type:          "fixed",
		MetricsPort:   f.cfg.FixedMetricsPortBase,
		ProcessStatus: f.statusValue,
		HealthStatus:  "unknown",
		LastError:     f.lastError,
		RestartCount:  f.restartCount,
		StartedAt:     f.startedAt,
		LastSeenAt:    time.Now().Format(time.RFC3339),
	}
}

type quickTunnel struct {
	cfg         config.Config
	client      *client.Client
	manager     *Manager
	target      string
	key         string
	metricsPort int
	statusFile  string

	mu           sync.Mutex
	cmd          *exec.Cmd
	publicURL    string
	publicHost   string
	processState string
	healthState  string
	lastError    string
	restartCount int
	startedAt    string
	forceRestart bool
	restartCh    chan struct{}
}

func newQuickTunnel(cfg config.Config, c *client.Client, target string, metricsPort int, m *Manager) *quickTunnel {
	key := config.SafeKey(target)
	return &quickTunnel{
		cfg:          cfg,
		client:       c,
		manager:      m,
		target:       target,
		key:          key,
		metricsPort:  metricsPort,
		statusFile:   filepath.Join(cfg.StatusDir, key),
		processState: "starting",
		healthState:  "unknown",
		restartCh:    make(chan struct{}, 1),
	}
}

func (q *quickTunnel) tunnelID() string {
	safe := config.SafeKey(q.cfg.AgentID + "_" + q.key)
	if len(safe) > 96 {
		safe = safe[:96]
	}
	return "tun_" + safe
}

func (q *quickTunnel) run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		_ = q.consumeForceRestart()
		err := q.runOnce(ctx)
		if ctx.Err() != nil {
			return
		}
		forced := q.consumeForceRestart()
		q.mu.Lock()
		if err != nil {
			q.lastError = err.Error()
		}
		q.processState = "error"
		q.healthState = "unhealthy"
		q.restartCount++
		q.mu.Unlock()
		_ = os.Remove(q.statusFile)
		q.manager.refreshMapFile()
		log.Printf("[quick] %s died: %v", q.target, err)
		delay := q.cfg.RestartCooldown
		if forced {
			delay = 2 * time.Second
		}
		log.Printf("[quick] %s restarting in %s", q.target, delay)
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		case <-q.restartCh:
		}
	}
}

func (q *quickTunnel) runOnce(ctx context.Context) error {
	args := []string{
		"tunnel", "--edge-ip-version", q.cfg.FixedEdgeIPVersion, "--no-autoupdate",
		"--metrics", fmt.Sprintf("127.0.0.1:%d", q.metricsPort),
		"--url", q.target,
	}
	cmd := exec.CommandContext(ctx, q.cfg.CloudflaredPath, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	q.mu.Lock()
	q.cmd = cmd
	q.processState = "starting"
	q.healthState = "unknown"
	q.startedAt = time.Now().Format(time.RFC3339)
	q.lastError = ""
	q.mu.Unlock()
	log.Printf("[quick] starting %s on metrics port %d", q.target, q.metricsPort)
	if err := cmd.Start(); err != nil {
		return err
	}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		q.scanOutput(stdout)
	}()
	go func() {
		defer wg.Done()
		q.scanOutput(stderr)
	}()
	err = cmd.Wait()
	wg.Wait()
	q.mu.Lock()
	q.cmd = nil
	q.mu.Unlock()
	return err
}

func (q *quickTunnel) scanOutput(reader io.Reader) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()
		fmt.Fprintln(os.Stderr, line)
		if match := quickURLPattern.FindString(line); match != "" {
			q.setPublicURL(match)
		}
	}
}

func (q *quickTunnel) setPublicURL(publicURL string) {
	parsed, _ := url.Parse(publicURL)
	host := parsed.Hostname()
	q.mu.Lock()
	changed := q.publicURL != publicURL
	q.publicURL = publicURL
	q.publicHost = host
	q.processState = "running"
	q.healthState = "healthy"
	q.mu.Unlock()
	content := fmt.Sprintf("%s %s\n", q.target, publicURL)
	_ = os.WriteFile(q.statusFile, []byte(content), 0o644)
	q.manager.refreshMapFile()
	if changed {
		line := fmt.Sprintf("%s | Target: %s | URL: %s", time.Now().Format(time.RFC3339), q.target, publicURL)
		q.manager.appendLog(line)
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			_ = q.client.Event(ctx, map[string]any{
				"agentId":   q.cfg.AgentID,
				"eventType": "quick_url_changed",
				"severity":  "info",
				"message":   line,
				"targetUrl": q.target,
				"publicUrl": publicURL,
			})
		}()
	}
	log.Printf("[quick] updated %s -> %s", q.target, publicURL)
}

func (q *quickTunnel) restart(reason string) {
	q.mu.Lock()
	q.forceRestart = true
	cmd := q.cmd
	q.processState = "restarting"
	q.lastError = reason
	q.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	select {
	case q.restartCh <- struct{}{}:
	default:
	}
}

func (q *quickTunnel) consumeForceRestart() bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	value := q.forceRestart
	q.forceRestart = false
	return value
}

func (q *quickTunnel) status() client.TunnelStatus {
	q.mu.Lock()
	defer q.mu.Unlock()
	return client.TunnelStatus{
		TunnelKey:      q.key,
		Type:           "quick",
		TargetURL:      q.target,
		PublicURL:      q.publicURL,
		PublicHostname: q.publicHost,
		MetricsPort:    q.metricsPort,
		ProcessStatus:  q.processState,
		HealthStatus:   q.healthState,
		LastError:      q.lastError,
		RestartCount:   q.restartCount,
		StartedAt:      q.startedAt,
		LastSeenAt:     time.Now().Format(time.RFC3339),
	}
}

func cloudflaredVersion(path string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, path, "--version").CombinedOutput()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
