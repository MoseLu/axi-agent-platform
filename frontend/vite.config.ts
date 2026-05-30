import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const hostedBase = process.env.AXI_APP_BASE || process.env.VITE_AXI_APP_BASE || '/'
const normalizedHostedBase = hostedBase === '/' ? '' : hostedBase.replace(/\/$/u, '')
const hostedApiPrefix = normalizedHostedBase ? `${normalizedHostedBase}/api` : ''
const backendUrl = process.env.AXI_AGENT_BACKEND_URL || 'http://127.0.0.1:8001'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const apiProxy = {
  '/api': {
    target: backendUrl,
    changeOrigin: true,
  },
  ...(hostedApiPrefix
    ? {
        [hostedApiPrefix]: {
          target: backendUrl,
          changeOrigin: true,
          rewrite: (urlPath: string) => urlPath.replace(
            new RegExp(`^${escapeRegExp(normalizedHostedBase)}`),
            '',
          ),
        },
      }
    : {}),
}

export default defineConfig({
  plugins: [react()],
  base: hostedBase,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: apiProxy,
  },
})
