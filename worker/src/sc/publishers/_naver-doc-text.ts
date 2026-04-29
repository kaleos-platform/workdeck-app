// TipTap Doc → 네이버 블로그 본문용 plain text.
// 현재는 1세대: paragraph/heading 만 개행 구분. list/quote/image 등은 Phase 2 후속.
// 마지막에 deploymentUrl(/c/{slug}) 을 CTA 로 추가한다.

type Node = {
  type?: string
  text?: string
  content?: Node[]
}

export function renderDocToPlainText(doc: unknown, deploymentUrl: string): string {
  const paragraphs: string[] = []
  walk(doc as Node, paragraphs, [])
  const body = paragraphs.filter((p) => p.trim().length > 0).join('\n\n')
  const cta = deploymentUrl ? `\n\n\n자세히 보기: ${deploymentUrl}` : ''
  return body + cta
}

function walk(node: Node | undefined | null, out: string[], buffer: string[]): void {
  if (!node || typeof node !== 'object') return

  const isBlock =
    node.type === 'paragraph' ||
    node.type === 'heading' ||
    node.type === 'blockquote' ||
    node.type === 'bulletList' ||
    node.type === 'orderedList' ||
    node.type === 'listItem' ||
    node.type === 'doc'

  if (isBlock) {
    const inner: string[] = []
    for (const child of node.content ?? []) walk(child, out, inner)
    const joined = inner.join('').trim()
    if (joined) out.push(joined)
    return
  }

  if (node.type === 'text' && typeof node.text === 'string') {
    buffer.push(node.text)
    return
  }

  // fallback: inline 요소나 hardBreak → 빈 문자열
  for (const child of node.content ?? []) walk(child, out, buffer)
}
