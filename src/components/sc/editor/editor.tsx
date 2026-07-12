'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Props = {
  initialDoc: unknown
  editable?: boolean
  onChange?: (doc: unknown) => void
  variant?: 'compact' | 'full'
}

const PROSE_CLASS =
  '[&_a]:text-primary [&_a]:underline [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:text-sm [&_p]:mb-2 [&_p]:text-sm [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-sm [&_.ProseMirror]:outline-none'

// 경량 TipTap 에디터. DQ5 조합: StarterKit + Link + Image + Placeholder + CharacterCount.
// imageSlot/ctaSlot 등 커스텀 노드는 doc JSON 에 그대로 보존되며, 그 자체로는
// TipTap 이 렌더하지 못하지만 에디터는 미지의 노드를 무시하거나 pre 처리로 출력한다.
// 추후 NodeView 확장을 덧붙여 전용 UI 로 교체 가능.
export function Editor({ initialDoc, editable = true, onChange, variant = 'compact' }: Props) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)

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
      <div className="min-h-24 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        에디터 로딩 중…
      </div>
    )
  }

  function openLinkDialog() {
    const existing = editor?.getAttributes('link').href as string | undefined
    setLinkUrl(existing ?? '')
    setLinkError(null)
    setLinkDialogOpen(true)
  }

  function handleUnsetLink() {
    editor?.chain().focus().unsetLink().run()
    setLinkDialogOpen(false)
  }

  function handleConfirmLink() {
    const url = linkUrl.trim()
    if (!url) {
      setLinkError('URL을 입력하세요')
      return
    }
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        setLinkError('http 또는 https URL을 입력하세요')
        return
      }
    } catch {
      setLinkError('유효한 URL을 입력하세요')
      return
    }
    editor?.chain().focus().setLink({ href: url }).run()
    setLinkDialogOpen(false)
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
        onLink={openLinkDialog}
        disabled={!editable}
      />
      <EditorContent
        editor={editor}
        className={
          variant === 'full'
            ? `${PROSE_CLASS} prose prose-sm min-h-[50vh] max-w-none focus-within:border-primary/40 [&_.ProseMirror]:min-h-[50vh]`
            : `${PROSE_CLASS} prose prose-sm max-h-80 min-h-24 max-w-none overflow-y-auto focus-within:ring-1 focus-within:ring-primary/40 [&_.ProseMirror]:min-h-24`
        }
      />
      <p className="text-right text-xs text-muted-foreground">
        {editor.storage.characterCount.characters()} / 20000 자
      </p>

      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>링크</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Input
              value={linkUrl}
              onChange={(e) => {
                setLinkUrl(e.target.value)
                setLinkError(null)
              }}
              placeholder="https://…"
            />
            {linkError && <p className="text-xs text-destructive">{linkError}</p>}
          </div>
          <DialogFooter>
            {editor.getAttributes('link').href && (
              <Button variant="ghost" onClick={handleUnsetLink}>
                링크 해제
              </Button>
            )}
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>
              취소
            </Button>
            <Button onClick={handleConfirmLink}>확인</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
        🔗 링크
      </button>
    </div>
  )
}
