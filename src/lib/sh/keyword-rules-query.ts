// ChannelKeywordRule 행을 읽어 KeywordRuleSet 으로 해석하고, API 응답용으로 직렬화한다.
//
// 규칙 행이 없는 것이 정상 상태다(= 기본값 사용). 그래서 조회 실패는 404 가 아니라
// DEFAULT_KEYWORD_RULES 로 폴백한다.

import { prisma } from '@/lib/prisma'
import {
  resolveKeywordRules,
  withChannelDefaults,
  type BannedTerms,
  type ChannelIdentity,
  type KeywordRuleOverride,
  type KeywordRuleSet,
} from './keyword-rules'

/**
 * NextResponse.json 에 그대로 넣을 수 있는 형태.
 * KeywordRuleSet.specialCharPattern 은 RegExp 라 JSON.stringify 가 `{}` 로 만들어버린다.
 * 값이 사라진 줄 모르고 클라이언트가 쓰는 사고를 막기 위해 아예 필드에서 제외한다.
 * (특수문자 판정은 서버에서만 수행한다.)
 */
export type SerializedKeywordRules = Omit<KeywordRuleSet, 'specialCharPattern'>

export function serializeKeywordRules(rules: KeywordRuleSet): SerializedKeywordRules {
  return {
    maxKeywords: rules.maxKeywords,
    nameTargetMin: rules.nameTargetMin,
    nameTargetMax: rules.nameTargetMax,
    nameSoftMax: rules.nameSoftMax,
    nameHardMax: rules.nameHardMax,
    bannedTerms: rules.bannedTerms,
    specialCharSoftLimit: rules.specialCharSoftLimit,
    channelLimits: rules.channelLimits,
  }
}

const TERM_KEYS: (keyof BannedTerms)[] = [
  'promo',
  'shipping',
  'seller',
  'efficacy',
  'competitorBrand',
]

/** Json 컬럼(신뢰할 수 없는 형태)에서 문자열 배열만 추려낸다. */
export function parseBannedTerms(raw: unknown): Partial<BannedTerms> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const src = raw as Record<string, unknown>
  const out: Partial<BannedTerms> = {}
  for (const key of TERM_KEYS) {
    const list = src[key]
    if (!Array.isArray(list)) continue
    out[key] = list.filter((t): t is string => typeof t === 'string')
  }
  return Object.keys(out).length > 0 ? out : null
}

type RuleRow = {
  maxKeywords: number | null
  nameTargetMin: number | null
  nameTargetMax: number | null
  nameSoftMax: number | null
  nameHardMax: number | null
  bannedTerms: unknown
  replaceDefaultTerms: boolean
}

export function ruleRowToOverride(row: RuleRow | null | undefined): KeywordRuleOverride | null {
  if (!row) return null
  return {
    maxKeywords: row.maxKeywords,
    nameTargetMin: row.nameTargetMin,
    nameTargetMax: row.nameTargetMax,
    nameSoftMax: row.nameSoftMax,
    nameHardMax: row.nameHardMax,
    bannedTerms: parseBannedTerms(row.bannedTerms),
    replaceDefaultTerms: row.replaceDefaultTerms,
  }
}

/**
 * 채널의 키워드 규칙을 해석한다. channelId 가 없거나 규칙 행이 없으면 기본값.
 * spaceId 를 함께 걸어 다른 space 의 규칙이 새지 않게 한다.
 */
export async function loadKeywordRules(
  spaceId: string,
  channelId?: string | null
): Promise<KeywordRuleSet> {
  if (!channelId) return resolveKeywordRules(null)
  const [row, channel] = await Promise.all([
    prisma.channelKeywordRule.findFirst({
      where: { channelId, spaceId },
      select: {
        maxKeywords: true,
        nameTargetMin: true,
        nameTargetMax: true,
        nameSoftMax: true,
        nameHardMax: true,
        bannedTerms: true,
        replaceDefaultTerms: true,
      },
    }),
    prisma.channel.findFirst({
      where: { id: channelId, spaceId },
      select: { name: true, externalSource: true },
    }),
  ])
  const rules = resolveKeywordRules(ruleRowToOverride(row))
  const identity: ChannelIdentity | null = channel
    ? { name: channel.name, externalSource: channel.externalSource }
    : null
  return withChannelDefaults(rules, identity)
}
