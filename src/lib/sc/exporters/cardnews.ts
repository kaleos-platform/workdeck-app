// 카드뉴스용 구조 추출 — 슬라이드별 (캡션 텍스트, 이미지 URL) 리스트.
// 실제 이미지 합성은 Unit 10 publisher 또는 수동 툴로.

import type { ExporterAsset } from './blog-markdown'

export interface CardNewsExportInput {
  doc: unknown
  assets: ExporterAsset[]
}

export interface CardNewsSlide {
  index: number
  caption: string
  imageUrl: string | null
}

export function exportCardNews(input: CardNewsExportInput): CardNewsSlide[] {
  if (!input.doc || typeof input.doc !== 'object') return []
  const d = input.doc as { type?: string; content?: unknown[] }
  if (d.type !== 'doc' || !Array.isArray(d.content)) return []

  const out: CardNewsSlide[] = []
  for (const slide of d.content) {
    if (!slide || typeof slide !== 'object') continue
    const s = slide as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }
    if (s.type !== 'slide') continue
    const index = Number(s.attrs?.index ?? out.length)

    const captions: string[] = []
    let imageUrl: string | null = null
    for (const inner of s.content ?? []) {
      if (!inner || typeof inner !== 'object') continue
      const n = inner as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }
      if (n.type === 'paragraph') {
        captions.push(plainText(n.content ?? []))
      } else if (n.type === 'imageSlot') {
        const slotKey = `slide_${index}_${String(n.attrs?.key ?? '')}`
        const matched = input.assets.find(
          (a) => a.slotKey === slotKey || a.slotKey === String(n.attrs?.key)
        )
        if (matched) imageUrl = matched.url
      }
    }
    out.push({ index, caption: captions.join('\n').trim(), imageUrl })
  }
  return out.sort((a, b) => a.index - b.index)
}

function plainText(nodes: unknown[]): string {
  return nodes
    .map((n) => {
      if (!n || typeof n !== 'object') return ''
      const x = n as { type?: string; text?: string; content?: unknown[] }
      if (x.type === 'text') return x.text ?? ''
      if (Array.isArray(x.content)) return plainText(x.content)
      return ''
    })
    .join('')
}
