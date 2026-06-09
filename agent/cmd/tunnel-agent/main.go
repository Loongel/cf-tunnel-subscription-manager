package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/linc/cf-tunnel-manager/agent/internal/client"
	"github.com/linc/cf-tunnel-manager/agent/internal/config"
	"github.com/linc/cf-tunnel-manager/agent/internal/manager"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	cfg, err := config.FromEnv()
	if err != nil {
		log.Fatalf("configuration error: %v", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	c := client.New(cfg.WorkerBaseURL, cfg.AgentToken)
	m := manager.New(cfg, c)
	if err := m.Run(ctx); err != nil {
		log.Fatalf("agent stopped: %v", err)
	}
}
