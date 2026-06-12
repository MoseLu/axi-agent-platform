import { useState, useEffect, useRef } from 'react'
import {
    ArrowUp,
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
    Clock,
    Settings2
} from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import {
    useTasksStore,
    useToolsStore,
    useMemoryStore
} from '../store'
import {
    tasksApi,
    memoryApi,
    toolsApi
} from '../services/api'
import { Message } from '../types'

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
    const { addTask } = useTasksStore()
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
        <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col overflow-hidden">
            <div
                className={cn(
                    'min-h-0 flex-1 px-1 py-4 md:px-4 md:py-6 space-y-6 scrollbar-thin',
                    messages.length > 0 || isTyping ? 'overflow-y-auto' : 'overflow-hidden',
                )}
            >
                {messages.length === 0 && !isTyping && (
                    <div className="flex h-full min-h-0 flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-500">
                        <div className="relative">
                            <div className="grid h-16 w-16 place-items-center rounded-full border border-white/15 bg-dark-950/45 shadow-2xl">
                                <Sparkles className="h-8 w-8 text-glass-gold" />
                            </div>
                            <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-4 border-dark-900/80 bg-emerald-500">
                                <div className="h-2 w-2 animate-ping rounded-full bg-white" />
                            </div>
                        </div>

                        <div className="mt-8 space-y-4">
                            <h1 className="font-display text-3xl font-normal text-ink md:text-4xl">
                                我们该做什么？
                            </h1>
                            <p className="mx-auto max-w-md leading-relaxed text-ink-muted/70">
                                输入自然语言，生成可交互的 Makepad diagram。
                            </p>
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
                                ? "bg-teal-700/70 text-white rounded-tr-none"
                                : "border border-white/10 bg-dark-950/55 text-ink rounded-tl-none"
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
                        <div className="flex items-center gap-1 rounded-2xl bg-dark-950/55 p-4">
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-glass-gold [animation-delay:-0.3s]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-glass-gold [animation-delay:-0.15s]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-glass-gold" />
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="glass-card mb-1 shrink-0 rounded-[1.6rem] p-4 md:p-5">
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
                        placeholder="问任何事。输入 @ 使用插件或提及文件"
                        className="h-20 w-full resize-none border-0 bg-transparent pb-8 pr-24 text-sm text-ink placeholder-ink-muted/55 outline-none scrollbar-thin md:h-24"
                    />

                    <div className="flex flex-wrap items-center gap-2 pr-24 text-xs text-ink-muted/70">
                        <button
                            onClick={createNewSession}
                            className="glass-control grid h-8 w-8 place-items-center hover:text-ink"
                            title="新会话"
                            type="button"
                        >
                            <Plus className="h-4 w-4" />
                        </button>
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className={cn(
                                'glass-control grid h-8 w-8 place-items-center hover:text-ink',
                                showSettings && 'text-glass-gold',
                            )}
                            title="本次会话选项"
                            type="button"
                        >
                            <Settings2 className="h-4 w-4" />
                        </button>

                        <div className="relative group">
                            <button className="glass-control flex h-8 items-center gap-2 px-3 text-xs font-medium hover:text-ink">
                                <GitBranch className="h-3.5 w-3.5 text-glass-gold" />
                                <span>默认权限</span>
                                <ChevronDown className="h-3 w-3" />
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

                    <div className="relative group">
                        <button className="glass-control flex h-8 items-center gap-2 px-3 text-xs font-medium hover:text-ink">
                            <Brain className="h-3.5 w-3.5 text-accent-cyan" />
                            <span>记忆会话</span>
                            <ChevronDown className="h-3 w-3" />
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

                    <div className="relative group">
                        <button className="glass-control flex h-8 items-center gap-2 px-3 text-xs font-medium hover:text-ink">
                            <Wrench className="h-3.5 w-3.5 text-accent-purple" />
                            <span>工具: {selectedTools.length > 0 ? `${selectedTools.length}个` : '自动'}</span>
                            <ChevronDown className="h-3 w-3" />
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
                        <span>Thinking</span>
                    </div>

                    <div className="absolute bottom-0 right-0 flex items-center gap-3">
                        <button
                            onClick={() => setInput('')}
                            className="glass-control h-8 px-4 text-sm font-semibold hover:text-ink"
                            type="button"
                        >
                            Clear
                        </button>
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isTyping}
                        className={cn(
                            "grid h-11 w-11 place-items-center rounded-full transition-all",
                            input.trim() && !isTyping
                                ? "bg-glass-gold text-dark-950 shadow-lg hover:translate-y-[-1px] active:translate-y-[1px]"
                                : "bg-dark-700 text-slate-500 cursor-not-allowed"
                        )}
                    >
                        <ArrowUp className="w-5 h-5" />
                    </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
