# pgvector 安装脚本 - 请以管理员身份运行 PowerShell 后执行此脚本
# 用法: 右键 PowerShell -> 以管理员身份运行 -> cd E:\app\mcp-swarm; .\install-pgvector-admin.ps1

$ErrorActionPreference = "Stop"
$pg = "D:\software\PostgreSql"
$src = "E:\app\mcp-swarm\pgvector-extract"
$svc = "postgresql-x64-18"

Write-Host "正在停止 PostgreSQL 服务..."
Stop-Service -Name $svc -Force
Start-Sleep -Seconds 2

Write-Host "正在复制 vector.dll 到 $pg\lib\ ..."
Copy-Item "$src\lib\vector.dll" -Destination "$pg\lib\" -Force

Write-Host "正在复制扩展文件到 $pg\share\extension\ ..."
Copy-Item "$src\share\extension\*" -Destination "$pg\share\extension\" -Force

Write-Host "正在启动 PostgreSQL 服务..."
Start-Service -Name $svc

Write-Host "完成。请连接数据库 mcp_swarm 后执行: CREATE EXTENSION vector;"
