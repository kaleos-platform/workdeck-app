// 워크스페이스 AI 설정(BYOK / 워크덱 제공)에 따라 텍스트 공급자를 고르고 실행한다.
//
// 배포 환경 진입점. providers/index.ts 의 generateTextWithFallback 은 로컬 CLI 체인이라
// Vercel 서버리스에서 동작하지 않으므로, spaceId 를 아는 호출부는 이 함수를 쓴다.

import { prisma } from '@/lib/prisma'
import type { SpaceAiProvider } from '@/generated/prisma/enums'
import { decryptPii } from '@/lib/del/encryption'
import type { TextGenerateRequest, TextGenerateResult, TextProvider } from './providers'
import { OpenAiProvider } from './providers/text-openai'
import { AnthropicProvider } from './providers/text-anthropic'
import { GeminiApiProvider } from './providers/text-gemini-api'
import { CodexCliProvider } from './providers/text-codex'
import { GeminiCliProvider } from './providers/text-gemini'
import { checkTextQuota, recordTextUsage } from './credit'

export type ResolvedAiMode = 'BYOK' | 'WORKDECK' | 'LOCAL_CLI'

export class AiNotConfiguredError extends Error {
  readonly code = 'AI_NOT_CONFIGURED' as const
}

export class ByokKeyError extends Error {
  readonly code = 'BYOK_KEY_ERROR' as const
}

/** 워크덱 명의 기본 공급자 — 서버 env 키. 우선순위: Gemini → OpenAI → Anthropic */
export function workdeckProvider(): TextProvider | null {
  const candidates = [new GeminiApiProvider(), new OpenAiProvider(), new AnthropicProvider()]
  return candidates.find((p) => p.isConfigured()) ?? null
}

export function byokProvider(
  provider: SpaceAiProvider,
  apiKey: string,
  model?: string | null
): TextProvider {
  switch (provider) {
    case 'OPENAI':
      return new OpenAiProvider({ apiKey, model: model ?? undefined })
    case 'ANTHROPIC':
      return new AnthropicProvider({ apiKey, model: model ?? undefined })
    case 'GEMINI':
      return new GeminiApiProvider({ apiKey, model: model ?? undefined })
  }
}

/** 로컬 개발 편의 — CLI 바이너리가 있으면 그쪽을 먼저 쓴다. Vercel 에서는 항상 null. */
function localCliProvider(): TextProvider | null {
  const codex = new CodexCliProvider()
  if (codex.isConfigured()) return codex
  const gemini = new GeminiCliProvider()
  if (gemini.isConfigured()) return gemini
  return null
}

export interface SpaceAiResolution {
  mode: ResolvedAiMode
  provider: TextProvider
  /** WORKDECK 모드에서만 true — 호출 후 토큰을 쿼터에 누적한다 */
  meterQuota: boolean
}

/**
 * 설정을 읽어 공급자를 결정한다. 실제 호출은 하지 않는다(verify 등에서 재사용).
 * BYOK 설정이 있으면 최우선 — 사용자가 명시적으로 고른 것이므로 로컬 CLI 로 새지 않는다.
 */
export async function resolveSpaceAiProvider(spaceId: string): Promise<SpaceAiResolution> {
  const setting = await prisma.spaceAiSetting.findUnique({ where: { spaceId } })

  if (setting?.mode === 'BYOK') {
    if (!setting.provider || !setting.encryptedApiKey || !setting.apiKeyIv) {
      throw new ByokKeyError('AI 키가 저장되어 있지 않습니다. 설정에서 키를 등록하세요')
    }
    let apiKey: string
    try {
      apiKey = decryptPii(setting.encryptedApiKey, setting.apiKeyIv)
    } catch {
      // 복호화 실패(ENCRYPTION_KEY 교체 등) — 원문이 로그·응답에 새지 않도록 메시지 고정
      throw new ByokKeyError('저장된 AI 키를 복호화할 수 없습니다. 키를 다시 등록해주세요')
    }
    return {
      mode: 'BYOK',
      provider: byokProvider(setting.provider, apiKey, setting.model),
      meterQuota: false,
    }
  }

  // WORKDECK 모드. 로컬 개발 환경에 CLI 가 있으면 비용 없이 그쪽을 쓴다.
  const cli = localCliProvider()
  if (cli) return { mode: 'LOCAL_CLI', provider: cli, meterQuota: false }

  const workdeck = workdeckProvider()
  if (!workdeck) {
    throw new AiNotConfiguredError(
      '워크덱 제공 AI가 구성되지 않았습니다. 설정에서 직접 보유한 AI 키를 등록해주세요'
    )
  }
  return { mode: 'WORKDECK', provider: workdeck, meterQuota: true }
}

/**
 * 워크스페이스 설정에 맞는 공급자로 텍스트를 생성한다.
 *
 * BYOK 는 폴백하지 않는다 — 사용자가 고른 공급자가 실패했다는 사실 자체를 알아야 하고,
 * 조용히 워크덱 쿼터를 대신 태우면 비용 주체가 뒤바뀐다. 실패는 lastError 에 기록된다.
 */
export async function generateTextForSpace(
  spaceId: string,
  req: TextGenerateRequest
): Promise<{ result: TextGenerateResult; providerName: string; mode: ResolvedAiMode }> {
  const resolution = await resolveSpaceAiProvider(spaceId)

  if (resolution.meterQuota) await checkTextQuota(spaceId)

  try {
    const result = await resolution.provider.generate(req)
    if (resolution.meterQuota && result.usage) {
      await recordTextUsage(spaceId, result.usage)
    }
    if (resolution.mode === 'BYOK') {
      await prisma.spaceAiSetting.update({
        where: { spaceId },
        data: { lastVerifiedAt: new Date(), lastError: null },
      })
    }
    return { result, providerName: resolution.provider.name, mode: resolution.mode }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (resolution.mode === 'BYOK') {
      await prisma.spaceAiSetting
        .update({ where: { spaceId }, data: { lastError: message.slice(0, 500) } })
        .catch(() => {})
    }
    throw err
  }
}
