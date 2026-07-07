// 서버 전용 — 'use client' 없음.
// generateHTML: @tiptap/html (SSR-safe, DOM 불필요).
// Placeholder/CharacterCount는 에디터 전용이므로 제외.
import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'

const extensions = [
  StarterKit.configure({ heading: { levels: [2, 3] } }),
  Link.configure({ openOnClick: false, autolink: true }),
  Image,
]

/**
 * Tiptap JSON doc → HTML 문자열 (서버에서 안전하게 실행).
 * 알 수 없는 노드는 generateHTML이 무시하므로 excalidraw 잔류 노드도 안전.
 */
export function renderTiptapHtml(doc: unknown): string {
  try {
    return generateHTML(doc as Parameters<typeof generateHTML>[0], extensions)
  } catch {
    return ''
  }
}
