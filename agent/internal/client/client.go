package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

type AgentRegistration struct {
	AgentID            string         `json:"agentId"`
	InstanceID         string         `json:"instanceId,omitempty"`
	Hostname           string         `json:"hostname,omitempty"`
	SwarmNodeName      string         `json:"swarmNodeName,omitempty"`
	StackName          string         `json:"stackName,omitempty"`
	ServiceName        string         `json:"serviceName,omitempty"`
	ImageVersion       string         `json:"imageVersion,omitempty"`
	CloudflaredVersion string         `json:"cloudflaredVersion,omitempty"`
	Capabilities       map[string]any `json:"capabilities,omitempty"`
}

type TunnelStatus struct {
	TunnelKey      string `json:"tunnelKey"`
	Type           string `json:"type"`
	TargetURL      string `json:"targetUrl,omitempty"`
	PublicURL      string `json:"publicUrl,omitempty"`
	PublicHostname string `json:"publicHostname,omitempty"`
	MetricsPort    int    `json:"metricsPort,omitempty"`
	Status         string `json:"status,omitempty"`
	ProcessStatus  string `json:"processStatus,omitempty"`
	HealthStatus   string `json:"healthStatus,omitempty"`
	LastError      string `json:"lastError,omitempty"`
	RestartCount   int    `json:"restartCount,omitempty"`
	StartedAt      string `json:"startedAt,omitempty"`
	LastSeenAt     string `json:"lastSeenAt,omitempty"`
}

type Heartbeat struct {
	AgentRegistration
	Tunnels []TunnelStatus `json:"tunnels"`
}

type Command struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`
	TunnelID  string         `json:"tunnelId,omitempty"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt string         `json:"createdAt,omitempty"`
}

type commandsResponse struct {
	Commands []Command `json:"commands"`
}

func New(baseURL, token string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: 12 * time.Second},
	}
}

func (c *Client) Register(ctx context.Context, body AgentRegistration) error {
	return c.do(ctx, http.MethodPost, "/api/agent/register", body, nil)
}

func (c *Client) Heartbeat(ctx context.Context, body Heartbeat) error {
	return c.do(ctx, http.MethodPost, "/api/agent/heartbeat", body, nil)
}

func (c *Client) Event(ctx context.Context, body map[string]any) error {
	return c.do(ctx, http.MethodPost, "/api/agent/events", body, nil)
}

func (c *Client) Commands(ctx context.Context, agentID, instanceID string) ([]Command, error) {
	var result commandsResponse
	path := fmt.Sprintf("/api/agent/commands?agentId=%s&instanceId=%s", url.QueryEscape(agentID), url.QueryEscape(instanceID))
	if err := c.do(ctx, http.MethodGet, path, nil, &result); err != nil {
		return nil, err
	}
	return result.Commands, nil
}

func (c *Client) Ack(ctx context.Context, commandID, status string, result map[string]any) error {
	body := map[string]any{"status": status, "result": result}
	return c.do(ctx, http.MethodPost, "/api/agent/commands/"+commandID+"/ack", body, nil)
}

func (c *Client) do(ctx context.Context, method, path string, in any, out any) error {
	var reader io.Reader
	if in != nil {
		data, err := json.Marshal(in)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("%s %s failed: %s %s", method, path, resp.Status, strings.TrimSpace(string(body)))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}
