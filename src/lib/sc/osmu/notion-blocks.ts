// 노션 블록 → 서식 없는 평문. 근거(evidence) 위치를 블록 id 로 되짚을 수 있게 구간을 함께 돌려준다.

type RichText = { plain_text: string }
export type NotionBlock = {
  id: string
  type: string
  has_children?: boolean
  [k: string]: unknown
}

export type TextSegment = { blockId: string; start: number; end: number }
export type BlocksText = { text: string; segments: TextSegment[]; hasImages: boolean }

const PREFIX: Record<string, string> = {
  heading_1: '',
  heading_2: '',
  heading_3: '',
  paragraph: '',
  quote: '',
  callout: '',
  toggle: '',
  bulleted_list_item: '- ',
  numbered_list_item: '- ',
  to_do: '- ',
}

function blockRichText(block: NotionBlock): RichText[] | null {
  const body = block[block.type] as { rich_text?: RichText[] } | undefined
  return body?.rich_text ?? null
}

/** 블록은 깊이 우선으로 평탄화된 목록을 받는다(하위 블록 조회는 호출자 몫). */
export function blocksToText(blocks: NotionBlock[]): BlocksText {
  const lines: string[] = []
  const segments: TextSegment[] = []
  let offset = 0
  let hasImages = false
  for (const block of blocks) {
    if (block.type === 'image' || block.type === 'file' || block.type === 'video') {
      hasImages = true
      continue
    }
    if (!(block.type in PREFIX)) continue
    const rich = blockRichText(block)
    const line =
      rich
        ?.map((t) => t.plain_text)
        .join('')
        .trim() ?? ''
    if (!line) continue
    const full = PREFIX[block.type] + line
    const start = offset + PREFIX[block.type].length
    segments.push({ blockId: block.id, start, end: start + line.length })
    lines.push(full)
    offset += full.length + 1 // 줄바꿈
  }
  return { text: lines.join('\n'), segments, hasImages }
}

export function blockIdAt(segments: TextSegment[], offset: number): string | null {
  return segments.find((s) => offset >= s.start && offset < s.end)?.blockId ?? null
}
