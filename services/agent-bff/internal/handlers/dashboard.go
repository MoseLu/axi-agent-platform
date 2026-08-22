package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"agent-bff/internal/dto"
	"agent-bff/internal/proxy"
	"agent-bff/internal/security"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
)

// DashboardHandler 处理 Dashboard 相关请求
type DashboardHandler struct {
	proxy *proxy.AgentPlatformProxy
	log   zerolog.Logger
}

// NewDashboardHandler 创建 Dashboard 处理器
func NewDashboardHandler(proxy *proxy.AgentPlatformProxy, log zerolog.Logger) *DashboardHandler {
	return &DashboardHandler{
		proxy: proxy,
		log:   log,
	}
}

// GetDashboardStats 获取 Dashboard 聚合统计数据
// 符合 BFF 指南：单一聚合端点，替代前端 4 个并行调用
func (h *DashboardHandler) GetDashboardStats(c *gin.Context) {
	requestId, _ := c.Get("request_id")
	requestIdStr := requestId.(string)

	ctx := c.Request.Context()

	// 调用下游获取原始数据
	raw, err := h.proxy.FetchDashboardStats(ctx)
	if err != nil {
		// 处理安全相关错误
		if security.IsSSRFError(err) {
			h.log.Warn().
				Err(err).
				Str("request_id", requestIdStr).
				Msg("SSRF protection triggered")
			c.JSON(http.StatusForbidden, dto.SSRFErrorResponse(
				"请求目标不在允许范围内",
				requestIdStr,
			))
			return
		}

		// 处理并发限制错误
		if _, ok := err.(*security.ConcurrencyLimitError); ok {
			h.log.Warn().
				Err(err).
				Str("request_id", requestIdStr).
				Msg("concurrency limit exceeded")
			c.JSON(http.StatusTooManyRequests, dto.RateLimitErrorResponse(
				1.0,
				requestIdStr,
			))
			return
		}

		// 处理超时错误
		if ctx.Err() != nil {
			h.log.Error().
				Err(ctx.Err()).
				Str("request_id", requestIdStr).
				Msg("dashboard stats timeout")
			c.JSON(http.StatusGatewayTimeout, dto.TimeoutErrorResponse(
				"agent-platform",
				requestIdStr,
			))
			return
		}

		h.log.Error().
			Err(err).
			Str("request_id", requestIdStr).
			Msg("failed to fetch dashboard data from upstream")

		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse(
			dto.ErrCodeUpstreamError,
			"暂时无法加载仪表板数据",
			requestIdStr,
		))
		return
	}

	// 聚合数据
	response := h.aggregateDashboardStats(raw, requestIdStr)

	c.JSON(http.StatusOK, response)
}

// aggregateDashboardStats 将下游响应聚合为 BFF DTO
func (h *DashboardHandler) aggregateDashboardStats(raw *proxy.DashboardRawData, requestId string) dto.DashboardStatsResponse {
	now := time.Now().UTC().Format(time.RFC3339)

	response := dto.DashboardStatsResponse{
		RequestId: requestId,
		Timestamp: now,
		Agents:    dto.AgentStats{},
		Tasks:     dto.TaskStats{ByStatus: make(map[string]int)},
		Tools:     dto.ToolStats{},
		Memory:    dto.MemoryStats{},
	}

	// 解析 agents
	if len(raw.Agents) > 0 {
		var agents []dto.AgentSummary
		if err := json.Unmarshal(raw.Agents, &agents); err == nil {
			response.Agents.Total = len(agents)
			for _, a := range agents {
				switch a.Status {
				case "idle":
					response.Agents.Idle++
				case "busy":
					response.Agents.Busy++
				case "paused":
					response.Agents.Paused++
				case "stopped":
					response.Agents.Stopped++
				}
			}
			// 限制列表长度
			if len(agents) > 10 {
				response.Agents.List = agents[:10]
			} else {
				response.Agents.List = agents
			}
		}
	}

	// 解析 tasks
	if len(raw.Tasks) > 0 {
		var tasks []dto.TaskSummary
		if err := json.Unmarshal(raw.Tasks, &tasks); err == nil {
			response.Tasks.Total = len(tasks)
			for _, t := range tasks {
				response.Tasks.ByStatus[t.Status]++
			}
			// 限制列表长度
			if len(tasks) > 5 {
				response.Tasks.RecentList = tasks[:5]
			} else {
				response.Tasks.RecentList = tasks
			}
		}
	}

	// 解析 tools
	if len(raw.Tools) > 0 {
		var tools []map[string]interface{}
		if err := json.Unmarshal(raw.Tools, &tools); err == nil {
			response.Tools.Total = len(tools)
			for _, t := range tools {
				if enabled, ok := t["enabled"].(bool); ok && enabled {
					response.Tools.Enabled++
				}
			}
		}
	}

	// 解析 stats (包含 memory 和额外统计)
	if len(raw.Stats) > 0 {
		var stats map[string]interface{}
		if err := json.Unmarshal(raw.Stats, &stats); err == nil {
			// memory
			if memory, ok := stats["memory"].(map[string]interface{}); ok {
				if count, ok := memory["session_count"].(float64); ok {
					response.Memory.SessionCount = int(count)
				}
				if msgCount, ok := memory["total_session_messages"].(float64); ok {
					response.Memory.TotalSessionMessages = int(msgCount)
				}
				if ltCount, ok := memory["long_term_count"].(float64); ok {
					response.Memory.LongTermCount = int(ltCount)
				}
			}
			// tasks by_status from stats
			if tasksStats, ok := stats["tasks"].(map[string]interface{}); ok {
				if byStatus, ok := tasksStats["by_status"].(map[string]interface{}); ok {
					for k, v := range byStatus {
						if count, ok := v.(float64); ok {
							response.Tasks.ByStatus[k] = int(count)
						}
					}
				}
			}
		}
	}

	return response
}

// Health 健康检查
func (h *DashboardHandler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "healthy",
		"service": "agent-bff",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

// Stats 并发限制统计
func (h *DashboardHandler) Stats(c *gin.Context) {
	stats := h.proxy.GetStats()
	c.JSON(http.StatusOK, gin.H{
		"service": "agent-bff",
		"concurrency": stats,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}
