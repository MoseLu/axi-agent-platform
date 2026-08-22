package security

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// ----------------------------------------------------------------------
// SSRF Protection: explicit allowlist per downstream service
// ----------------------------------------------------------------------

// allowedServiceTargets maps each downstream service name to its permitted
// host:port combinations and path prefixes.
var allowedServiceTargets = map[string]struct {
	hosts []string
	paths []string
}{
	"agent-platform": {
		hosts: []string{"localhost:8000", "127.0.0.1:8000"},
		paths: []string{"/api/v1"},
	},
}

// SSRFProtectionError is returned when a request target fails validation.
type SSRFProtectionError struct {
	ServiceName string
	Target      string
	Reason      string
}

func (e *SSRFProtectionError) Error() string {
	return fmt.Sprintf("SSRF protection: service=%q target=%q reason=%s", e.ServiceName, e.Target, e.Reason)
}

// ValidateSSRFTarget checks whether (host, port, path) is allowed for the named service.
func ValidateSSRFTarget(serviceName, targetURL, requestPath string) error {
	entry, ok := allowedServiceTargets[serviceName]
	if !ok {
		return &SSRFProtectionError{
			ServiceName: serviceName,
			Target:      targetURL,
			Reason:      "no allowlist entry",
		}
	}

	parsed, err := url.Parse(targetURL)
	if err != nil {
		return &SSRFProtectionError{
			ServiceName: serviceName,
			Target:      targetURL,
			Reason:      fmt.Sprintf("invalid URL: %v", err),
		}
	}

	host := parsed.Hostname()
	port := parsed.Port()
	if port == "" {
		port = "80"
	}
	targetHostPort := fmt.Sprintf("%s:%s", host, port)

	// Check if the host:port is in the allowlist
	hostAllowed := false
	for _, allowed := range entry.hosts {
		if allowed == targetHostPort {
			hostAllowed = true
			break
		}
	}
	if !hostAllowed {
		return &SSRFProtectionError{
			ServiceName: serviceName,
			Target:      targetHostPort,
			Reason:      "host not in allowlist",
		}
	}

	// Check if the path is allowed
	pathAllowed := false
	for _, allowedPrefix := range entry.paths {
		if strings.HasPrefix(requestPath, allowedPrefix) {
			pathAllowed = true
			break
		}
	}
	if !pathAllowed {
		return &SSRFProtectionError{
			ServiceName: serviceName,
			Target:      fmt.Sprintf("%s%s", targetURL, requestPath),
			Reason:      "path not in allowlist",
		}
	}

	return nil
}

// IsSSRFError checks if an error is an SSRF protection error.
func IsSSRFError(err error) bool {
	_, ok := err.(*SSRFProtectionError)
	return ok
}

// ----------------------------------------------------------------------
// Response Field Scrubbing: filter sensitive internal fields
// ----------------------------------------------------------------------

// sensitiveFieldPrefixes lists JSON key prefixes that indicate internal or
// sensitive fields.
var sensitiveFieldPrefixes = []string{
	"_internal",
	"internal_",
	"admin_",
	"password",
	"secret",
	"token",
	"credential",
	"private_key",
	"api_key",
	"ssn",
	"credit_card",
}

// ScrubJSON removes fields whose keys start with any sensitive prefix.
func ScrubJSON(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return data, nil
	}

	var raw json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return data, nil
	}

	scrubbed := scrubValue(raw)
	return json.Marshal(scrubbed)
}

func scrubValue(v json.RawMessage) json.RawMessage {
	// Try to parse as a map
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(v, &obj); err != nil {
		// Try to parse as an array
		var arr []json.RawMessage
		if err := json.Unmarshal(v, &arr); err != nil {
			return v
		}
		var result []json.RawMessage
		for _, item := range arr {
			result = append(result, scrubValue(item))
		}
		out, _ := json.Marshal(result)
		return out
	}

	result := make(map[string]json.RawMessage)
	for k, val := range obj {
		if IsSensitiveField(k) {
			result[k] = json.RawMessage(`"[scrubbed]"`)
		} else {
			result[k] = scrubValue(val)
		}
	}
	out, _ := json.Marshal(result)
	return out
}

// IsSensitiveField checks if a field name indicates sensitive data.
func IsSensitiveField(key string) bool {
	lower := strings.ToLower(key)
	for _, prefix := range sensitiveFieldPrefixes {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return false
}
