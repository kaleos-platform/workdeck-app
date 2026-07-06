// TipTap JSON doc → HTML 변환기 (bo 전용)
// StarterKit(heading/paragraph/bulletList/orderedList/blockquote/codeBlock) + Link 지원.
// HTML 특수문자 이스케이프 포함.

import type { TipTapNode, TipTapTextNode } from '@/lib/bo/markdown-to-doc'

type AnyNode = TipTapNode | TipTapTextNode

export function docToHtml(doc: unknown): string {
  const parts: string[] = []
  walkBlock(doc as AnyNode, (s) => parts.push(s))
  return parts.join('\n').trim()
}

// HTML 특수문자 이스케이프 (텍스트 노드·속성값 공통)
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function walkBlock(node: AnyNode, emit: (s: string) => void): void {
  if (!node || typeof node !== 'object') return
  const n = node as TipTapNode

  switch (n.type) {
    case 'doc':
      for (const c of n.content ?? []) walkBlock(c as AnyNode, emit)
      return

    case 'heading': {
      const level = Math.min(Math.max(Number(n.attrs?.level ?? 2), 1), 6)
      const inner = inlineHtml(n.content as AnyNode[] | undefined)
      emit(`<h${level}>${inner}</h${level}>`)
      return
    }

    case 'paragraph': {
      const inner = inlineHtml(n.content as AnyNode[] | undefined)
      if (inner) emit(`<p>${inner}</p>`)
      return
    }

    case 'bulletList': {
      const items = (n.content ?? []).map((li) => {
        const text = inlineHtml(paragraphContent(li as AnyNode))
        return `  <li>${text}</li>`
      })
      emit(`<ul>\n${items.join('\n')}\n</ul>`)
      return
    }

    case 'orderedList': {
      const items = (n.content ?? []).map((li) => {
        const text = inlineHtml(paragraphContent(li as AnyNode))
        return `  <li>${text}</li>`
      })
      emit(`<ol>\n${items.join('\n')}\n</ol>`)
      return
    }

    case 'blockquote': {
      const inner = inlineHtml(paragraphContent(n as AnyNode))
      emit(`<blockquote><p>${inner}</p></blockquote>`)
      return
    }

    case 'codeBlock': {
      const lang = n.attrs?.language ? String(n.attrs.language) : ''
      const code = (n.content ?? [])
        .map((c) => {
          const t = c as TipTapTextNode
          return typeof t.text === 'string' ? esc(t.text) : ''
        })
        .join('')
      const classAttr = lang ? ` class="language-${esc(lang)}"` : ''
      emit(`<pre><code${classAttr}>${code}</code></pre>`)
      return
    }

    default:
      // 알 수 없는 노드 — content 재귀
      for (const c of n.content ?? []) walkBlock(c as AnyNode, emit)
  }
}

// listItem 또는 blockquote 내부 첫 paragraph의 inline content를 추출
function paragraphContent(node: AnyNode): AnyNode[] {
  const n = node as TipTapNode
  for (const child of n.content ?? []) {
    if ((child as TipTapNode).type === 'paragraph') {
      return ((child as TipTapNode).content ?? []) as AnyNode[]
    }
  }
  return (n.content ?? []) as AnyNode[]
}

// inline 노드 배열 → HTML 문자열
function inlineHtml(nodes: AnyNode[] | undefined): string {
  if (!nodes) return ''
  return nodes
    .map((n) => {
      const x = n as TipTapTextNode
      if (x.type === 'text') {
        // 마크 적용: 안쪽부터 바깥쪽으로 래핑 (bold → italic → link)
        let t = esc(x.text ?? '')
        for (const m of x.marks ?? []) {
          if (m.type === 'bold') t = `<strong>${t}</strong>`
          else if (m.type === 'italic') t = `<em>${t}</em>`
          else if (m.type === 'link' && m.attrs?.href) {
            const href = esc(String(m.attrs.href))
            t = `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${t}</a>`
          }
        }
        return t
      }
      // 인라인 래퍼가 있는 경우 재귀
      if (Array.isArray((n as TipTapNode).content)) {
        return inlineHtml((n as TipTapNode).content as AnyNode[])
      }
      return ''
    })
    .join('')
}
