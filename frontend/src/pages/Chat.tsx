import { useState, useEffect, useRef } from 'react'
import {
    Send,
    Bot,
    User,
    Brain,
    Wrench,
    Zap,
    GitBranch,
    Users,
    Sparkles,
    ChevronDown,
    Plus,
    Trash2,
    Clock,
    Settings2
} from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import {
    useAgentsStore,
    useTasksStore,
    useToolsStore,
    useMemoryStore
} from '../store'
import {
    tasksApi,
    memoryApi,
    toolsApi,
    agentsApi
} from '../services/api'
import { Message, TaskType } from '../types'

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

const COLLABORATION_MODES = [
    { id: 'general', name: '通用模式', icon: Bot, description: '单智能体处理简单咨询' },
    { id: 'subagent', name: 'SubAgent 模式', icon: GitBranch, description: '代码开发/复杂规划流' },
    { id: 'cluster', name: '集群模式', icon: Users, description: '海量解耦任务并行处理' },
    { id: 'hybrid', name: '混合模式', icon: Zap, description: '多层级功能组协作' },
]

export default function Chat() {
    const { tasks, addTask } = useTasksStore()
    const { tools, setTools } = useToolsStore()
    const { sessions, setSessions, addSession } = useMemoryStore()

    const [input, setInput] = useState('')
    const [messages, setMessages] = useState<Message[]>([])
    const [isTyping, setIsTyping] = useState(false)

    // Settings state
    const [selectedMode, setSelectedMode] = useState('general')
    const [useAutoStrategy, setUseAutoStrategy] = useState(true)
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
    const [selectedTools, setSelectedTools] = useState<string[]>([])

    // UI state
    const [showSettings, setShowSettings] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        // Load initial data
        const init = async () => {
            const [toolsRes, sessionsRes] = await Promise.all([
                toolsApi.list({ enabled_only: true }),
                memoryApi.listSessions()
            ])
            setTools(toolsRes.data)
            setSessions(sessionsRes.data)

            if (sessionsRes.data.length > 0) {
                setSelectedSessionId(sessionsRes.data[0].session_id)
                loadMessages(sessionsRes.data[0].session_id)
            } else {
                createNewSession()
            }
        }
        init()
    }, [])

    useEffect(() => {
        scrollToBottom()
    }, [messages])

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }

    const loadMessages = async (sessionId: string) => {
        try {
            const res = await memoryApi.getMessages(sessionId)
            setMessages(res.data)
        } catch (err) {
            console.error('Failed to load messages:', err)
        }
    }

    const createNewSession = async () => {
        try {
            const res = await memoryApi.createSession(`New Chat ${new Date().toLocaleTimeString()}`)
            const newSession = res.data
            addSession(newSession)
            setSelectedSessionId(newSession.session_id)
            setMessages([])
        } catch (err) {
            console.error('Failed to create session:', err)
        }
    }

    const handleSend = async () => {
        if (!input.trim() || !selectedSessionId) return

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input,
            timestamp: new Date().toISOString()
        }

        setMessages(prev => [...prev, userMessage])
        setInput('')
        setIsTyping(true)

        try {
            // 1. Save message to memory
            await memoryApi.addMessage(selectedSessionId, 'user', input)

            // 2. Create a task based on the chat input and settings
            const taskData = {
                title: input.substring(0, 50) + (input.length > 50 ? '...' : ''),
                description: input,
                task_type: useAutoStrategy ? 'general' : selectedMode,
                use_subagent_mode: useAutoStrategy ? true : selectedMode !== 'general',
                strategy_mode: useAutoStrategy ? 'auto' : 'manual',
                input_data: {
                    session_id: selectedSessionId,
                    tools: selectedTools
                }
            }

            const res = await tasksApi.create(taskData)
            addTask(res.data)

            // Simulate assistant response for UI feel
            // In a real app, you would poll task status or use websockets
            setTimeout(() => {
                const assistantMessage: Message = {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: `已为您启动 **${useAutoStrategy ? '自动' : selectedMode}** 协作模式处理该任务。任务 ID: \`${res.data.id}\`。`,
                    timestamp: new Date().toISOString()
                }
                setMessages(prev => [...prev, assistantMessage])
                memoryApi.addMessage(selectedSessionId, 'assistant', assistantMessage.content)
                setIsTyping(false)
            }, 1000)

        } catch (err) {
            console.error('Failed to send message:', err)
            setIsTyping(false)
        }
    }

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] max-w-5xl mx-auto">
            {/* Session/Settings Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700/50 bg-dark-800/50 rounded-t-xl">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary-500/10 rounded-lg text-primary-400">
                        <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-slate-100">
                            {sessions.find(s => s.session_id === selectedSessionId)?.context?.title || '新对话'}
                        </h2>
                        <p className="text-xs text-slate-500">
                            {useAutoStrategy ? '自动规划模式' : `${selectedMode} 模式`}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={createNewSession}
                        className="p-2 hover:bg-dark-700 rounded-lg text-slate-400 transition-colors"
                        title="New Chat"
                    >
                        <Plus className="w-5 h-5" />
                    </button>
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className={cn(
                            "p-2 rounded-lg transition-colors",
                            showSettings ? "bg-primary-500/20 text-primary-400" : "hover:bg-dark-700 text-slate-400"
                        )}
                    >
                        <Settings2 className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
                {messages.length === 0 && !isTyping && (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-8 animate-in fade-in zoom-in duration-500">
                        <div className="relative">
                            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary-500 via-accent-purple to-accent-pink flex items-center justify-center neon-glow animate-pulse">
                                <Sparkles className="w-10 h-10 text-white" />
                            </div>
                            <div className="absolute -top-2 -right-2 w-6 h-6 bg-emerald-500 rounded-full border-4 border-dark-900 flex items-center justify-center">
                                <div className="w-2 h-2 bg-white rounded-full animate-ping" />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h1 className="text-4xl font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                                Agent Swarm 协作中心
                            </h1>
                            <p className="text-slate-400 max-w-md mx-auto leading-relaxed">
                                描述您的复杂任务，系统将自动规划最优智能体架构进行协作。
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl px-4">
                            {[
                                { title: '全栈开发', desc: '构建一个具备前后端的管理系统', mode: 'hybrid', icon: Zap },
                                { title: '海量采集', desc: '并行采集 50 个新闻网站的数据', mode: 'cluster', icon: Users },
                                { title: '代码重构', desc: '深度审查并重构核心后端逻辑流', mode: 'subagent', icon: GitBranch },
                                { title: '通用咨询', desc: '分析当前项目架构并提供改进建议', mode: 'general', icon: Bot },
                            ].map((chip) => (
                                <button
                                    key={chip.title}
                                    onClick={() => {
                                        setSelectedMode(chip.mode)
                                        setUseAutoStrategy(false)
                                        setInput(chip.desc)
                                    }}
                                    className="glass p-4 rounded-xl text-left glass-hover border-slate-700/30 group"
                                >
                                    <chip.icon className="w-5 h-5 text-primary-400 mb-2 group-hover:scale-110 transition-transform" />
                                    <div className="text-sm font-semibold text-slate-200">{chip.title}</div>
                                    <div className="text-xs text-slate-500 mt-1">{chip.desc}</div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={cn(
                            "flex gap-4 max-w-[85%]",
                            msg.role === 'user' ? "ml-auto flex-row-reverse" : ""
                        )}
                    >
                        <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-1",
                            msg.role === 'user' ? "bg-slate-700" : "bg-primary-500"
                        )}>
                            {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                        </div>
                        <div className={cn(
                            "rounded-2xl p-4 text-sm leading-relaxed",
                            msg.role === 'user'
                                ? "bg-primary-500 text-white rounded-tr-none"
                                : "bg-dark-700 text-slate-200 border border-slate-700/50 rounded-tl-none"
                        )}>
                            {msg.content}
                        </div>
                    </div>
                ))}

                {isTyping && (
                    <div className="flex gap-4 max-w-[80%]">
                        <div className="w-8 h-8 rounded-lg bg-primary-500 flex items-center justify-center">
                            <Bot className="w-5 h-5" />
                        </div>
                        <div className="bg-dark-700 rounded-2xl p-4 flex gap-1 items-center">
                            <span className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                            <span className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                            <span className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce" />
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input / Control Area */}
            <div className="p-4 bg-dark-800/50 border-t border-slate-700/50 rounded-b-xl space-y-4">
                {/* Settings Bar */}
                <div className="flex flex-wrap items-center gap-4">
                    {/* Mode Selector */}
                    <div className="relative group">
                        <button className="flex items-center gap-2 px-3 py-1.5 bg-dark-700 hover:bg-dark-600 rounded-lg text-xs font-medium text-slate-300 transition-colors">
                            <GitBranch className="w-3.5 h-3.5 text-primary-400" />
                            <span>模式: {useAutoStrategy ? '自动' : COLLABORATION_MODES.find(m => m.id === selectedMode)?.name}</span>
                            <ChevronDown className="w-3 h-3" />
                        </button>
                        <div className="absolute bottom-full left-0 mb-2 w-56 bg-dark-800 border border-slate-700 rounded-xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 p-2">
                            <div
                                onClick={() => setUseAutoStrategy(!useAutoStrategy)}
                                className="flex items-center justify-between p-2 hover:bg-dark-700 rounded-lg cursor-pointer mb-1 border-b border-slate-700/50 pb-2"
                            >
                                <div className="flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-purple-400" />
                                    <span className="text-xs text-slate-200">自动策略推荐</span>
                                </div>
                                <div className={cn(
                                    "w-8 h-4 rounded-full transition-colors relative",
                                    useAutoStrategy ? "bg-primary-500" : "bg-slate-700"
                                )}>
                                    <div className={cn(
                                        "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all",
                                        useAutoStrategy ? "left-4.5" : "left-0.5"
                                    )} />
                                </div>
                            </div>
                            {!useAutoStrategy && COLLABORATION_MODES.map((mode) => (
                                <div
                                    key={mode.id}
                                    onClick={() => setSelectedMode(mode.id)}
                                    className={cn(
                                        "p-2 hover:bg-dark-700 rounded-lg cursor-pointer flex items-center gap-3",
                                        selectedMode === mode.id ? "bg-primary-500/10 text-primary-400" : "text-slate-400"
                                    )}
                                >
                                    <mode.icon className="w-4 h-4" />
                                    <div>
                                        <div className="text-xs font-medium text-slate-200">{mode.name}</div>
                                        <div className="text-[10px] opacity-60 leading-tight">{mode.description}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Memory Selector */}
                    <div className="relative group">
                        <button className="flex items-center gap-2 px-3 py-1.5 bg-dark-700 hover:bg-dark-600 rounded-lg text-xs font-medium text-slate-300 transition-colors">
                            <Brain className="w-3.5 h-3.5 text-accent-cyan" />
                            <span>记忆会话</span>
                            <ChevronDown className="w-3 h-3" />
                        </button>
                        <div className="absolute bottom-full left-0 mb-2 w-64 bg-dark-800 border border-slate-700 rounded-xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 p-2 overflow-y-auto max-h-60">
                            {sessions.map((s) => (
                                <div
                                    key={s.session_id}
                                    onClick={() => {
                                        setSelectedSessionId(s.session_id)
                                        loadMessages(s.session_id)
                                    }}
                                    className={cn(
                                        "p-2 hover:bg-dark-700 rounded-lg cursor-pointer flex items-center justify-between mb-1",
                                        selectedSessionId === s.session_id ? "bg-primary-500/10 text-primary-400" : "text-slate-400"
                                    )}
                                >
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <Clock className="w-3 h-3 flex-shrink-0" />
                                        <span className="text-xs truncate">{s.context?.title || '未命名会话'}</span>
                                    </div>
                                    <span className="text-[10px] opacity-50">{s.message_count}条</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Tools Toggle */}
                    <div className="relative group">
                        <button className="flex items-center gap-2 px-3 py-1.5 bg-dark-700 hover:bg-dark-600 rounded-lg text-xs font-medium text-slate-300 transition-colors">
                            <Wrench className="w-3.5 h-3.5 text-accent-purple" />
                            <span>工具: {selectedTools.length > 0 ? `${selectedTools.length}个` : '自动'}</span>
                            <ChevronDown className="w-3 h-3" />
                        </button>
                        <div className="absolute bottom-full left-0 mb-2 w-56 bg-dark-800 border border-slate-700 rounded-xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 p-2 overflow-y-auto max-h-60">
                            <div className="px-2 py-1 mb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">可用工具</div>
                            {tools.map((tool) => (
                                <div
                                    key={tool.id}
                                    onClick={() => {
                                        const next = selectedTools.includes(tool.id)
                                            ? selectedTools.filter(id => id !== tool.id)
                                            : [...selectedTools, tool.id]
                                        setSelectedTools(next)
                                    }}
                                    className="flex items-center gap-2 p-2 hover:bg-dark-700 rounded-lg cursor-pointer"
                                >
                                    <div className={cn(
                                        "w-3.5 h-3.5 rounded border border-slate-600 flex items-center justify-center transition-colors",
                                        selectedTools.includes(tool.id) ? "bg-primary-500 border-primary-500" : ""
                                    )}>
                                        {selectedTools.includes(tool.id) && <Plus className="w-2.5 h-2.5 text-white rotate-45" />}
                                    </div>
                                    <span className="text-xs text-slate-300">{tool.name}</span>
                                </div>
                            ))}
                            {tools.length === 0 && <div className="p-2 text-xs text-slate-500">暂无启用工具</div>}
                        </div>
                    </div>
                </div>

                {/* Input Box */}
                <div className="relative">
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                handleSend()
                            }
                        }}
                        placeholder="输入任务描述，按 Enter 发送..."
                        className="w-full bg-dark-900 border border-slate-700 rounded-xl py-4 pl-4 pr-14 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 min-h-[100px] resize-none scrollbar-thin transition-all"
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isTyping}
                        className={cn(
                            "absolute right-3 bottom-3 p-2 rounded-lg transition-all",
                            input.trim() && !isTyping
                                ? "bg-primary-500 text-white shadow-lg hover:translate-y-[-1px] active:translate-y-[1px]"
                                : "bg-dark-700 text-slate-500 cursor-not-allowed"
                        )}
                    >
                        <Send className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
    )
}
