// /settings/integrations 하위 컴포넌트 공용 타입 — /api/agent/settings, /api/slack/channels 응답 형태.

export type SlackChannelKind = 'approvals' | 'notifications'

export type SlackChannelDTO = {
  id: string
  channelId: string
  channelName: string | null
  kind: string
  createdAt: string
}

export type SlackChannelsResponse = {
  installed: boolean
  installation: { teamName: string | null; createdAt: string } | null
  channels: SlackChannelDTO[]
}

export type AgentSettingsResponse = {
  agentActive: boolean
  usage: {
    requestCount: number
    dailyLimit: number
    inputTokens: number
    outputTokens: number
  }
  slack: {
    installed: boolean
    teamName: string | null
    connectedAt: string | null
  }
}
