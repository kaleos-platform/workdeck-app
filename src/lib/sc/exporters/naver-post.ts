// TipTap 문서 → 네이버 편집기에 붙여넣을 HTML·평문. 화면 미리보기와 복사가 같은 결과를 쓴다.
// `[문의 링크]` 는 저장본을 바꾸지 않고 내보낼 때만 배포의 추적 링크로 바꾼다.

export const INQUIRY_LINK_TOKEN = '[문의 링크]'

type DocMark = { type?: string; attrs?: Record<string, unknown> }

type DocNode = {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: DocMark[]
  content?: DocNode[]
}

export interface NaverPostInput {
  doc: unknown
  deploymentUrl?: string | null // 없으면 토큰을 그대로 둔다
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inlineHtml(text: string, url?: string | null): string {
  const safe = escapeHtml(text)
  if (!url) return safe
  const href = escapeHtml(url)
  return safe.replaceAll(INQUIRY_LINK_TOKEN, `<a href="${href}">${href}</a>`)
}

// 저장 스키마가 임의 JSON 을 받으므로 content 모양을 믿지 않는다.
function children(node: DocNode): DocNode[] {
  return Array.isArray(node.content) ? node.content : []
}

function childrenHtml(node: DocNode, url?: string | null): string {
  return children(node)
    .map((child) => nodeHtml(child, url))
    .join('')
}

function textHtml(node: DocNode, url?: string | null): string {
  let html = inlineHtml(node.text ?? '', url)
  for (const mark of Array.isArray(node.marks) ? node.marks : []) {
    if (mark.type === 'bold') html = `<strong>${html}</strong>`
    if (mark.type === 'italic') html = `<em>${html}</em>`
    const href = mark.attrs?.href
    if (mark.type === 'link' && typeof href === 'string' && /^https?:\/\//i.test(href)) {
      html = `<a href="${escapeHtml(href)}">${html}</a>`
    }
  }
  return html
}

// 서식이 토큰을 여러 텍스트 노드로 나누면 노드별 치환이 놓친다 — 그 줄만 평문으로 치환한다.
function lineHtml(node: DocNode, url?: string | null): string {
  const plain = inlineText(node)
  if (url && plain.includes(INQUIRY_LINK_TOKEN)) return inlineHtml(plain, url)
  return childrenHtml(node, url)
}

function nodeHtml(node: DocNode, url?: string | null): string {
  switch (node.type) {
    case 'text':
      return textHtml(node, url)
    case 'hardBreak':
      return '<br>'
    case 'paragraph':
      return `<p>${lineHtml(node, url)}</p>`
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 2, 1), 3)
      return `<h${level}>${lineHtml(node, url)}</h${level}>`
    }
    case 'bulletList':
      return `<ul>${childrenHtml(node, url)}</ul>`
    case 'orderedList':
      return `<ol>${childrenHtml(node, url)}</ol>`
    case 'listItem':
      return `<li>${childrenHtml(node, url)}</li>`
    case 'blockquote':
      return `<blockquote>${childrenHtml(node, url)}</blockquote>`
    case 'image': {
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
      return /^https?:\/\//i.test(src) ? `<p><img src="${escapeHtml(src)}" alt=""></p>` : ''
    }
    default:
      return childrenHtml(node, url)
  }
}

function nodeText(node: DocNode, lines: string[]): void {
  if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem') {
    const line = inlineText(node)
    if (line) lines.push(node.type === 'listItem' ? `- ${line}` : line)
    return
  }
  for (const child of children(node)) nodeText(child, lines)
}

function inlineText(node: DocNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  return children(node).map(inlineText).join('')
}

export function exportNaverPost(input: NaverPostInput): { html: string; text: string } {
  const doc = (input.doc ?? {}) as DocNode
  const lines: string[] = []
  nodeText(doc, lines)
  const text = lines.join('\n\n')
  return {
    html: nodeHtml(doc, input.deploymentUrl),
    text: input.deploymentUrl ? text.replaceAll(INQUIRY_LINK_TOKEN, input.deploymentUrl) : text,
  }
}
