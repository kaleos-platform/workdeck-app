// TipTap 문서(JSON)를 간단한 마크다운으로 변환. 블로그 플랫폼 대부분이 MD 를 수용한다.
// imageSlot/ctaSlot 커스텀 노드는 에셋 매핑을 받아 이미지·링크로 치환.

export interface ExporterAsset {
  slotKey: string | null
  url: string
  alt?: string | null
}

export interface BlogExportInput {
  doc: unknown
  assets: ExporterAsset[]
  deploymentUrl: string // {APP_URL}/c/{slug} — CTA 슬롯의 최종 링크
}

export function exportBlogMarkdown(input: BlogExportInput): string {
  const out: string[] = []
  walk(input.doc, (line) => out.push(line), input.assets, input.deploymentUrl)
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function walk(
  node: unknown,
  emit: (s: string) => void,
  assets: ExporterAsset[],
  deploymentUrl: string
): void {
  if (!node || typeof node !== 'object') return
  const n = node as {
    type?: string
    attrs?: Record<string, unknown>
    content?: unknown[]
    text?: string
    marks?: { type: string; attrs?: Record<string, unknown> }[]
  }

  switch (n.type) {
    case 'doc':
      for (const c of n.content ?? []) walk(c, emit, assets, deploymentUrl)
      return
    case 'heading': {
      const level = Number(n.attrs?.level ?? 2)
      const inner = textOf(n.content ?? [])
      emit(`${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${inner}`)
      emit('')
      return
    }
    case 'paragraph': {
      const inner = textOf(n.content ?? [])
      if (inner) {
        emit(inner)
        emit('')
      }
      return
    }
    case 'bulletList':
      for (const li of n.content ?? []) {
        const t = textOf(flatChildren(li))
        emit(`- ${t}`)
      }
      emit('')
      return
    case 'orderedList': {
      let i = 1
      for (const li of n.content ?? []) {
        const t = textOf(flatChildren(li))
        emit(`${i}. ${t}`)
        i += 1
      }
      emit('')
      return
    }
    case 'imageSlot': {
      const slotKey = String(n.attrs?.key ?? '')
      const matched = assets.find((a) => a.slotKey === slotKey) ?? assets[0]
      if (matched) emit(`![${matched.alt ?? ''}](${matched.url})`)
      emit('')
      return
    }
    case 'ctaSlot': {
      const label = String(n.attrs?.label ?? 'Learn more')
      emit(`[${label}](${deploymentUrl})`)
      emit('')
      return
    }
    default:
      if (Array.isArray(n.content)) {
        for (const c of n.content) walk(c, emit, assets, deploymentUrl)
      }
      return
  }
}

function flatChildren(node: unknown): unknown[] {
  if (!node || typeof node !== 'object') return []
  const n = node as { content?: unknown[] }
  return n.content ?? []
}

function textOf(nodes: unknown[]): string {
  return nodes
    .map((n) => {
      if (!n || typeof n !== 'object') return ''
      const x = n as {
        type?: string
        text?: string
        content?: unknown[]
        marks?: { type: string; attrs?: Record<string, unknown> }[]
      }
      if (x.type === 'text') {
        let t = x.text ?? ''
        for (const m of x.marks ?? []) {
          if (m.type === 'bold') t = `**${t}**`
          else if (m.type === 'italic') t = `*${t}*`
          else if (m.type === 'link' && m.attrs?.href) t = `[${t}](${String(m.attrs.href)})`
        }
        return t
      }
      if (Array.isArray(x.content)) return textOf(x.content)
      return ''
    })
    .join('')
}
