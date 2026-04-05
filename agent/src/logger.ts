import * as api from './workdeck-client'

const WORKSPACE_ID = process.env.WORKDECK_WORKSPACE_ID || ''
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || ''

type LogType = 'command' | 'notification' | 'error'

/** 에이전트 활동을 워크덱 DB에 기록 */
export async function logActivity(params: {
  type: LogType
  command?: string
  response?: string
}) {
  if (!WORKSPACE_ID) return

  try {
    await api.workerPost('/api/deck-agents/logs', {
      workspaceId: WORKSPACE_ID,
      type: params.type,
      command: params.command ?? null,
      response: params.response ?? null,
      channel: CHANNEL_ID || null,
    })
  } catch {
    // 로그 기록 실패해도 에이전트 동작에 영향 없음
  }
}
