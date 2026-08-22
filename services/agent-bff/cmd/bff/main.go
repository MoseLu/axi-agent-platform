package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"agent-bff/internal/handlers"
	"agent-bff/internal/middleware"
	"agent-bff/internal/proxy"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
)

func main() {
	// 初始化日志
	logger := zerolog.New(os.Stdout).
		With().
		Timestamp().
		Str("service", "agent-bff").
		Logger()

	// 获取后端地址（默认 localhost:8000）
	backendURL := os.Getenv("BACKEND_URL")
	if backendURL == "" {
		backendURL = "http://localhost:8000"
	}

	// 创建代理
	backendProxy := proxy.NewAgentPlatformProxy(backendURL, logger)

	// 创建处理器
	dashboardHandler := handlers.NewDashboardHandler(backendProxy, logger)

	// 设置 Gin 模式
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}

	// 创建 Gin 路由器
	router := gin.New()

	// 应用中间件
	router.Use(middleware.CORS())
	router.Use(middleware.RequestID())
	router.Use(middleware.Logger(logger))
	router.Use(gin.Recovery())

	// 健康检查
	router.GET("/health", dashboardHandler.Health)

	// 统计端点
	router.GET("/stats", dashboardHandler.Stats)

	// API v1 路由组
	v1 := router.Group("/api/v1")
	{
		// Dashboard 聚合端点
		v1.GET("/dashboard/stats", dashboardHandler.GetDashboardStats)

		// 预留：其他聚合端点可以在这里添加
		// v1.GET("/agents/with-tasks", dashboardHandler.GetAgentsWithTasks)
		// v1.POST("/tasks/batch", dashboardHandler.BatchTasks)
	}

	// 创建 HTTP 服务器
	server := &http.Server{
		Addr:         ":8081", // BFF 监听 8081，前端连接这个端口
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// 启动服务器
	go func() {
		logger.Info().
			Str("backend_url", backendURL).
			Str("listen", server.Addr).
			Msg("starting agent-bff server")

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal().Err(err).Msg("server failed to start")
		}
	}()

	// 等待信号优雅关闭
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info().Msg("shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.Error().Err(err).Msg("server forced to shutdown")
	}

	logger.Info().Msg("server stopped")
}
