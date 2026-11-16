'use client'

import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { Extension, InputRule, Node } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Node as PMNode, Slice } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  MESSAGE_VARIABLES,
  docToText,
  textToDoc,
  type MessageDocNode,
} from '@/lib/hiring/message-template'

const CHIP_CLASS =
  'mx-0.5 rounded border border-blue-200 bg-blue-50 px-1.5 text-sm font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400'
const TOKEN_RE = new RegExp(`\\{(${MESSAGE_VARIABLES.join('|')})\\}`)

// 변수({이름} 등)를 한 덩어리로 다루는 inline atom. 저장·복사 시에는 평문 {이름}.
const MessageVariable = Node.create({
  name: 'messageVariable',
  // 기본 Backspace(입력 규칙 되돌리기)보다 먼저 처리해 칩을 통째로 지운다
  priority: 1000,
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { key: { default: '이름' } }
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-variable]',
        getAttrs: (el) => ({ key: (el as HTMLElement).getAttribute('data-variable') }),
      },
    ]
  },
  renderHTML({ node }) {
    return [
      'span',
      {
        'data-variable': node.attrs.key,
        'aria-label': `{${node.attrs.key}}`,
        class: CHIP_CLASS,
      },
      node.attrs.key,
    ]
  },
  renderText({ node }) {
    return `{${node.attrs.key}}`
  },
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { selection } = editor.state
        if (!selection.empty) return false
        const before = selection.$from.nodeBefore
        if (before?.type.name !== this.name) return false
        const to = selection.from
        return editor.commands.deleteRange({ from: to - before.nodeSize, to })
      },
    }
  },
  addInputRules() {
    const type = this.type
    // nodeInputRule 은 캡처 그룹이 있으면 그룹 부분만 바꿔 `{`·`}`가 남는다 → 전체 범위를 직접 교체
    return [
      new InputRule({
        find: new RegExp(`${TOKEN_RE.source}$`),
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(range.from, range.to, type.create({ key: match[1] }))
        },
      }),
    ]
  },
})

// 직렬화 길이가 제한을 넘는 트랜잭션(입력·붙여넣기·칩 삽입)은 거부한다.
const MaxLength = Extension.create<{ max: number }>({
  name: 'maxLength',
  addOptions() {
    return { max: 1000 }
  },
  addProseMirrorPlugins() {
    const max = this.options.max
    return [
      new Plugin({
        filterTransaction: (tr) =>
          !tr.docChanged || docToText(tr.doc.toJSON() as MessageDocNode).length <= max,
      }),
    ]
  },
})

type Props = {
  value: string
  onChange: (value: string) => void
  maxLength?: number
}

export function MessageContentEditor({ value, onChange, maxLength = 1000 }: Props) {
  // 편집기가 내보낸 마지막 값 — 이 값이 돌아온 렌더는 외부 변경이 아니므로 덮어쓰지 않는다
  const emitted = useRef(value)
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        underline: false,
        trailingNode: false,
      }),
      MessageVariable,
      MaxLength.configure({ max: maxLength }),
    ],
    content: textToDoc(value),
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': '내용',
        class:
          'min-h-28 whitespace-pre-wrap break-words px-3 py-2 text-base outline-none md:text-sm',
      },
      // 붙여넣은 평문의 {이름} 등을 칩으로 바꾼다
      clipboardTextParser: (text, _ctx, _plain, view) => {
        const doc = PMNode.fromJSON(view.state.schema, textToDoc(text.replace(/\r\n?/g, '\n')))
        return new Slice(doc.content, 1, 1)
      },
    },
    onUpdate: ({ editor: e }) => {
      const next = docToText(e.getJSON() as MessageDocNode)
      emitted.current = next
      onChange(next)
    },
  })

  // 부모가 값을 바꿔 넣은 경우(새 메시지 초기화 등)만 동기화. 입력 중 늦게 돌아온 값으로 덮어쓰면
  // 방금 친 글자가 사라지고 커서가 끝으로 튄다.
  useEffect(() => {
    if (!editor || value === emitted.current) return
    emitted.current = value
    editor.commands.setContent(textToDoc(value), { emitUpdate: false })
  }, [editor, value])

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {MESSAGE_VARIABLES.map((key) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant="outline"
            // 버튼을 눌러도 편집기 포커스·커서를 잃지 않게 한다
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .insertContent({ type: 'messageVariable', attrs: { key } })
                .run()
            }
          >
            <Plus className="mr-0.5 size-3.5" />
            {key}
          </Button>
        ))}
      </div>
      <div
        className={cn(
          'w-full rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] dark:bg-input/30',
          'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50'
        )}
      >
        <EditorContent editor={editor} />
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>변수 칩은 보낼 때 지원자 정보로 바뀝니다.</span>
        <span>{Math.max(0, maxLength - value.length)}자 남음</span>
      </div>
    </div>
  )
}

/** 저장된 평문을 변수 칩 모양으로 보여주는 정적 미리보기. */
export function MessagePreview({ content, className }: { content: string; className?: string }) {
  const parts = content.split(new RegExp(`(${TOKEN_RE.source})`))
  return (
    <p className={cn('text-sm whitespace-pre-wrap text-muted-foreground', className)}>
      {parts.map((part, i) => {
        // split 캡처 그룹 때문에 토큰은 (전체, 키) 두 번 나온다 — 전체 토큰만 칩으로, 키는 건너뜀
        if (i % 3 === 2) return null
        if (i % 3 === 1) {
          return (
            <span key={i} data-variable={part.slice(1, -1)} className={CHIP_CLASS}>
              {part.slice(1, -1)}
            </span>
          )
        }
        return part
      })}
    </p>
  )
}
