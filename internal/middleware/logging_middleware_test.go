package middleware

import "testing"

func TestRedactQuery(t *testing.T) {
	redacted := redactQuery("token=secret-token&platform=ios")
	expected := "platform=ios&token=REDACTED"
	if redacted != expected {
		t.Fatalf("expected %q, got %q", expected, redacted)
	}
}
