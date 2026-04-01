import { useState, useEffect } from 'react'
import { Plus, Search, Trash2, MessageSquare, Brain, Save } from 'lucide-react'
import { useMemoryStore } from '../store'
import { memoryApi } from '../services/api'
import { Session, Memory as MemoryType } from '../types'

export default function Memory() {
  const { sessions, setSessions } = useMemoryStore()
  const [activeTab, setActiveTab] = useState<'sessions' | 'longterm'>('sessions')
  const [memories, setMemories] = useState<MemoryType[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [newMemoryContent, setNewMemoryContent] = useState('')

  useEffect(() => {
    fetchSessions()
  }, [])

  const fetchSessions = async () => {
    try {
      const response = await memoryApi.listSessions()
      setSessions(response.data)
    } catch (error) {
      console.error('Failed to fetch sessions:', error)
    }
  }

  const fetchMessages = async (sessionId: string) => {
    try {
      const response = await memoryApi.getMessages(sessionId)
      setMessages(response.data)
    } catch (error) {
      console.error('Failed to fetch messages:', error)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    try {
      const response = await memoryApi.searchLongTerm(searchQuery, 10)
      setMemories(response.data)
    } catch (error) {
      console.error('Failed to search memories:', error)
    }
  }

  const handleCreateSession = async () => {
    try {
      const response = await memoryApi.createSession('新会话')
      fetchSessions()
    } catch (error) {
      console.error('Failed to create session:', error)
    }
  }

  const handleDeleteSession = async (id: string) => {
    if (!confirm('确定要删除这个会话吗？')) return
    try {
      await memoryApi.deleteSession(id)
      fetchSessions()
      if (selectedSession?.session_id === id) {
        setSelectedSession(null)
        setMessages([])
      }
    } catch (error) {
      console.error('Failed to delete session:', error)
    }
  }

  const handleAddMemory = async () => {
    if (!newMemoryContent.trim()) return
    try {
      await memoryApi.addLongTerm(newMemoryContent, { type: 'manual' })
      setIsModalOpen(false)
      setNewMemoryContent('')
      if (activeTab === 'longterm') {
        handleSearch()
      }
    } catch (error) {
      console.error('Failed to add memory:', error)
    }
  }

  const handleSaveSession = async (sessionId: string) => {
    try {
      await memoryApi.saveSession(sessionId)
      alert('会话已保存到长期记忆')
    } catch (error) {
      console.error('Failed to save session:', error)
    }
  }

  const selectSession = (session: Session) => {
    setSelectedSession(session)
    fetchMessages(session.session_id)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">记忆管理</h2>
          <p className="text-slate-400 mt-1">管理会话记忆和长期记忆</p>
        </div>
        <div className="flex gap-3">
          {activeTab === 'sessions' ? (
            <button
              onClick={handleCreateSession}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              新建会话
            </button>
          ) : (
            <button
              onClick={() => setIsModalOpen(true)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              添加记忆
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-slate-700/50">
        <button
          onClick={() => setActiveTab('sessions')}
          className={`pb-3 px-2 text-sm font-medium transition-colors relative ${
            activeTab === 'sessions' ? 'text-primary-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            会话记忆
          </div>
          {activeTab === 'sessions' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-500" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('longterm')}
          className={`pb-3 px-2 text-sm font-medium transition-colors relative ${
            activeTab === 'longterm' ? 'text-primary-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4" />
            长期记忆
          </div>
          {activeTab === 'longterm' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-500" />
          )}
        </button>
      </div>

      {/* Sessions Tab */}
      {activeTab === 'sessions' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Session List */}
          <div className="glass rounded-xl p-4">
            <h3 className="font-semibold text-slate-100 mb-4">会话列表</h3>
            <div className="space-y-2 max-h-[500px] overflow-auto">
              {sessions.map((session) => (
                <div
                  key={session.session_id}
                  onClick={() => selectSession(session)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedSession?.session_id === session.session_id
                      ? 'bg-primary-500/10 border border-primary-500/30'
                      : 'hover:bg-dark-700/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-200">
                      {session.context?.title || '未命名会话'}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSaveSession(session.session_id)
                        }}
                        className="p-1.5 rounded hover:bg-dark-600 text-slate-400 hover:text-emerald-400"
                        title="保存到长期记忆"
                      >
                        <Save className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteSession(session.session_id)
                        }}
                        className="p-1.5 rounded hover:bg-dark-600 text-slate-400 hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
                    <span>{session.message_count} 条消息</span>
                    <span>{new Date(session.updated_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
              {sessions.length === 0 && (
                <div className="text-center py-8 text-slate-500">
                  暂无会话
                </div>
              )}
            </div>
          </div>

          {/* Message View */}
          <div className="lg:col-span-2 glass rounded-xl p-4">
            <h3 className="font-semibold text-slate-100 mb-4">
              {selectedSession ? '消息记录' : '选择会话查看消息'}
            </h3>
            {selectedSession ? (
              <div className="space-y-3 max-h-[500px] overflow-auto">
                {messages.map((msg, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded-lg ${
                      msg.role === 'user' 
                        ? 'bg-primary-500/10 ml-8' 
                        : 'bg-dark-700/50 mr-8'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-medium ${
                        msg.role === 'user' ? 'text-primary-400' : 'text-accent-purple'
                      }`}>
                        {msg.role === 'user' ? '用户' : 'AI'}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(msg.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-slate-200">{msg.content}</p>
                  </div>
                ))}
                {messages.length === 0 && (
                  <div className="text-center py-8 text-slate-500">
                    暂无消息
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-slate-500">
                请从左侧选择一个会话
              </div>
            )}
          </div>
        </div>
      )}

      {/* Long-term Memory Tab */}
      {activeTab === 'longterm' && (
        <div className="space-y-4">
          {/* Search */}
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="搜索长期记忆..."
                className="w-full pl-10 pr-4 py-2 bg-dark-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              />
            </div>
            <button
              onClick={handleSearch}
              className="btn-primary flex items-center gap-2"
            >
              <Search className="w-4 h-4" />
              搜索
            </button>
          </div>

          {/* Results */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {memories.map((memory) => (
              <div key={memory.id} className="glass rounded-xl p-4">
                <p className="text-sm text-slate-200 line-clamp-3">{memory.content}</p>
                <div className="flex items-center justify-between mt-3">
                  <div className="text-xs text-slate-500">
                    {memory.metadata?.timestamp && (
                      <span>{new Date(memory.metadata.timestamp).toLocaleString()}</span>
                    )}
                    {memory.distance !== undefined && (
                      <span className="ml-2 text-primary-400">
                        相似度: {(1 - memory.distance).toFixed(2)}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      await memoryApi.deleteLongTerm(memory.id)
                      handleSearch()
                    }}
                    className="p-1.5 rounded hover:bg-dark-700 text-slate-400 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {memories.length === 0 && searchQuery && (
            <div className="text-center py-16 text-slate-500">
              未找到相关记忆
            </div>
          )}
        </div>
      )}

      {/* Add Memory Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass rounded-xl w-full max-w-lg">
            <div className="p-6 border-b border-slate-700/50">
              <h3 className="text-xl font-semibold text-slate-100">添加长期记忆</h3>
            </div>
            <div className="p-6 space-y-4">
              <textarea
                value={newMemoryContent}
                onChange={(e) => setNewMemoryContent(e.target.value)}
                className="input-field h-32 resize-none"
                placeholder="输入记忆内容..."
              />
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setIsModalOpen(false)
                    setNewMemoryContent('')
                  }}
                  className="btn-secondary"
                >
                  取消
                </button>
                <button onClick={handleAddMemory} className="btn-primary">
                  添加
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
