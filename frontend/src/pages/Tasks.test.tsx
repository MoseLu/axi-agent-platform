import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Tasks from './Tasks'

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('../services/api', () => ({ tasksApi: api }))

describe('Tasks page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.list.mockResolvedValue({ data: [] })
    api.create.mockResolvedValue({ data: { id: 'task-1' } })
  })

  it('shows the empty state and submits a task through the API boundary', async () => {
    const user = userEvent.setup()
    render(<Tasks />)

    expect(await screen.findByRole('heading', { name: '任务管理' })).toBeInTheDocument()
    expect(screen.getByText('暂无任务')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '创建任务' }))
    await user.type(screen.getByLabelText('标题'), '检查工作区')
    await user.type(screen.getByLabelText('描述'), '运行前端测试审计')
    await user.click(screen.getByRole('button', { name: /^创建$/ }))

    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      title: '检查工作区',
      description: '运行前端测试审计',
      strategy_mode: 'auto',
    })))
    expect(screen.queryByRole('heading', { name: '创建任务' })).not.toBeInTheDocument()
  })
})
