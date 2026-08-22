package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"agent-bff/internal/security"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

const downstreamService = "agent-platform"

// AgentPlatformProxy 代理到 Python FastAPI 后端
type AgentPlatformProxy struct {
	baseURL  string
	client  *http.Client
	logger  zerolog.Logger
	limiter *security.ServiceConcurrencyLimiter
}

// NewAgentPlatformProxy 创建代理实例
func NewAgentPlatformProxy(baseURL string, logger zerolog.Logger) *AgentPlatformProxy {
	return &AgentPlatformProxy{
		baseURL: baseURL,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		logger:  logger,
		limiter: security.NewServiceConcurrencyLimiter(),
	}
}

// Get 调用下游 GET 接口
func (p *AgentPlatformProxy) Get(ctx context.Context, path string, result interface{}) error {
	return p.doRequest(ctx, http.MethodGet, path, nil, result)
}

// Post 调用下游 POST 接口
func (p *AgentPlatformProxy) Post(ctx context.Context, path string, body interface{}, result interface{}) error {
	return p.doRequest(ctx, http.MethodPost, path, body, result)
}

// doRequest 执行 HTTP 请求
func (p *AgentPlatformProxy) doRequest(ctx context.Context, method, path string, body interface{}, result interface{}) error {
	// 1. SSRF 保护验证
	if err := security.ValidateSSRFTarget(downstreamService, p.baseURL, path); err != nil {
		p.logger.Warn().
			Err(err).
			Str("path", path).
			Msg("SSRF protection triggered")
		return err
	}

	// 2. 并发限制
	release, err := p.limiter.Acquire(downstreamService)
	if err != nil {
		p.logger.Warn().
			Err(err).
			Str("path", path).
			Msg("concurrency limit exceeded")
		return err
	}
	defer release()

	// 3. 执行请求
	return p.executeRequest(ctx, method, path, body, result)
}

// executeRequest 执行实际 HTTP 请求
func (p *AgentPlatformProxy) executeRequest(ctx context.Context, method, path string, body interface{}, result interface{}) error {
	url := p.baseURL + path

	var reqBody *bytes.Buffer
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request body failed: %w", err)
		}
		reqBody = bytes.NewBuffer(data)
	} else {
		reqBody = nil
	}

	req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
	if err != nil {
		return fmt.Errorf("create request failed: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	// 添加 trace header
	requestId := uuid.New().String()
	req.Header.Set("X-Request-ID", requestId)

	p.logger.Debug().
		Str("request_id", requestId).
		Str("method", method).
		Str("url", url).
		Msg("proxy request")

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("request to upstream failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("upstream returned status %d", resp.StatusCode)
	}

	if result != nil {
		if err := json.NewDecoder(resp.Body).Decode(result); err != nil {
			return fmt.Errorf("decode response failed: %w", err)
		}
	}

	return nil
}

// FetchDashboardStats 并行获取 Dashboard 所需的所有数据
// 符合 BFF 指南：独立下游并行调用，设置超时
func (p *AgentPlatformProxy) FetchDashboardStats(ctx context.Context) (*DashboardRawData, error) {
	// 创建带超时的 context
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	// 并行获取数据
	type fetchResult struct {
		data json.RawMessage
		err  error
		path string
	}

	// 需要并行获取的端点
	endpoints := []struct {
		path string
		ch   chan fetchResult
	}{
		{"/api/v1/agents", make(chan fetchResult, 1)},
		{"/api/v1/tasks", make(chan fetchResult, 1)},
		{"/api/v1/tools", make(chan fetchResult, 1)},
		{"/api/v1/stats", make(chan fetchResult, 1)},
	}

	// 启动所有 goroutine
	for _, ep := range endpoints {
		go func(epPath string, ch chan fetchResult) {
			var raw json.RawMessage
			err := p.Get(ctx, epPath, &raw)
			ch <- fetchResult{data: raw, err: err, path: epPath}
		}(ep.path, ep.ch)
	}

	// 收集结果
	raw := &DashboardRawData{}
	hasError := false

	for _, ep := range endpoints {
		result := <-ep.ch
		if result.err != nil {
			p.logger.Error().
				Err(result.err).
				Str("path", result.path).
				Msg("failed to fetch dashboard data")
			hasError = true
			// 继续收集其他结果，不立即返回
		} else {
			switch result.path {
			case "/api/v1/agents":
				raw.Agents = result.data
			case "/api/v1/tasks":
				raw.Tasks = result.data
			case "/api/v1/tools":
				raw.Tools = result.data
			case "/api/v1/stats":
				raw.Stats = result.data
			}
		}
	}

	if hasError && raw.Agents == nil && raw.Tasks == nil {
		return nil, fmt.Errorf("failed to fetch dashboard data")
	}

	return raw, nil
}

// DashboardRawData 原始数据容器
type DashboardRawData struct {
	Agents json.RawMessage `json:"agents"`
	Tasks  json.RawMessage `json:"tasks"`
	Tools  json.RawMessage `json:"tools"`
	Stats  json.RawMessage `json:"stats"`
}

// GetStats 返回并发统计
func (p *AgentPlatformProxy) GetStats() map[string]security.ConcurrencyStats {
	return p.limiter.Stats()
}
