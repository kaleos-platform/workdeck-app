import type {
  KeywordMasterSource,
  KeywordMasterStatus,
  KeywordMasterType,
} from '@/generated/prisma/enums'

/**
 * 키워드 마스터 일괄 생성 헬퍼 — POST /api/sh/keywords 를 키워드 수만큼 호출한다.
 *
 * 일괄 생성 API 는 없다(/api/sh/keywords/bulk 는 status·delete·link 만 지원).
 * 한 번에 다루는 개수가 최대 30개라 순차 호출로 충분하고, 순차로 돌려야 어느
 * 키워드가 실패했는지 그대로 짚어줄 수 있다.
 *
 * **409 는 실패가 아니다.** `@@unique([spaceId, normalized])` 충돌이면 라우트가
 * 409 + 기존 행을 돌려주므로 "이미 있음"으로 집계하고 그 id 를 그대로 이어받는다
 * (연결 생성에 쓴다).
 */

export type KeywordCreateAttrs = {
  category?: string | null
  type?: KeywordMasterType
  source?: KeywordMasterSource
  status?: KeywordMasterStatus
}

export type KeywordCreateResult = {
  /** 새로 만든 건수 (201) */
  added: number
  /** 이미 있던 건수 (409) */
  existed: number
  /** 그 밖의 실패 */
  failed: Array<{ keyword: string; message: string }>
  /** 생성·기존 행의 id — 후속 연결 생성용. id 를 못 받은 건은 빠진다. */
  keywordIds: string[]
  /** 처리에 성공한(추가 또는 이미 있음) 키워드 원문 */
  settled: string[]
}

export async function createKeywords(
  keywords: string[],
  attrs: KeywordCreateAttrs = {},
  onProgress?: (done: number, total: number) => void
): Promise<KeywordCreateResult> {
  const result: KeywordCreateResult = {
    added: 0,
    existed: 0,
    failed: [],
    keywordIds: [],
    settled: [],
  }

  let done = 0
  for (const keyword of keywords) {
    try {
      const res = await fetch('/api/sh/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, ...attrs }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.ok) {
        result.added += 1
        result.settled.push(keyword)
        if (data?.keyword?.id) result.keywordIds.push(data.keyword.id)
      } else if (res.status === 409) {
        result.existed += 1
        result.settled.push(keyword)
        if (data?.keyword?.id) result.keywordIds.push(data.keyword.id)
      } else {
        // errorResponse 는 { message } 로 내려준다. 구버전 호환으로 error 도 함께 본다.
        result.failed.push({
          keyword,
          message: data?.message ?? data?.error ?? '등록에 실패했습니다',
        })
      }
    } catch {
      result.failed.push({ keyword, message: '요청을 보내지 못했습니다' })
    }
    done += 1
    onProgress?.(done, keywords.length)
  }

  return result
}

/** "3건 추가, 2건 이미 있음" 형태의 결과 요약 문구. */
export function summarizeKeywordCreate(result: KeywordCreateResult) {
  const parts = [`${result.added}건 추가`]
  if (result.existed > 0) parts.push(`${result.existed}건 이미 있음`)
  if (result.failed.length > 0) parts.push(`${result.failed.length}건 실패`)
  return parts.join(', ')
}
