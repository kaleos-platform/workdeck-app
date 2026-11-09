// 노션 「콘텐츠 소재」「콘텐츠 발행」 데이터 소스의 고정 속성 이름과 상태 라벨.
// 상태는 status 가 아니라 select 속성이다(옵션을 API 로 확실히 관리하기 위해).

export const SOURCE_PROPS = {
  title: '제목',
  eventDate: '행사일',
  place: '장소/대상',
  org: '기관',
  products: '사용 상품',
  mediaFolder: '미디어 폴더',
} as const

export const REQUEST_PROPS = {
  title: '제목',
  source: '소재',
  kind: '유형',
  brief: '관점·요청 사항',
  desiredDate: '희망 발행일',
  basedOn: '바탕 결과물',
  status: '상태',
  resultUrl: '결과 링크',
  workdeckUrl: 'Workdeck 링크',
} as const

/** 사람이 쓰는 상태는 REQUESTED·CANCELED 뿐. 나머지는 Workdeck 이 덮어쓴다. */
export const NOTION_STATUS = {
  REQUESTED: '작성 요청',
  WRITING: '작성 중',
  AWAITING_APPROVAL: '승인 대기',
  AWAITING_PHOTOS: '사진 대기',
  PUBLISHING: '예약/게시 중',
  DRAFT_CHECK: '임시저장 확인 필요',
  NEEDS_REVIEW: '확인 필요',
  PUBLISHED: '게시 완료',
  CANCELED: '취소',
} as const
export type NotionStatusLabel = (typeof NOTION_STATUS)[keyof typeof NOTION_STATUS]

/** 발행 유형(select). P1 은 블로그만 작성한다. */
export const REQUEST_KINDS = [
  '블로그',
  '보도자료',
  '인스타그램',
  '스레드',
  '영상 대본',
  '카드뉴스',
] as const

// ─── 노션 페이지 속성 → 값 (응답 형태 중 쓰는 부분만) ──────────────────────

type RichText = { plain_text: string }
export type NotionProperty =
  | { type: 'title'; title: RichText[] }
  | { type: 'rich_text'; rich_text: RichText[] }
  | { type: 'select'; select: { name: string } | null }
  | { type: 'multi_select'; multi_select: { name: string }[] }
  | { type: 'date'; date: { start: string } | null }
  | { type: 'url'; url: string | null }
  | { type: 'relation'; relation: { id: string }[] }
  | { type: string; [k: string]: unknown }

export type NotionPage = {
  id: string
  last_edited_time: string
  properties: Record<string, NotionProperty>
}

export function propText(p: NotionProperty | undefined): string {
  if (!p) return ''
  if (p.type === 'title')
    return (p as { title: RichText[] }).title.map((t) => t.plain_text).join('')
  if (p.type === 'rich_text')
    return (p as { rich_text: RichText[] }).rich_text.map((t) => t.plain_text).join('')
  if (p.type === 'select') return (p as { select: { name: string } | null }).select?.name ?? ''
  if (p.type === 'url') return (p as { url: string | null }).url ?? ''
  if (p.type === 'date') return (p as { date: { start: string } | null }).date?.start ?? ''
  if (p.type === 'multi_select')
    return (p as { multi_select: { name: string }[] }).multi_select.map((o) => o.name).join(', ')
  return ''
}

export function propRelationIds(p: NotionProperty | undefined): string[] {
  return p?.type === 'relation'
    ? (p as { relation: { id: string }[] }).relation.map((r) => r.id)
    : []
}

/** 수신 시점에 고정하는 요청 필드. 이후 노션 수정은 반영하지 않는다(새 요청으로 안내). */
export type RequestSnapshot = {
  title: string
  kind: string
  brief: string
  desiredDate: string | null
  sourcePageIds: string[]
  basedOnPageIds: string[]
}

export function readRequestSnapshot(page: NotionPage): RequestSnapshot {
  const p = page.properties
  return {
    title: propText(p[REQUEST_PROPS.title]).trim(),
    kind: propText(p[REQUEST_PROPS.kind]).trim(),
    brief: propText(p[REQUEST_PROPS.brief]).trim(),
    desiredDate: propText(p[REQUEST_PROPS.desiredDate]) || null,
    sourcePageIds: propRelationIds(p[REQUEST_PROPS.source]),
    basedOnPageIds: propRelationIds(p[REQUEST_PROPS.basedOn]),
  }
}

/** 드라이브 폴더 링크에서 폴더 id 를 뽑는다(…/folders/{id}). 아니면 null. */
export function driveFolderIdFromUrl(url: string): string | null {
  const m = url.match(/\/folders\/([A-Za-z0-9_-]{10,})/)
  return m ? m[1] : null
}

// 연결 검사에 쓰는 필수 속성(이름 → 유형). 나머지는 비어 있어도 동작한다.
const REQUIRED_SOURCE: Record<string, string> = {
  [SOURCE_PROPS.title]: 'title',
  [SOURCE_PROPS.mediaFolder]: 'url',
}
const REQUIRED_REQUEST: Record<string, string> = {
  [REQUEST_PROPS.title]: 'title',
  [REQUEST_PROPS.status]: 'select',
  [REQUEST_PROPS.source]: 'relation',
  [REQUEST_PROPS.kind]: 'select',
}

function missing(schema: Record<string, string>, required: Record<string, string>): string[] {
  return Object.entries(required)
    .filter(([name, type]) => schema[name] !== type)
    .map(([name, type]) => `${name}(${type})`)
}

/** 두 DB 의 속성을 검사해 사람이 고칠 문구를 돌려준다. 문제 없으면 null. */
export function connectionSchemaError(
  source: Record<string, string>,
  request: Record<string, string>
): string | null {
  const s = missing(source, REQUIRED_SOURCE)
  const r = missing(request, REQUIRED_REQUEST)
  if (s.length === 0 && r.length === 0) return null
  // 두 칸이 서로 바뀐 경우를 먼저 알려준다.
  if (
    missing(request, REQUIRED_SOURCE).length === 0 &&
    missing(source, REQUIRED_REQUEST).length === 0
  ) {
    return '「콘텐츠 소재」와 「콘텐츠 발행」 링크가 서로 바뀌었습니다'
  }
  const parts = []
  if (s.length) parts.push(`「콘텐츠 소재」 DB에 ${s.join(', ')} 속성이 없습니다`)
  if (r.length) parts.push(`「콘텐츠 발행」 DB에 ${r.join(', ')} 속성이 없습니다`)
  return `${parts.join(' / ')} — 링크가 맞는지 확인하세요`
}
