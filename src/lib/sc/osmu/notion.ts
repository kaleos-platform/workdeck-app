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

/** 노션 DB 링크·id → 32자 id(하이픈 제거). 못 찾으면 null. */
export function notionIdFromInput(input: string): string | null {
  const m =
    input.replace(/-/g, '').match(/([0-9a-f]{32})(?:\?|$|#)/i) ??
    input.replace(/-/g, '').match(/([0-9a-f]{32})/i)
  return m ? m[1].toLowerCase() : null
}

/** 데이터베이스(링크로 받은 것)의 첫 data source id. 통합이 공유되지 않았으면 404. */
export async function resolveDataSourceId(token: string, databaseId: string): Promise<string> {
  const db = await call<{ data_sources?: { id: string }[] }>(token, `/databases/${databaseId}`)
  const id = db.data_sources?.[0]?.id
  if (!id) throw new NotionError('데이터 소스가 없는 데이터베이스입니다', 400)
  return id
}

/** data source 의 속성 이름 → 유형. 연결 시 DB 를 잘못 넣었는지 검사용. */
export async function getDataSourceSchema(
  token: string,
  dataSourceId: string
): Promise<Record<string, string>> {
  const ds = await call<{ properties: Record<string, { type: string }> }>(
    token,
    `/data_sources/${dataSourceId}`
  )
  return Object.fromEntries(Object.entries(ds.properties).map(([k, v]) => [k, v.type]))
}

/** data source 에 행(페이지) 생성. */
export function createPage(
  token: string,
  dataSourceId: string,
  properties: Record<string, unknown>
): Promise<NotionPage & { url: string }> {
  return call(token, '/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties,
    }),
  })
}
