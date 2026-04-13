import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type SettingsResponse = {
  defaultLocationId: string | null
  slackWebhookUrl: string | null
  preferences: Record<string, unknown>
}

function serialize(row: {
  defaultLocationId: string | null
  slackWebhookUrl: string | null
  preferences: unknown
} | null): SettingsResponse {
  if (!row) {
    return {
      defaultLocationId: null,
      slackWebhookUrl: null,
      preferences: {},
    }
  }
  return {
    defaultLocationId: row.defaultLocationId ?? null,
    slackWebhookUrl: row.slackWebhookUrl ?? null,
    preferences:
      row.preferences && typeof row.preferences === 'object'
        ? (row.preferences as Record<string, unknown>)
        : {},
  }
}

// GET /api/inv/settings
export async function GET() {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const row = await prisma.invSettings.findUnique({
    where: { spaceId: resolved.space.id },
    select: {
      defaultLocationId: true,
      slackWebhookUrl: true,
      preferences: true,
    },
  })

  return NextResponse.json({ settings: serialize(row) })
}

// PATCH /api/inv/settings
export async function PATCH(req: NextRequest) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const body = (await req.json().catch(() => ({}))) as {
    defaultLocationId?: string | null
    slackWebhookUrl?: string | null
    preferences?: Record<string, unknown>
  }

  const data: {
    defaultLocationId?: string | null
    slackWebhookUrl?: string | null
    preferences?: Record<string, unknown>
  } = {}

  if ('defaultLocationId' in body) {
    const value = body.defaultLocationId
    if (value === null || value === undefined || value === '') {
      data.defaultLocationId = null
    } else if (typeof value === 'string') {
      const location = await prisma.invStorageLocation.findFirst({
        where: { id: value, spaceId: resolved.space.id },
        select: { id: true },
      })
      if (!location) {
        return errorResponse('해당 위치를 찾을 수 없습니다', 400)
      }
      data.defaultLocationId = value
    } else {
      return errorResponse('defaultLocationId 형식이 올바르지 않습니다', 400)
    }
  }

  if ('slackWebhookUrl' in body) {
    const value = body.slackWebhookUrl
    if (value === null || value === undefined || value === '') {
      data.slackWebhookUrl = null
    } else if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed && !trimmed.startsWith('https://hooks.slack.com/')) {
        return errorResponse(
          'Slack 웹훅 URL은 https://hooks.slack.com/ 으로 시작해야 합니다',
          400,
        )
      }
      data.slackWebhookUrl = trimmed || null
    } else {
      return errorResponse('slackWebhookUrl 형식이 올바르지 않습니다', 400)
    }
  }

  if ('preferences' in body) {
    if (
      body.preferences &&
      typeof body.preferences === 'object' &&
      !Array.isArray(body.preferences)
    ) {
      data.preferences = body.preferences
    } else {
      return errorResponse('preferences 형식이 올바르지 않습니다', 400)
    }
  }

  const updated = await prisma.invSettings.upsert({
    where: { spaceId: resolved.space.id },
    create: {
      spaceId: resolved.space.id,
      defaultLocationId: data.defaultLocationId ?? null,
      slackWebhookUrl: data.slackWebhookUrl ?? null,
      preferences: (data.preferences ?? {}) as Prisma.InputJsonValue,
    },
    update: {
      ...(data.defaultLocationId !== undefined && {
        defaultLocationId: data.defaultLocationId,
      }),
      ...(data.slackWebhookUrl !== undefined && {
        slackWebhookUrl: data.slackWebhookUrl,
      }),
      ...(data.preferences !== undefined && {
        preferences: data.preferences as Prisma.InputJsonValue,
      }),
    },
    select: {
      defaultLocationId: true,
      slackWebhookUrl: true,
      preferences: true,
    },
  })

  return NextResponse.json({ settings: serialize(updated) })
}
