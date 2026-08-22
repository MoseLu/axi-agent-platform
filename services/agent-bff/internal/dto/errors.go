package dto

// ErrorResponse 是 BFF 统一错误响应格式
// 符合 BFF 指南要求：code 面向程序，message 面向用户，requestId 用于排障
type ErrorResponse struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	RequestId string         `json:"requestId"`
	Details   map[string]any `json:"details,omitempty"`
}

// NewErrorResponse 创建错误响应
func NewErrorResponse(code, message, requestId string) ErrorResponse {
	return ErrorResponse{
		Code:      code,
		Message:   message,
		RequestId: requestId,
	}
}

// NewErrorResponseWithDetails 创建带详细信息的错误响应
func NewErrorResponseWithDetails(code, message, requestId string, details map[string]any) ErrorResponse {
	return ErrorResponse{
		Code:      code,
		Message:   message,
		RequestId: requestId,
		Details:   details,
	}
}

// 常见错误码定义
const (
	// 客户端错误 (4xx)
	ErrCodeBadRequest          = "BAD_REQUEST"
	ErrCodeUnauthorized        = "UNAUTHORIZED"
	ErrCodeForbidden           = "FORBIDDEN"
	ErrCodeNotFound           = "NOT_FOUND"
	ErrCodeValidationFailed   = "VALIDATION_FAILED"
	ErrCodeRateLimited        = "RATE_LIMITED"
	ErrCodeTooManyRequests    = "TOO_MANY_REQUESTS"

	// 服务端错误 (5xx)
	ErrCodeInternalError       = "INTERNAL_ERROR"
	ErrCodeUpstreamError       = "UPSTREAM_ERROR"
	ErrCodeTimeout            = "TIMEOUT"
	ErrCodeServiceUnavailable = "SERVICE_UNAVAILABLE"
	ErrCodeDegraded           = "DEGRADED"  // 部分成功，降级状态

	// 业务错误
	ErrCodeAgentNotFound       = "AGENT_NOT_FOUND"
	ErrCodeTaskNotFound        = "TASK_NOT_FOUND"
	ErrCodeToolNotFound        = "TOOL_NOT_FOUND"
	ErrCodeExecutionFailed     = "EXECUTION_FAILED"
)
