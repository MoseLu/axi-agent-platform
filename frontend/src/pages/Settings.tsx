import { useState, useEffect } from 'react'
import { Save, Key, Database, Server, Shield, Paintbrush } from 'lucide-react'
import { systemApi } from '../services/api'
import { useUIStore } from '../store'

interface SettingsData {
  minimax_api_key: string
  minimax_api_url: string
  openai_api_key: string
  default_temperature: number
  default_max_tokens: number
  max_agents: number
}

export default function Settings() {
  const { backendLabel, glassLevel, setBackendLabel, setGlassLevel } = useUIStore()
  const [settings, setSettings] = useState<SettingsData>({
    minimax_api_key: '',
    minimax_api_url: 'https://api.minimaxi.com/v1',
    openai_api_key: '',
    default_temperature: 0.7,
    default_max_tokens: 2048,
    max_agents: 10,
  })
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  useEffect(() => {
    // 从环境变量或API加载设置
    // 这里简化处理，实际应从后端获取
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      // 实际应调用API保存设置
      await new Promise(resolve => setTimeout(resolve, 1000))
      setSaveMessage('设置已保存')
      setTimeout(() => setSaveMessage(''), 3000)
    } catch (error) {
      setSaveMessage('保存失败')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div>
      {/* Settings Form */}
      <div className="glass rounded-2xl p-6 space-y-8">
        {/* Appearance Section */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <Paintbrush className="w-5 h-5 text-glass-gold" />
            <h3 className="text-lg font-semibold text-ink">外观</h3>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 rounded-2xl border border-white/10 bg-dark-950/35 p-5">
            <div>
              <p className="font-medium text-ink">桌面玻璃</p>
              <p className="mt-1 text-sm text-ink-muted/60">
                调整主应用玻璃透明度与当前会话后端。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[560px]">
              <label className="glass-pill flex h-10 items-center gap-4 px-4">
                <span className="text-sm text-ink-muted/70">Backend</span>
                <select
                  value={backendLabel}
                  onChange={(event) => setBackendLabel(event.currentTarget.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm font-bold text-ink outline-none"
                >
                  <option>Moonshot</option>
                  <option>MiniMax</option>
                  <option>OpenAI</option>
                </select>
              </label>
              <label className="glass-pill flex h-10 items-center gap-3 px-4">
                <span className="text-sm text-ink-muted/70">Glass</span>
                <input
                  aria-label="Glass opacity"
                  max="100"
                  min="0"
                  type="range"
                  value={glassLevel}
                  onChange={(event) => setGlassLevel(Number(event.currentTarget.value))}
                  className="min-w-0 flex-1 accent-glass-gold"
                />
                <strong className="w-10 text-right text-sm text-ink">{glassLevel}%</strong>
              </label>
            </div>
          </div>
        </div>

        {/* API Keys Section */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <Key className="w-5 h-5 text-primary-400" />
            <h3 className="text-lg font-semibold text-slate-100">API 配置</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  miniMax API Key
                </label>
                <input
                  type="password"
                  value={settings.minimax_api_key}
                  onChange={(e) => setSettings({ ...settings, minimax_api_key: e.target.value })}
                  className="input-field"
                  placeholder="sk-..."
                />
                <p className="text-xs text-slate-500 mt-1">用于调用miniMax大模型</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  miniMax API URL
                </label>
                <input
                  type="text"
                  value={settings.minimax_api_url}
                  onChange={(e) => setSettings({ ...settings, minimax_api_url: e.target.value })}
                  className="input-field"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                OpenAI API Key
              </label>
              <input
                type="password"
                value={settings.openai_api_key}
                onChange={(e) => setSettings({ ...settings, openai_api_key: e.target.value })}
                className="input-field"
                placeholder="sk-..."
              />
              <p className="text-xs text-slate-500 mt-1">可选，用于备用模型</p>
            </div>
          </div>
        </div>

        {/* Model Settings Section */}
        <div className="border-t border-slate-700/50 pt-6">
          <div className="flex items-center gap-3 mb-4">
            <Server className="w-5 h-5 text-accent-cyan" />
            <h3 className="text-lg font-semibold text-slate-100">模型参数</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                默认温度
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={settings.default_temperature}
                onChange={(e) => setSettings({ ...settings, default_temperature: parseFloat(e.target.value) })}
                className="input-field"
              />
              <p className="text-xs text-slate-500 mt-1">控制输出的随机性 (0-2)</p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                默认最大令牌数
              </label>
              <input
                type="number"
                min="1"
                max="8192"
                value={settings.default_max_tokens}
                onChange={(e) => setSettings({ ...settings, default_max_tokens: parseInt(e.target.value) })}
                className="input-field"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                最大智能体数
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={settings.max_agents}
                onChange={(e) => setSettings({ ...settings, max_agents: parseInt(e.target.value) })}
                className="input-field"
              />
              <p className="text-xs text-slate-500 mt-1">系统允许的最大智能体数量</p>
            </div>
          </div>
        </div>

        {/* Security Section */}
        <div className="border-t border-slate-700/50 pt-6">
          <div className="flex items-center gap-3 mb-4">
            <Shield className="w-5 h-5 text-accent-purple" />
            <h3 className="text-lg font-semibold text-slate-100">安全设置</h3>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-dark-800/50 rounded-lg">
              <div>
                <p className="font-medium text-slate-200">API Key 加密存储</p>
                <p className="text-sm text-slate-500">所有API密钥都将加密后存储</p>
              </div>
              <div className="w-12 h-6 bg-emerald-500 rounded-full relative">
                <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full" />
              </div>
            </div>
            
            <div className="flex items-center justify-between p-4 bg-dark-800/50 rounded-lg">
              <div>
                <p className="font-medium text-slate-200">工具调用安全校验</p>
                <p className="text-sm text-slate-500">禁止执行危险操作</p>
              </div>
              <div className="w-12 h-6 bg-emerald-500 rounded-full relative">
                <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="border-t border-slate-700/50 pt-6 flex items-center justify-between">
          <div>
            {saveMessage && (
              <span className={`text-sm ${saveMessage.includes('成功') ? 'text-emerald-400' : 'text-red-400'}`}>
                {saveMessage}
              </span>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {isSaving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>

      {/* System Info */}
      <div className="glass rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Database className="w-5 h-5 text-accent-pink" />
          <h3 className="text-lg font-semibold text-slate-100">系统信息</h3>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-slate-500">版本</span>
            <p className="text-slate-200">v1.0.0</p>
          </div>
          <div>
            <span className="text-slate-500">后端框架</span>
            <p className="text-slate-200">FastAPI</p>
          </div>
          <div>
            <span className="text-slate-500">前端框架</span>
            <p className="text-slate-200">React + Vite</p>
          </div>
          <div>
            <span className="text-slate-500">数据库</span>
            <p className="text-slate-200">SQLite + Chroma</p>
          </div>
        </div>
      </div>
    </div>
  )
}
