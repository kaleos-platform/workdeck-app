// 서버/클라이언트 겸용 — generateHTML: @tiptap/html (DOM 불필요, isomorphic).
// Placeholder/CharacterCount는 에디터 전용이므로 제외.
import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'

// 에디터(src/components/sc/editor/editor.tsx)와 확장 목록을 반드시 일치시킬 것.
// Link/Underline 은 StarterKit v3 에 번들되어 별도 import 불필요.
const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: { openOnClick: false, autolink: true },
  }),
  Image,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TextStyle,
  Color,
  Highlight.configure({ multicolor: false }),
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
