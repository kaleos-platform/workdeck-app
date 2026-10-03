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

// 외부 채용 사이트에는 앱 CSS가 없으므로 내보내는 문서에 기본 스타일을 포함한다.
const embedExtensions = [
  StarterKit.configure({
    heading: {
      levels: [1, 2, 3],
      HTMLAttributes: { style: 'font-size:20px;font-weight:600;line-height:1.4;margin:0 0 8px' },
    },
    paragraph: { HTMLAttributes: { style: 'font-size:14px;margin:0 0 8px' } },
    bulletList: {
      HTMLAttributes: { style: 'list-style-type:disc;padding-left:20px;margin:0 0 8px' },
    },
    orderedList: {
      HTMLAttributes: { style: 'list-style-type:decimal;padding-left:20px;margin:0 0 8px' },
    },
    listItem: { HTMLAttributes: { style: 'margin:0 0 4px' } },
    blockquote: {
      HTMLAttributes: { style: 'border-left:3px solid #d4d4d8;padding-left:12px;margin:12px 0' },
    },
    link: {
      openOnClick: false,
      autolink: true,
      HTMLAttributes: { style: 'color:#18181b;text-decoration:underline' },
    },
  }),
  Image.configure({ HTMLAttributes: { style: 'max-width:100%;height:auto' } }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TextStyle,
  Color,
  Highlight.configure({
    multicolor: false,
    HTMLAttributes: { style: 'background-color:#fef08a;color:inherit' },
  }),
]

/**
 * Tiptap JSON doc → HTML 문자열 (서버에서 안전하게 실행).
 * 알 수 없는 노드는 generateHTML이 무시하므로 excalidraw 잔류 노드도 안전.
 */
export function renderTiptapHtml(doc: unknown, inlineStyles = false): string {
  try {
    return generateHTML(
      doc as Parameters<typeof generateHTML>[0],
      inlineStyles ? embedExtensions : extensions
    )
  } catch {
    return ''
  }
}
