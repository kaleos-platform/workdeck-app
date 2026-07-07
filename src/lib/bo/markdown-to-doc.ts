// TipTap 마크다운 → TipTap JSON doc 변환기.
// StarterKit(heading/paragraph/bulletList/orderedList/blockquote/codeBlock) + Link 지원.
// src/lib/sc/exporters/blog-markdown.ts 의 역방향.

// ─── TipTap 내부 타입 ─────────────────────────────────────────────────────────

interface TipTapMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface TipTapTextNode {
  type: 'text'
  text: string
  marks?: TipTapMark[]
}

export interface TipTapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: (TipTapNode | TipTapTextNode)[]
}

export interface TipTapDoc {
  type: 'doc'
  content: TipTapNode[]
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

export function markdownToTipTapDoc(md: string): TipTapDoc {
  const lines = md.split('\n')
  const blocks = parseBlocks(lines)
  return { type: 'doc', content: blocks }
}

// ─── 블록 파서 ───────────────────────────────────────────────────────────────

function parseBlocks(lines: string[]): TipTapNode[] {
  const nodes: TipTapNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 빈 줄 건너뜀
    if (line.trim() === '') {
      i++
      continue
    }

    // 코드 블록 (``` 펜스)
    const codeFence = /^```(\w*)/.exec(line)
    if (codeFence) {
      const language = codeFence[1] || null
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // 닫는 ``` 건너뜀
      const codeText = codeLines.join('\n')
      // codeBlock은 text 노드를 직접 담음 — paragraph 래퍼 없음
      nodes.push({
        type: 'codeBlock',
        attrs: { language },
        content: codeText.length > 0 ? [{ type: 'text', text: codeText } as TipTapTextNode] : [],
      })
      continue
    }

    // 헤딩 (# ## ### 등)
    const headingMatch = /^(#{1,6})\s+(.*)/.exec(line)
    if (headingMatch) {
      const level = Math.min(Math.max(headingMatch[1].length, 1), 6)
      nodes.push({
        type: 'heading',
        attrs: { level },
        content: parseInline(headingMatch[2].trim()),
      })
      i++
      continue
    }

    // 불릿 리스트 항목 수집 (-, *, + 시작)
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s+/, ''))
        i++
      }
      // listItem은 반드시 paragraph로 래핑
      nodes.push({
        type: 'bulletList',
        content: items.map((item) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInline(item) }],
        })),
      })
      continue
    }

    // 순서 있는 리스트 (1. 2. 등)
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''))
        i++
      }
      nodes.push({
        type: 'orderedList',
        attrs: { start: 1 },
        content: items.map((item) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInline(item) }],
        })),
      })
      continue
    }

    // 인용구 (> 시작 연속 줄)
    if (line.startsWith('> ')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2))
        i++
      }
      // blockquote는 paragraph로 래핑
      nodes.push({
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: parseInline(quoteLines.join(' ')),
          },
        ],
      })
      continue
    }

    // 일반 단락 — 빈 줄 또는 블록 시작 전까지 수집
    const paraLines: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length > 0) {
      nodes.push({
        type: 'paragraph',
        content: parseInline(paraLines.join(' ')),
      })
    }
  }

  return nodes
}

// 현재 줄이 새 블록 시작인지 판별 — 단락 수집 종료 조건
function isBlockStart(line: string): boolean {
  return (
    /^#{1,6}\s+/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    line.startsWith('> ') ||
    line.startsWith('```')
  )
}

// ─── 인라인 파서 ─────────────────────────────────────────────────────────────

// 마크다운 인라인: ***bold+italic***, **bold**, *italic*, [text](url)
// exporter의 마크 적용 순서(bold → italic → link)와 동일하게 처리.

export function parseInline(text: string): TipTapTextNode[] {
  const result: TipTapTextNode[] = []
  let remaining = text

  while (remaining.length > 0) {
    // 링크: [text](url)
    const linkMatch = /^\[([^\]]*)\]\(([^)]*)\)/.exec(remaining)
    if (linkMatch) {
      const [full, linkText, href] = linkMatch
      const inner = parseInline(linkText)
      for (const node of inner) {
        result.push({
          ...node,
          marks: [
            ...(node.marks ?? []),
            {
              type: 'link',
              attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null },
            },
          ],
        })
      }
      remaining = remaining.slice(full.length)
      continue
    }

    // 굵기+기울임: ***text***
    const boldItalicMatch = /^\*\*\*(.+?)\*\*\*/.exec(remaining)
    if (boldItalicMatch) {
      const [full, t] = boldItalicMatch
      result.push({ type: 'text', text: t, marks: [{ type: 'bold' }, { type: 'italic' }] })
      remaining = remaining.slice(full.length)
      continue
    }

    // 굵기: **text**
    const boldMatch = /^\*\*(.+?)\*\*/.exec(remaining)
    if (boldMatch) {
      const [full, t] = boldMatch
      result.push({ type: 'text', text: t, marks: [{ type: 'bold' }] })
      remaining = remaining.slice(full.length)
      continue
    }

    // 기울임: *text*
    const italicMatch = /^\*(.+?)\*/.exec(remaining)
    if (italicMatch) {
      const [full, t] = italicMatch
      result.push({ type: 'text', text: t, marks: [{ type: 'italic' }] })
      remaining = remaining.slice(full.length)
      continue
    }

    // 일반 텍스트 — 다음 특수 패턴(* 또는 [) 전까지
    const plainMatch = /^[^*[]+/.exec(remaining)
    if (plainMatch) {
      result.push({ type: 'text', text: plainMatch[0] })
      remaining = remaining.slice(plainMatch[0].length)
      continue
    }

    // 패턴 미매칭 특수문자 → 리터럴 처리
    result.push({ type: 'text', text: remaining[0] })
    remaining = remaining.slice(1)
  }

  return result
}
