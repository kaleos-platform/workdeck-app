'use client'

import {
  useEditor,
  EditorContent,
  useEditorState,
  type Editor as TiptapEditor,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  Highlighter,
  Link2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { HIRING_PROSE_CLASS } from '@/lib/hiring/prose'
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

// 경량 TipTap 에디터. StarterKit(Bold/Italic/Underline/Link/Heading/List/HR 등 번들)
// + Image + Placeholder + CharacterCount + TextAlign + TextStyle/Color + Highlight.
// 렌더는 src/lib/hiring/render-tiptap.ts 와 확장 목록을 맞춰야 한다.
export function Editor({ initialDoc, editable = true, onChange, variant = 'compact' }: Props) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
      }),
      Image,
      Placeholder.configure({ placeholder: '여기에 본문을 작성하세요…' }),
      CharacterCount.configure({ limit: 20000 }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: false }),
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
      <Toolbar editor={editor} disabled={!editable} onLink={openLinkDialog} />
      <EditorContent
        editor={editor}
        className={cn(
          HIRING_PROSE_CLASS,
          'prose prose-sm max-w-none [&_.ProseMirror]:outline-none',
          variant === 'full'
            ? 'min-h-[50vh] focus-within:border-primary/40 [&_.ProseMirror]:min-h-[50vh]'
            : 'max-h-80 min-h-24 overflow-y-auto focus-within:ring-1 focus-within:ring-primary/40 [&_.ProseMirror]:min-h-24'
        )}
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

function Toolbar({
  editor,
  disabled,
  onLink,
}: {
  editor: TiptapEditor
  disabled?: boolean
  onLink: () => void
}) {
  const colorRef = useRef<HTMLInputElement>(null)

  // 선택 영역 변화에 따라 활성 상태를 다시 계산(툴바 하이라이트).
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      h1: editor.isActive('heading', { level: 1 }),
      h2: editor.isActive('heading', { level: 2 }),
      h3: editor.isActive('heading', { level: 3 }),
      bullet: editor.isActive('bulletList'),
      ordered: editor.isActive('orderedList'),
      alignLeft: editor.isActive({ textAlign: 'left' }),
      alignCenter: editor.isActive({ textAlign: 'center' }),
      alignRight: editor.isActive({ textAlign: 'right' }),
      highlight: editor.isActive('highlight'),
      link: editor.isActive('link'),
      color: (editor.getAttributes('textStyle').color as string | undefined) ?? '#18181b',
    }),
  })

  const run = (fn: () => void) => () => fn()

  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-md border bg-muted/40 p-1">
      <TB
        active={state.bold}
        disabled={disabled}
        onClick={run(() => editor.chain().focus().toggleBold().run())}
        label="굵게"
      >
        <Bold className="size-3.5" />
      </TB>
      <TB
        active={state.italic}
        disabled={disabled}
        onClick={run(() => editor.chain().focus().toggleItalic().run())}
        label="기울임"
      >
        <Italic className="size-3.5" />
      </TB>
      <TB
        active={state.underline}
        disabled={disabled}
        onClick={run(() => editor.chain().focus().toggleUnderline().run())}
        label="밑줄"
      >
        <UnderlineIcon className="size-3.5" />
      </TB>

      <Sep />
      <TB
        active={state.h1}
        disabled={disabled}
        onClick={run(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}
        label="제목 1"
      >
        <Heading1 className="size-3.5" />
      </TB>
      <TB
        active={state.h2}
        disabled={disabled}
        onClick={run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}
        label="제목 2"
      >
        <Heading2 className="size-3.5" />
      </TB>
      <TB
        active={state.h3}
        disabled={disabled}
        onClick={run(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}
        label="제목 3"
      >
        <Heading3 className="size-3.5" />
      </TB>

      <Sep />
      <TB
        active={state.bullet}
        disabled={disabled}
        onClick={run(() => editor.chain().focus().toggleBulletList().run())}
        label="글머리 목록"
      >
        <List className="size-3.5" />
      </TB>
      <TB
        active={state.ordered}
        disabled={disabled}
        onClick={run(() => editor.chain().focus().toggleOrderedList().run())}
        label="번호 목록"
      >
        <ListOrdered className="size-3.5" />
      </TB>

      <Sep />
      <TB
        active={state.alignLeft}
        disabled={disabled}
        onClick={run(() => editor.chain().focus().setTextAlign('left').run())}
        label="왼쪽 정렬"
      >
        <AlignLeft className="size-3.5" />
      </TB>
      <TB
        active={state.alignCenter}
        disabled={disabled}
        onClick={run(() => editor.chain().focus().setTextAlign('center').run())}
        label="가운데 정렬"
      >
        <AlignCenter className="size-3.5" />
      </TB>
      <TB
        active={state.alignRight}
        disabled={disabled}
        onClick={run(() => editor.chain().focus().setTextAlign('right').run())}
        label="오른쪽 정렬"
      >
        <AlignRight className="size-3.5" />
      </TB>

      <Sep />
      <TB
        active={state.highlight}
        disabled={disabled}
        onClick={run(() => editor.chain().focus().toggleHighlight().run())}
        label="형광펜"
      >
        <Highlighter className="size-3.5" />
      </TB>
      {/* 글자색 — 스와치 클릭 시 네이티브 색 선택기 */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => colorRef.current?.click()}
        aria-label="글자색"
        className="relative inline-flex size-7 items-center justify-center rounded hover:bg-accent disabled:opacity-40"
      >
        <span className="text-xs leading-none font-bold">가</span>
        <span
          className="absolute inset-x-1 bottom-1 h-0.5 rounded"
          style={{ backgroundColor: state.color }}
        />
        <input
          ref={colorRef}
          type="color"
          value={state.color}
          onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          className="sr-only"
          tabIndex={-1}
        />
      </button>

      <Sep />
      <TB
        disabled={disabled}
        onClick={run(() => editor.chain().focus().setHorizontalRule().run())}
        label="구분선"
      >
        <Minus className="size-3.5" />
      </TB>
      <TB active={state.link} disabled={disabled} onClick={onLink} label="링크">
        <Link2 className="size-3.5" />
      </TB>
    </div>
  )
}

function TB({
  active,
  disabled,
  onClick,
  label,
  children,
}: {
  active?: boolean
  disabled?: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      data-active={active ? 'true' : undefined}
      className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent data-[active=true]:bg-accent data-[active=true]:text-foreground"
    >
      {children}
    </button>
  )
}

function Sep() {
  return <span className="mx-0.5 h-4 w-px bg-border" />
}
