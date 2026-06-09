package config

import (
	"reflect"
	"testing"
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
