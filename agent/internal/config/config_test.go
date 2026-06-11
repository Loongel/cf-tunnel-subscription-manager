package config

import (
	"reflect"
	"testing"
	"time"
)

func TestSplitTargets(t *testing.T) {
	got := SplitTargets(`"http://s1:2095,http://s2:2096 http://s1:2095"`)
	want := []string{"http://s1:2095", "http://s2:2096"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("SplitTargets() = %#v, want %#v", got, want)
	}
}

func TestSafeKey(t *testing.T) {
	got := SafeKey("http://s1:2095")
	if got != "http_s1_2095" {
		t.Fatalf("SafeKey() = %q", got)
	}
}

func TestDefaultIntervalsAreRequestConservative(t *testing.T) {
	t.Setenv("WORKER_BASE_URL", "https://worker.example.com")
	t.Setenv("AGENT_TOKEN", "agent")
	t.Setenv("QUICK_TUNNELS", "http://s1:80")

	cfg, err := FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HeartbeatInterval != 2*time.Minute {
		t.Fatalf("HeartbeatInterval = %s", cfg.HeartbeatInterval)
	}
	if cfg.CommandPollInterval != 2*time.Minute {
		t.Fatalf("CommandPollInterval = %s", cfg.CommandPollInterval)
	}
}
