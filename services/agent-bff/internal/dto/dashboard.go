package dto

// DashboardStatsResponse 是 Dashboard 聚合端点返回的 DTO
// 符合 BFF 指南要求：前端视图模型，不是领域对象转储
type DashboardStatsResponse struct {
	// RequestId 用于追踪和排障
	RequestId string `json:"requestId"`

	// Agents 智能体统计
	Agents AgentStats `json:"agents"`

	// Tasks 任务统计
	Tasks TaskStats `json:"tasks"`

	// Tools 工具统计
	Tools ToolStats `json:"tools"`

	// Memory 记忆统计
	Memory MemoryStats `json:"memory"`

	// Timestamp 响应时间戳
	Timestamp string `json:"timestamp"`
}

// AgentStats 智能体统计
type AgentStats struct {
	Total   int `json:"total"`
	Idle    int `json:"idle"`
	Busy    int `json:"busy"`
	Paused  int `json:"paused"`
	Stopped int `json:"stopped"`
	// List 仅在需要时返回完整列表，否则为空数组
	List []AgentSummary `json:"list,omitempty"`
}

// AgentSummary 智能体摘要（用于列表展示）
type AgentSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
}

// TaskStats 任务统计
type TaskStats struct {
	Total     int `json:"total"`
	ByStatus  map[string]int `json:"by_status"`
	RecentList []TaskSummary `json:"recent_list,omitempty"`
}

// TaskSummary 任务摘要
type TaskSummary struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
}

// ToolStats 工具统计
type ToolStats struct {
	Total   int `json:"total"`
	Enabled int `json:"enabled"`
	Categories []ToolCategory `json:"categories,omitempty"`
}

// ToolCategory 工具分类
type ToolCategory struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// MemoryStats 记忆统计
type MemoryStats struct {
	SessionCount         int `json:"session_count"`
	TotalSessionMessages int `json:"total_session_messages"`
	LongTermCount       int `json:"long_term_count"`
}
