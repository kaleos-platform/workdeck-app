// TipTap JSON doc → Markdown 변환기 (bo 전용)
// StarterKit(heading/paragraph/bulletList/orderedList/blockquote/codeBlock) + Link 지원.
// markdown-to-doc.ts의 정확한 역방향.

import type { TipTapNode, TipTapTextNode } from '@/lib/bo/markdown-to-doc'

type AnyNode = TipTapNode | TipTapTextNode

export function docToMarkdown(doc: unknown): string {
  const out: string[] = []
  walkBlock(doc as AnyNode, (line) => out.push(line))
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function walkBlock(node: AnyNode, emit: (s: string) => void): void {
  if (!node || typeof node !== 'object') return
  const n = node as TipTapNode

  switch (n.type) {
    case 'doc':
      for (const c of n.content ?? []) walkBlock(c as AnyNode, emit)
      return

    case 'heading': {
      const level = Number(n.attrs?.level ?? 2)
      const inner = inlineText(n.content as AnyNode[] | undefined)
      emit(`${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${inner}`)
      emit('')
      return
    }

    case 'paragraph': {
      const inner = inlineText(n.content as AnyNode[] | undefined)
      if (inner) {
        emit(inner)
        emit('')
      }
      return
    }

    case 'bulletList': {
      for (const li of n.content ?? []) {
        // listItem → paragraph → inline
        const text = inlineText(paragraphContent(li as AnyNode))
        emit(`- ${text}`)
      }
      emit('')
      return
    }

    case 'orderedList': {
      let i = 1
      for (const li of n.content ?? []) {
        const text = inlineText(paragraphContent(li as AnyNode))
        emit(`${i}. ${text}`)
        i++
      }
      emit('')
      return
    }

    case 'blockquote': {
      // blockquote → paragraph → inline
      const inner = inlineText(paragraphContent(n as AnyNode))
      emit(`> ${inner}`)
      emit('')
      return
    }

    case 'codeBlock': {
      const lang = n.attrs?.language ? String(n.attrs.language) : ''
      const code = (n.content ?? [])
        .map((c) => {
          const t = c as TipTapTextNode
          return typeof t.text === 'string' ? t.text : ''
        })
        .join('')
      emit(`\`\`\`${lang}`)
      if (code) emit(code)
      emit('```')
      emit('')
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
  // paragraph 래퍼가 없는 경우 — content 직접 반환
  return (n.content ?? []) as AnyNode[]
}

// inline 노드 배열 → markdown 텍스트
function inlineText(nodes: AnyNode[] | undefined): string {
  if (!nodes) return ''
  return nodes
    .map((n) => {
      const x = n as TipTapTextNode
      if (x.type === 'text') {
        let t = x.text ?? ''
        for (const m of x.marks ?? []) {
          if (m.type === 'bold') t = `**${t}**`
          else if (m.type === 'italic') t = `*${t}*`
          else if (m.type === 'link' && m.attrs?.href) t = `[${t}](${String(m.attrs.href)})`
        }
        return t
      }
      // 인라인 래퍼가 있는 경우 재귀
      if (Array.isArray((n as TipTapNode).content)) {
        return inlineText((n as TipTapNode).content as AnyNode[])
      }
      return ''
    })
    .join('')
}
