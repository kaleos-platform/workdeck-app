import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { generateTextWithFallback } from '@/lib/ai/providers'

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1).max(32000),
})

const bodySchema = z.object({
  system: z.string().max(8000).optional(),
  messages: z.array(messageSchema).min(1).max(40),
  responseFormat: z.enum(['text', 'json']).optional(),
  maxTokens: z.number().int().min(16).max(8192).optional(),
  temperature: z.number().min(0).max(2).optional(),
})

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return errorResponse('요청 본문이 올바르지 않습니다', 400, {
      issues: parsed.error.flatten(),
    })
  }

  try {
    const { result, providerName } = await generateTextWithFallback({
      system: parsed.data.system,
      messages: parsed.data.messages,
      responseFormat: parsed.data.responseFormat,
      maxTokens: parsed.data.maxTokens,
      temperature: parsed.data.temperature,
    })

    await prisma.textGenerationLog.create({
      data: {
        spaceId: resolved.space.id,
        userId: resolved.user.id,
        provider: providerName,
        model: result.model ?? null,
        responseFormat: parsed.data.responseFormat ?? 'text',
        status: 'SUCCEEDED',
        contentPreview: result.content.slice(0, 500),
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        latencyMs: result.latencyMs,
      },
    })

    return NextResponse.json({
      provider: providerName,
      model: result.model,
      content: result.content,
      usage: result.usage,
      latencyMs: result.latencyMs,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.textGenerationLog.create({
      data: {
        spaceId: resolved.space.id,
        userId: resolved.user.id,
        provider: 'unknown',
        responseFormat: parsed.data.responseFormat ?? 'text',
        status: 'FAILED',
        errorMessage: message.slice(0, 500),
      },
    })
    return errorResponse('텍스트 생성에 실패했습니다', 502, { detail: message })
  }
}
