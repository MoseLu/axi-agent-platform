package security

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// ----------------------------------------------------------------------
// Concurrency Control: Semaphore-based request limiting
// ----------------------------------------------------------------------

// ConcurrencyLimitError is returned when the concurrent request limit is exceeded.
type ConcurrencyLimitError struct {
	ServiceName    string
	CurrentCount   int
	Limit          int
	RetryAfterSecs float64
}

func (e *ConcurrencyLimitError) Error() string {
	return fmt.Sprintf("concurrency limit exceeded for service %q: %d/%d", e.ServiceName, e.CurrentCount, e.Limit)
}

// ServiceConcurrencyLimiter manages per-service concurrency limits using semaphores.
type ServiceConcurrencyLimiter struct {
	services map[string]*serviceLimiter
	mu       sync.RWMutex
	defaults map[string]int
}

type serviceLimiter struct {
	sem     chan struct{}
	mu      sync.Mutex
	current int
	peak    int
}

// NewServiceConcurrencyLimiter creates a new concurrency limiter with default limits.
func NewServiceConcurrencyLimiter() *ServiceConcurrencyLimiter {
	return &ServiceConcurrencyLimiter{
		services: make(map[string]*serviceLimiter),
		defaults: map[string]int{
			"agent-platform": 50,
		},
	}
}

// getOrCreate gets or creates a limiter for a service.
func (s *ServiceConcurrencyLimiter) getOrCreate(serviceName string) *serviceLimiter {
	s.mu.Lock()
	defer s.mu.Unlock()

	if limiter, ok := s.services[serviceName]; ok {
		return limiter
	}

	limit := 50
	if defaultLimit, ok := s.defaults[serviceName]; ok {
		limit = defaultLimit
	}

	limiter := &serviceLimiter{
		sem: make(chan struct{}, limit),
	}
	s.services[serviceName] = limiter
	return limiter
}

// Acquire attempts to acquire a concurrency slot for the given service.
func (s *ServiceConcurrencyLimiter) Acquire(serviceName string) (release func(), err error) {
	limiter := s.getOrCreate(serviceName)

	select {
	case limiter.sem <- struct{}{}:
		limiter.mu.Lock()
		limiter.current++
		if limiter.current > limiter.peak {
			limiter.peak = limiter.current
		}
		limiter.mu.Unlock()

		return func() {
			s.Release(serviceName)
		}, nil
	default:
		limiter.mu.Lock()
		current := limiter.current
		limit := cap(limiter.sem)
		limiter.mu.Unlock()

		return nil, &ConcurrencyLimitError{
			ServiceName:    serviceName,
			CurrentCount:   current,
			Limit:          limit,
			RetryAfterSecs: 1.0,
		}
	}
}

// Release releases a concurrency slot for the given service.
func (s *ServiceConcurrencyLimiter) Release(serviceName string) {
	s.mu.RLock()
	limiter, ok := s.services[serviceName]
	s.mu.RUnlock()

	if !ok {
		return
	}

	<-limiter.sem

	limiter.mu.Lock()
	limiter.current--
	limiter.mu.Unlock()
}

// Stats returns current concurrency stats for all services.
func (s *ServiceConcurrencyLimiter) Stats() map[string]ConcurrencyStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	stats := make(map[string]ConcurrencyStats)
	for name, limiter := range s.services {
		limiter.mu.Lock()
		stats[name] = ConcurrencyStats{
			Current:   limiter.current,
			Peak:      limiter.peak,
			Limit:     cap(limiter.sem),
			Available: cap(limiter.sem) - limiter.current,
		}
		limiter.mu.Unlock()
	}
	return stats
}

// ConcurrencyStats holds concurrency metrics for a service.
type ConcurrencyStats struct {
	Current   int
	Peak      int
	Limit     int
	Available int
}

// ----------------------------------------------------------------------
// Timeout Control: deadline management
// ----------------------------------------------------------------------

// DefaultDeadlines provides recommended timeout settings.
var DefaultDeadlines = map[string]time.Duration{
	"agent-platform": 10 * time.Second,
}

// WithDeadline wraps a function with a deadline.
func WithDeadline(ctx context.Context, serviceName string, fn func(ctx context.Context) error) error {
	deadline := DefaultDeadlines[serviceName]
	if deadline == 0 {
		deadline = 10 * time.Second
	}

	deadlineCtx, cancel := context.WithTimeout(ctx, deadline)
	defer cancel()

	return fn(deadlineCtx)
}
