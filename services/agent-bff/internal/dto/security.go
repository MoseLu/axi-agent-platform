package dto

import "net/http"

// SecurityErrorResponse 安全相关错误的 HTTP 状态码
func SecurityErrorStatus(code string) int {
	switch code {
	case ErrCodeForbidden:
		return http.StatusForbidden
	case ErrCodeRateLimited, ErrCodeTooManyRequests:
		return http.StatusTooManyRequests
	case ErrCodeTimeout:
		return http.StatusGatewayTimeout
	case ErrCodeServiceUnavailable:
		return http.StatusServiceUnavailable
	default:
		return http.StatusInternalServerError
	}
}

// SSRFErrorResponse 创建 SSRF 保护错误响应
func SSRFErrorResponse(message, requestId string) ErrorResponse {
	return ErrorResponse{
		Code:      ErrCodeForbidden,
		Message:   message,
		RequestId: requestId,
		Details: map[string]any{
			"type": "SSRF_PROTECTION",
		},
	}
}

// RateLimitErrorResponse 创建限流错误响应
func RateLimitErrorResponse(retryAfter float64, requestId string) ErrorResponse {
	return ErrorResponse{
		Code:      ErrCodeTooManyRequests,
		Message:   "服务暂时不可用，请稍后重试",
		RequestId: requestId,
		Details: map[string]any{
			"retry_after_seconds": retryAfter,
		},
	}
}

// TimeoutErrorResponse 创建超时错误响应
func TimeoutErrorResponse(serviceName, requestId string) ErrorResponse {
	return ErrorResponse{
		Code:      ErrCodeTimeout,
		Message:   "请求超时，请稍后重试",
		RequestId: requestId,
		Details: map[string]any{
			"service": serviceName,
		},
	}
}
