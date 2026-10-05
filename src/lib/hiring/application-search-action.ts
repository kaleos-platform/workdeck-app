'use server'

import { resolveDeckContext } from '@/lib/api-helpers'
import { buildApplicantSearchToken } from '@/lib/hiring/application-search'

export async function createApplicantSearch(input: string): Promise<string> {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) throw new Error('지원자 검색 권한을 확인해 주세요')
  return buildApplicantSearchToken(input)
}
