package metrics

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics 收集器
type Metrics struct {
	httpRequestsTotal   *prometheus.CounterVec
	httpRequestDuration *prometheus.HistogramVec
	downstreamCalls    *prometheus.CounterVec
	downstreamDuration  *prometheus.HistogramVec
}

// NewMetrics 创建指标收集器
func NewMetrics(namespace string) *Metrics {
	return &Metrics{
		httpRequestsTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Namespace: namespace,
				Name:      "http_requests_total",
				Help:      "Total number of HTTP requests",
			},
			[]string{"method", "path", "status"},
		),
		httpRequestDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Namespace: namespace,
				Name:      "http_request_duration_seconds",
				Help:      "HTTP request duration in seconds",
				Buckets:   []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
			},
			[]string{"method", "path"},
		),
		downstreamCalls: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Namespace: namespace,
				Name:      "downstream_calls_total",
				Help:      "Total number of downstream service calls",
			},
			[]string{"service", "path", "status"},
		),
		downstreamDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Namespace: namespace,
				Name:      "downstream_call_duration_seconds",
				Help:      "Downstream call duration in seconds",
				Buckets:   []float64{.01, .025, .05, .1, .25, .5, 1, 2.5, 5},
			},
			[]string{"service", "path"},
		),
	}
}

// Register 注册指标到 Prometheus
func (m *Metrics) Register() {
	prometheus.MustRegister(m.httpRequestsTotal)
	prometheus.MustRegister(m.httpRequestDuration)
	prometheus.MustRegister(m.downstreamCalls)
	prometheus.MustRegister(m.downstreamDuration)
}

// RecordHTTPRequest 记录 HTTP 请求
func (m *Metrics) RecordHTTPRequest(method, path string, status int, duration time.Duration) {
	m.httpRequestsTotal.WithLabelValues(method, path, strconv.Itoa(status)).Inc()
	m.httpRequestDuration.WithLabelValues(method, path).Observe(duration.Seconds())
}

// RecordDownstreamCall 记录下游调用
func (m *Metrics) RecordDownstreamCall(service, path, status string, duration time.Duration) {
	m.downstreamCalls.WithLabelValues(service, path, status).Inc()
	m.downstreamDuration.WithLabelValues(service, path).Observe(duration.Seconds())
}

// Middleware 返回 Gin 中间件
func (m *Metrics) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.FullPath()
		if path == "" {
			path = "unknown"
		}
		method := c.Request.Method

		c.Next()

		duration := time.Since(start)
		status := c.Writer.Status()
		m.RecordHTTPRequest(method, path, status, duration)
	}
}

// Handler 返回 Prometheus 指标端点
func Handler() gin.HandlerFunc {
	h := promhttp.Handler()
	return func(c *gin.Context) {
		h.ServeHTTP(c.Writer, c.Request)
	}
}
