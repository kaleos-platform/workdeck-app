'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { useEffect } from 'react'

type Props = {
  initialDoc: unknown
  editable?: boolean
  onChange?: (doc: unknown) => void
}

// bo용 TipTap 에디터. sc/editor 동일 확장 세트 유지.
export function BoEditor({ initialDoc, editable = true, onChange }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Placeholder.configure({
        placeholder: '여기에 본문을 작성하세요…',
      }),
      CharacterCount.configure({ limit: 20000 }),
    ],
    content: initialDoc as never,
    editable,
    onUpdate({ editor }) {
      onChange?.(editor.getJSON())
    },
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(editable)
  }, [editor, editable])

  if (!editor) {
    return (
      <div className="min-h-[300px] rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        에디터 로딩 중…
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Toolbar
        onBold={() => editor.chain().focus().toggleBold().run()}
        onItalic={() => editor.chain().focus().toggleItalic().run()}
        onHeading2={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        onHeading3={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        onBulletList={() => editor.chain().focus().toggleBulletList().run()}
        onOrderedList={() => editor.chain().focus().toggleOrderedList().run()}
        onLink={() => {
          const url = window.prompt('링크 URL')
          if (url) editor.chain().focus().setLink({ href: url }).run()
        }}
        disabled={!editable}
      />
      <EditorContent
        editor={editor}
        className="prose prose-sm min-h-[300px] max-w-none rounded-md border bg-card p-4 focus-within:border-primary/40"
      />
      <p className="text-right text-xs text-muted-foreground">
        {editor.storage.characterCount.characters()} / 20000 자
      </p>
    </div>
  )
}

function Toolbar(props: {
  onBold: () => void
  onItalic: () => void
  onHeading2: () => void
  onHeading3: () => void
  onBulletList: () => void
  onOrderedList: () => void
  onLink: () => void
  disabled?: boolean
}) {
  const btn =
    'rounded px-2 py-1 text-xs hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border bg-muted/40 p-1">
      <button type="button" className={btn} onClick={props.onBold} disabled={props.disabled}>
        <b>B</b>
      </button>
      <button type="button" className={btn} onClick={props.onItalic} disabled={props.disabled}>
        <i>I</i>
      </button>
      <button type="button" className={btn} onClick={props.onHeading2} disabled={props.disabled}>
        H2
      </button>
      <button type="button" className={btn} onClick={props.onHeading3} disabled={props.disabled}>
        H3
      </button>
      <button type="button" className={btn} onClick={props.onBulletList} disabled={props.disabled}>
        • 목록
      </button>
      <button type="button" className={btn} onClick={props.onOrderedList} disabled={props.disabled}>
        1. 목록
      </button>
      <button type="button" className={btn} onClick={props.onLink} disabled={props.disabled}>
        링크
      </button>
    </div>
  )
}
