import type { Prisma } from '@/generated/prisma/client'
import { hmacHash, normalizeName, normalizePhone } from './pii'

// 검색 원문은 POST 본문으로만 받고, 목록 URL에는 기존 검색용 HMAC만 전달한다.
export function buildApplicantSearchToken(input: string): string {
  if (typeof input !== 'string' || input.length > 200)
    throw new Error('검색어는 200자 이내로 입력하세요')
  const name = normalizeName(input)
  if (!name) return ''
  const nameHash = hmacHash(name)
  const digits = normalizePhone(name)
  if (/^[\d\s()+-]+$/.test(name) && digits.length >= 4) {
    return `${nameHash}.${digits.length === 4 ? 'last' : 'phone'}.${hmacHash(digits)}`
  }
  return nameHash
}

export function applicantSearchWhere(token?: string): Prisma.HiringApplicationWhereInput {
  if (!token) return {}
  const match = /^([a-f0-9]{64})(?:\.(phone|last)\.([a-f0-9]{64}))?$/.exec(token)
  // 잘못된 검색값을 무시하면 전체 지원자가 표시되므로 결과 없음으로 처리한다.
  if (!match) return { id: { in: [] } }
  return {
    OR: [
      { nameHash: match[1] },
      ...(match[2] === 'phone' ? [{ phoneHash: match[3] }] : []),
      ...(match[2] === 'last' ? [{ phoneLastDigitsHash: match[3] }] : []),
    ],
  }
}
