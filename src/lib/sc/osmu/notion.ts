// 노션 API 얇은 클라이언트(내부 통합 토큰). API 2025-09-03 — 조회는 data source 단위.
// 실연동 미검증: 사용자가 「Workdeck」 통합을 만들고 두 DB 를 공유한 뒤 확인한다.

import type { NotionBlock } from './notion-blocks'
import type { NotionPage } from './notion-schema'

const API = 'https://api.notion.com/v1'
const VERSION = '2025-09-03'

export class NotionError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': VERSION,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const body = (await res.json().catch(() => ({}))) as T & { message?: string }
  if (!res.ok)
    throw new NotionError(`노션 API 오류(${res.status}): ${body.message ?? ''}`, res.status)
  return body
}

type Paged<T> = { results: T[]; has_more: boolean; next_cursor: string | null }

/** data source 행 조회(필터). 최대 maxPages 페이지까지만 — 나머지는 다음 cron. */
export async function queryDataSource(
  token: string,
  dataSourceId: string,
  filter: unknown,
  maxPages = 5
): Promise<NotionPage[]> {
  const out: NotionPage[] = []
  let cursor: string | null = null
  for (let i = 0; i < maxPages; i++) {
    const page: Paged<NotionPage> = await call(token, `/data_sources/${dataSourceId}/query`, {
      method: 'POST',
      body: JSON.stringify({ filter, page_size: 100, ...(cursor && { start_cursor: cursor }) }),
    })
    out.push(...page.results)
    if (!page.has_more) break
    cursor = page.next_cursor
  }
  return out
}

export function getPage(token: string, pageId: string): Promise<NotionPage> {
  return call(token, `/pages/${pageId}`)
}

/** 페이지 본문 블록을 깊이 우선으로 평탄화(하위 depth 3, 블록 1000개까지). */
export async function listPageBlocks(token: string, pageId: string): Promise<NotionBlock[]> {
  const out: NotionBlock[] = []
  async function walk(id: string, depth: number) {
    let cursor: string | null = null
    do {
      const qs = `page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`
      const page: Paged<NotionBlock> = await call(token, `/blocks/${id}/children?${qs}`)
      for (const b of page.results) {
        if (out.length >= 1000) return
        out.push(b)
        if (b.has_children && depth < 3 && b.type !== 'child_page' && b.type !== 'child_database') {
          await walk(b.id, depth + 1)
        }
      }
      cursor = page.has_more ? page.next_cursor : null
    } while (cursor)
  }
  await walk(pageId, 0)
  return out
}

export function updatePageProperties(
  token: string,
  pageId: string,
  properties: Record<string, unknown>
): Promise<NotionPage> {
  return call(token, `/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ properties }) })
}
