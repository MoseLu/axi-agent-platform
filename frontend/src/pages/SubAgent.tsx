import React, { useEffect, useState } from 'react'
import { Clock, GitBranch, Users, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import { subagentApi } from '../services/api'
import type { WorktreeStats, WorktreeInfo, CodeChanges } from '../types'

export default function SubAgent() {
  const [stats, setStats] = useState<WorktreeStats | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [changes, setChanges] = useState<CodeChanges | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
  }, [])

  const loadStats = async () => {
    try {
      setLoading(true)
      const response = await subagentApi.getWorktreeStats()
      setStats(response.data.data)
    } catch (error) {
      console.error('Failed to load worktree stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadChanges = async (agentId: string) => {
    try {
      const response = await subagentApi.getWorktreeChanges(agentId)
      setChanges(response.data.changes)
      setSelectedAgent(agentId)
    } catch (error) {
      console.error('Failed to load changes:', error)
    }
  }

  const handleSync = async (agentId: string) => {
    try {
      await subagentApi.syncWorktree({ agent_id: agentId, fetch: true })
      loadStats()
      if (selectedAgent === agentId) {
        loadChanges(agentId)
      }
    } catch (error) {
      console.error('Failed to sync worktree:', error)
    }
  }

  const handleCommit = async (agentId: string) => {
    const message = prompt('Enter commit message:')
    if (!message) return

    try {
      await subagentApi.commitWorktree({ agent_id: agentId, message })
      alert('Changes committed successfully')
      loadStats()
    } catch (error) {
      console.error('Failed to commit changes:', error)
      alert('Failed to commit changes')
    }
  }

  const handleMerge = async (agentId: string) => {
    if (!confirm('Are you sure you want to merge this worktree to main branch?')) {
      return
    }

    try {
      const result = await subagentApi.mergeWorktree({ agent_id: agentId, target_branch: 'main' })

      if (result.data.success) {
        alert('Merge completed successfully')
      } else {
        alert('Merge failed due to conflicts. Please resolve conflicts manually.')
      }
      loadStats()
    } catch (error) {
      console.error('Failed to merge worktree:', error)
      alert('Failed to merge worktree')
    }
  }

  const handleRemove = async (agentId: string) => {
    if (!confirm('Are you sure you want to remove this worktree?')) {
      return
    }

    try {
      await subagentApi.removeWorktree(agentId)
      setChanges(null)
      setSelectedAgent(null)
      loadStats()
    } catch (error) {
      console.error('Failed to remove worktree:', error)
      alert('Failed to remove worktree')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-card rounded-lg p-4 text-white">
        <p className="text-sm font-semibold text-ink">SubAgent 协作模式</p>
        <p className="mt-1 text-xs text-ink-muted/70">
          代码开发专用智能体协作 - 支持 Git worktrees 隔离和多智能体并行开发
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Worktrees"
          value={stats?.total_worktrees || 0}
          total={stats?.max_worktrees || 10}
          icon={<GitBranch className="w-6 h-6" />}
          color="blue"
        />
        <StatCard
          title="Available"
          value={stats?.available_worktrees || 0}
          icon={<Users className="w-6 h-6" />}
          color="green"
        />
        <StatCard
          title="Active Agents"
          value={stats?.total_worktrees || 0}
          icon={<Users className="w-6 h-6" />}
          color="purple"
        />
        <StatCard
          title="Repository"
          value={stats?.base_repo_path || './projects'}
          icon={<GitBranch className="w-6 h-6" />}
          color="gray"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Worktrees List */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-bold mb-4 text-white">Active Worktrees</h2>
          {stats?.worktrees && stats.worktrees.length > 0 ? (
            <div className="space-y-3">
              {stats.worktrees.map((wt) => (
                <WorktreeItem
                  key={wt.agent_id}
                  worktree={wt}
                  selected={selectedAgent === wt.agent_id}
                  onSelect={() => loadChanges(wt.agent_id)}
                  onSync={() => handleSync(wt.agent_id)}
                  onCommit={() => handleCommit(wt.agent_id)}
                  onMerge={() => handleMerge(wt.agent_id)}
                  onRemove={() => handleRemove(wt.agent_id)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <GitBranch className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No active worktrees</p>
              <p className="text-sm mt-2">Create a code development task to start</p>
            </div>
          )}
        </div>

        {/* Code Changes */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-bold mb-4 text-white">
            Code Changes {selectedAgent && `- Agent ${selectedAgent}`}
          </h2>
          {changes ? (
            <div className="space-y-4">
              <ChangeSection
                title="Added Files"
                files={changes.added}
                icon={<CheckCircle className="w-4 h-4 text-green-500" />}
                color="green"
              />
              <ChangeSection
                title="Modified Files"
                files={changes.modified}
                icon={<AlertTriangle className="w-4 h-4 text-yellow-500" />}
                color="yellow"
              />
              <ChangeSection
                title="Deleted Files"
                files={changes.deleted}
                icon={<XCircle className="w-4 h-4 text-red-500" />}
                color="red"
              />
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Select a worktree to view changes</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  total,
  icon,
  color
}: {
  title: string
  value: number | string
  total?: number
  icon: React.ReactNode
  color: 'blue' | 'green' | 'purple' | 'gray'
}) {
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
    gray: 'bg-gray-500'
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-2">
        <div className={`${colorClasses[color]} p-3 rounded-lg`}>
          {icon}
        </div>
        {total !== undefined && (
          <span className="text-sm text-gray-400">
            {value}/{total}
          </span>
        )}
      </div>
      <h3 className="text-gray-400 text-sm mb-1">{title}</h3>
      <p className="text-white text-2xl font-bold">{value}</p>
    </div>
  )
}

function WorktreeItem({
  worktree,
  selected,
  onSelect,
  onSync,
  onCommit,
  onMerge,
  onRemove
}: {
  worktree: WorktreeInfo
  selected: boolean
  onSelect: () => void
  onSync: () => void
  onCommit: () => void
  onMerge: () => void
  onRemove: () => void
}) {
  return (
    <div
      className={`p-4 rounded-lg border-2 transition-all ${
        selected ? 'border-blue-500 bg-blue-900/20' : 'border-gray-700 bg-gray-700/30'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-white font-semibold mb-1">Agent: {worktree.agent_id}</h3>
          <p className="text-sm text-gray-400">{worktree.branch}</p>
        </div>
        <GitBranch className="w-5 h-5 text-blue-500" />
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Created: {new Date(worktree.created_at).toLocaleString()}
      </p>
      <div className="flex gap-2">
        <button
          onClick={onSelect}
          className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
        >
          View Changes
        </button>
        <button
          onClick={onSync}
          className="flex-1 px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 transition-colors text-sm"
        >
          Sync
        </button>
        <button
          onClick={onCommit}
          className="flex-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
        >
          Commit
        </button>
        <button
          onClick={onMerge}
          className="flex-1 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
        >
          Merge
        </button>
        <button
          onClick={onRemove}
          className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

function ChangeSection({
  title,
  files,
  icon,
  color
}: {
  title: string
  files: string[]
  icon: React.ReactNode
  color: 'green' | 'yellow' | 'red'
}) {
  const bgColors = {
    green: 'bg-green-900/30',
    yellow: 'bg-yellow-900/30',
    red: 'bg-red-900/30'
  }

  return (
    <div className={`${bgColors[color]} rounded-lg p-4`}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-white font-semibold">{title}</h3>
        <span className="ml-auto text-gray-400 text-sm">{files.length}</span>
      </div>
      {files.length > 0 ? (
        <ul className="space-y-1">
          {files.map((file, idx) => (
            <li key={idx} className="text-gray-300 text-sm font-mono">
              {file}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-500 text-sm">No files</p>
      )}
    </div>
  )
}
