// 에이전트가 보낸 텍스트 본문 → TipTap doc. 발행 워커(_naver-doc-text)가 paragraph/heading 만 읽으므로
// 그 두 노드만 만든다. `# `·`## `·`### ` 줄은 heading, 나머지 비어 있지 않은 줄은 paragraph.
// ponytail: 목록·인용·이미지는 문단 텍스트로 남는다. 워커가 그 노드를 렌더하게 되면 여기서 만든다.

type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; text?: string }

export function textToDoc(body: string): DocNode {
  const content: DocNode[] = []
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    content.push(
      heading
        ? {
            type: 'heading',
            attrs: { level: heading[1].length },
            content: [{ type: 'text', text: heading[2] }],
          }
        : { type: 'paragraph', content: [{ type: 'text', text: line }] }
    )
  }
  return { type: 'doc', content }
}
