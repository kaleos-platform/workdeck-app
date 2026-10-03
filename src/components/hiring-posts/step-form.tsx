'use client'

import { clearIncompatibleFieldLimits } from '@/lib/hiring/form-values'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, GripVertical, ArrowUp, ArrowDown, X } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { FormFieldInput } from '@/lib/validations/hiring-posts'
import { AutoSaveIndicator } from './autosave-indicator'

export type StepFormHandle = { flush: () => Promise<void> }

type Props = {
  ref?: Ref<StepFormHandle>
  postingId: string
  // 최초 시딩 전용 — 이후 파생 fields 는 위로만 흐른다(다시 내부 상태로 되먹이지 않음).
  initialFields: FormFieldInput[]
  onChange: (fields: FormFieldInput[]) => void
}

const CUSTOM_TYPE_LABELS: Record<string, string> = {
  number: '숫자 입력',
  date: '날짜 입력',
  string: '한 줄 입력',
  text: '여러 줄 입력',
  select: '선택 목록',
  file: '파일 첨부',
}

type EditorFieldKind = 'locked' | 'standard' | 'custom'

// 옵션 항목에 안정적 key를 부여해 중간 삭제 시 포커스 꼬임 방지
type OptionItem = { id: string; value: string }

type EditorField = {
  key: string
  type: FormFieldInput['type']
  label: string
  required: boolean
  options: OptionItem[]
  kind: EditorFieldKind
  maxFileCount?: number
  maxFileSize?: number
  errorMessage?: string
  description?: string
  placeholder?: string
  minLength?: number
  maxLength?: number
}

function makeKey(): string {
  return `custom_${Math.random().toString(36).slice(2, 9)}`
}

function makeOptId(): string {
  return `opt_${Math.random().toString(36).slice(2, 9)}`
}

function toFormFieldInput(f: EditorField): FormFieldInput {
  const base: FormFieldInput = {
    key: f.key,
    type: f.type,
    label: f.label,
    required: f.required,
    ...(f.maxFileCount !== undefined ? { maxFileCount: f.maxFileCount } : {}),
    ...(f.maxFileSize !== undefined ? { maxFileSize: f.maxFileSize } : {}),
    ...(f.errorMessage !== undefined ? { errorMessage: f.errorMessage } : {}),
    ...(f.description !== undefined ? { description: f.description } : {}),
    ...(f.placeholder !== undefined ? { placeholder: f.placeholder } : {}),
    ...(f.minLength !== undefined ? { minLength: f.minLength } : {}),
    ...(f.maxLength !== undefined ? { maxLength: f.maxLength } : {}),
  }
  if (f.type === 'select' || f.type === 'multiselect') {
    const vals = f.options.map((o) => o.value).filter(Boolean)
    if (vals.length > 0) base.options = vals
  }
  return base
}

// 빈 항목을 필터링하면 기존 서버 항목이 삭제되므로 저장 전에 검증한다.
function hasEmptyLabel(fields: EditorField[]): boolean {
  return fields.some((f) => !f.label.trim())
}

function toSavePayload(fields: EditorField[]): FormFieldInput[] {
  return fields.map(toFormFieldInput)
}

function seedFields(initialFields: FormFieldInput[]): EditorField[] {
  const kindOf = (key: string): EditorFieldKind => {
    if (key === 'name' || key === 'phone') return 'locked'
    if (key === 'email' || key === 'address') return 'standard'
    return 'custom'
  }

  const out: EditorField[] = initialFields.map((f) => ({
    key: f.key,
    type: f.type,
    label: f.label,
    required: f.required,
    ...(f.maxFileCount !== undefined ? { maxFileCount: f.maxFileCount } : {}),
    ...(f.maxFileSize !== undefined ? { maxFileSize: f.maxFileSize } : {}),
    ...(f.errorMessage !== undefined ? { errorMessage: f.errorMessage } : {}),
    ...(f.description !== undefined ? { description: f.description } : {}),
    ...(f.placeholder !== undefined ? { placeholder: f.placeholder } : {}),
    ...(f.minLength !== undefined ? { minLength: f.minLength } : {}),
    ...(f.maxLength !== undefined ? { maxLength: f.maxLength } : {}),
    options: (f.options ?? []).map((v) => ({ id: makeOptId(), value: v })),
    kind: kindOf(f.key),
  }))

  // name/phone 이 없으면 맨 앞에 보강
  if (!out.find((f) => f.key === 'name')) {
    out.unshift({
      key: 'name',
      type: 'string',
      label: '이름',
      required: true,
      options: [],
      kind: 'locked',
    })
  }
  if (!out.find((f) => f.key === 'phone')) {
    const nameIdx = out.findIndex((f) => f.key === 'name')
    out.splice(nameIdx + 1, 0, {
      key: 'phone',
      type: 'phone',
      label: '연락처',
      required: true,
      options: [],
      kind: 'locked',
    })
  }

  return out
}

export function StepForm({ ref, postingId, initialFields, onChange }: Props) {
  const [editorFields, setEditorFields] = useState<EditorField[]>(() => seedFields(initialFields))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const savingRef = useRef<Promise<void> | null>(null)
  const lastSavedRef = useRef(JSON.stringify(toSavePayload(editorFields)))
  // in-flight 중 saveNow 가 호출됐을 때 저장할 fields 를 보관. null 이면 pending 없음.
  const pendingRef = useRef<EditorField[] | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // dnd-kit 센서: PointerSensor distance 6px(실수 드래그 방지) + KeyboardSensor
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // 파생 fields 를 wizard 로 즉시 동기화(미리보기 라이브 반영). 되먹임 없음.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    onChangeRef.current(editorFields.map(toFormFieldInput))
  }, [editorFields])

  const fieldsRef = useRef(editorFields)
  fieldsRef.current = editorFields

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (
        !savingRef.current &&
        !hasEmptyLabel(fieldsRef.current) &&
        JSON.stringify(toSavePayload(fieldsRef.current)) === lastSavedRef.current
      )
        return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [])

  // 단계 이동은 마지막 입력을 포함해 저장하고 실패하면 현재 편집기를 유지한다.
  useImperativeHandle(ref, () => ({
    flush: () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      return doSave(fieldsRef.current)
    },
  }))
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    },
    []
  )

  function doSave(currentFields: EditorField[]): Promise<void> {
    if (hasEmptyLabel(currentFields)) {
      pendingRef.current = null
      return Promise.reject(new Error('지원서 항목 이름을 입력하거나 빈 항목을 삭제하세요.'))
    }
    pendingRef.current = currentFields
    if (savingRef.current) return savingRef.current
    const request = (async () => {
      while (pendingRef.current !== null) {
        const fields = pendingRef.current
        pendingRef.current = null
        const payload = JSON.stringify(toSavePayload(fields))
        if (payload === lastSavedRef.current) continue
        setStatus('saving')
        try {
          const res = await fetch(`/api/hiring-posts/postings/${postingId}/form`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: JSON.parse(payload) }),
          })
          if (!res.ok) throw new Error('지원서 항목 저장에 실패했습니다')
          lastSavedRef.current = payload
          setStatus('saved')
        } catch (error) {
          pendingRef.current ??= fields
          setStatus('idle')
          throw error
        }
      }
    })()
    savingRef.current = request.finally(() => {
      savingRef.current = null
    })
    return savingRef.current
  }

  function saveNow(currentFields: EditorField[]) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (hasEmptyLabel(currentFields)) {
      pendingRef.current = null
      setStatus('idle')
      return
    }
    void doSave(currentFields).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : '지원서 항목 저장에 실패했습니다')
    })
  }

  function saveOnBlur() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => saveNow(fieldsRef.current), 600)
  }

  // 드래그 종료 — arrayMove 후 saveNow(위/아래 버튼과 동일한 저장 경로)
  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = editorFields.findIndex((f) => f.key === active.id)
    const newIdx = editorFields.findIndex((f) => f.key === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    const next = arrayMove(editorFields, oldIdx, newIdx)
    setEditorFields(next)
    saveNow(next)
  }

  function moveField(idx: number, dir: -1 | 1) {
    const target = idx + dir
    if (target < 0 || target >= editorFields.length) return
    const next = [...editorFields]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setEditorFields(next)
    saveNow(next)
  }

  function addStandard(key: 'email' | 'address') {
    const field: EditorField =
      key === 'email'
        ? {
            key: 'email',
            type: 'email',
            label: '이메일',
            required: false,
            options: [],
            kind: 'standard',
          }
        : {
            key: 'address',
            type: 'string',
            label: '주소',
            required: false,
            options: [],
            kind: 'standard',
          }
    const next = [...editorFields, field]
    setEditorFields(next)
    saveNow(next)
  }

  function removeField(idx: number) {
    const next = editorFields.filter((_, i) => i !== idx)
    setEditorFields(next)
    saveNow(next)
  }

  function addCustom() {
    const next: EditorField[] = [
      ...editorFields,
      { key: makeKey(), type: 'string', label: '', required: false, options: [], kind: 'custom' },
    ]
    setEditorFields(next)
    // 빈 항목은 입력 또는 명시적 삭제 전까지 로컬에 유지한다.
    saveNow(next)
  }

  function updateField(idx: number, patch: Partial<EditorField>) {
    setEditorFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)))
  }

  function handleTypeChange(idx: number, v: string) {
    // select↔multiselect 전환 시 options 유지, 다른 타입으로 전환 시 options 초기화
    const prev = editorFields[idx]
    const keepOptions =
      (v === 'select' || v === 'multiselect') &&
      (prev.type === 'select' || prev.type === 'multiselect')
    const next = editorFields.map((f, i) =>
      i === idx
        ? clearIncompatibleFieldLimits({
            ...f,
            type: v as EditorField['type'],
            options: keepOptions ? f.options : [],
          })
        : f
    )
    if (
      prev.minLength !== next[idx].minLength ||
      prev.maxLength !== next[idx].maxLength ||
      prev.maxFileCount !== next[idx].maxFileCount ||
      prev.maxFileSize !== next[idx].maxFileSize
    )
      toast.info('항목 유형이 바뀌어 호환되지 않는 글자 수·파일 제한을 해제했습니다')
    setEditorFields(next)
    saveNow(next)
  }

  function handleRequiredToggle(idx: number, v: boolean) {
    const next = editorFields.map((f, i) => (i === idx ? { ...f, required: v } : f))
    setEditorFields(next)
    saveNow(next)
  }

  function handleMultiselectToggle(idx: number, v: boolean) {
    const next = editorFields.map((f, i) =>
      i === idx ? { ...f, type: (v ? 'multiselect' : 'select') as EditorField['type'] } : f
    )
    setEditorFields(next)
    saveNow(next)
  }

  function addOption(idx: number) {
    const next = editorFields.map((f, i) =>
      i === idx ? { ...f, options: [...f.options, { id: makeOptId(), value: '' }] } : f
    )
    setEditorFields(next)
    saveNow(next)
  }

  function updateOption(fieldIdx: number, optId: string, value: string) {
    setEditorFields((prev) =>
      prev.map((f, i) =>
        i === fieldIdx
          ? { ...f, options: f.options.map((o) => (o.id === optId ? { ...o, value } : o)) }
          : f
      )
    )
  }

  function removeOption(fieldIdx: number, optId: string) {
    const next = editorFields.map((f, i) =>
      i === fieldIdx ? { ...f, options: f.options.filter((o) => o.id !== optId) } : f
    )
    setEditorFields(next)
    saveNow(next)
  }

  const hasEmail = editorFields.some((f) => f.key === 'email')
  const hasAddress = editorFields.some((f) => f.key === 'address')

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">지원 항목</div>
          <div className="flex items-center gap-2">
            {!hasEmail && (
              <Button size="sm" variant="outline" onClick={() => addStandard('email')}>
                <Plus className="size-3.5" /> 이메일 추가
              </Button>
            )}
            {!hasAddress && (
              <Button size="sm" variant="outline" onClick={() => addStandard('address')}>
                <Plus className="size-3.5" /> 주소 추가
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={addCustom}>
              <Plus className="size-3.5" /> 항목 추가
            </Button>
          </div>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={editorFields.map((f) => f.key)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {editorFields.map((f, idx) => (
                <SortableFieldRow
                  key={f.key}
                  field={f}
                  idx={idx}
                  total={editorFields.length}
                  onMove={moveField}
                  onRemove={removeField}
                  onUpdate={updateField}
                  onTypeChange={handleTypeChange}
                  onRequiredToggle={handleRequiredToggle}
                  onMultiselectToggle={handleMultiselectToggle}
                  onAddOption={addOption}
                  onUpdateOption={updateOption}
                  onRemoveOption={removeOption}
                  onBlurSave={saveOnBlur}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="flex justify-end">
        {hasEmptyLabel(editorFields) ? (
          <span role="status" className="text-xs text-muted-foreground">
            미완성 항목이 있습니다
          </span>
        ) : (
          <AutoSaveIndicator status={status} />
        )}
      </div>
    </div>
  )
}

type FieldRowProps = {
  field: EditorField
  idx: number
  total: number
  onMove: (idx: number, dir: -1 | 1) => void
  onRemove: (idx: number) => void
  onUpdate: (idx: number, patch: Partial<EditorField>) => void
  onTypeChange: (idx: number, v: string) => void
  onRequiredToggle: (idx: number, v: boolean) => void
  onMultiselectToggle: (idx: number, v: boolean) => void
  onAddOption: (idx: number) => void
  onUpdateOption: (fieldIdx: number, optId: string, value: string) => void
  onRemoveOption: (fieldIdx: number, optId: string) => void
  onBlurSave: () => void
}

function SortableFieldRow(props: FieldRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.field.key,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.12)' : undefined,
    position: isDragging ? ('relative' as const) : undefined,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <FieldRowContent {...props} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  )
}

type FieldRowContentProps = FieldRowProps & {
  dragHandleProps: React.HTMLAttributes<HTMLButtonElement>
}

function FieldRowContent({
  field,
  idx,
  total,
  onMove,
  onRemove,
  onUpdate,
  onTypeChange,
  onRequiredToggle,
  onMultiselectToggle,
  onAddOption,
  onUpdateOption,
  onRemoveOption,
  onBlurSave,
  dragHandleProps,
}: FieldRowContentProps) {
  const isSelectLike = field.type === 'select' || field.type === 'multiselect'

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      {/* 행 헤더: 그립(드래그 핸들) + 이름/라벨 + 이동/삭제 */}
      <div className="flex items-center gap-2">
        {/* GripVertical 에만 listeners 부착 — Input/Select/Switch 조작 방해 없음 */}
        <button
          type="button"
          aria-label="순서 이동"
          className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
          {...dragHandleProps}
        >
          <GripVertical className="size-4 shrink-0" />
        </button>

        {field.kind === 'locked' ? (
          <div className="flex flex-1 items-center justify-between rounded-md border bg-background px-3 py-2 text-sm">
            <span>{field.label}</span>
            <span className="text-xs text-muted-foreground">필수 · 고정</span>
          </div>
        ) : field.kind === 'standard' ? (
          <div className="flex flex-1 items-center px-1 text-sm font-medium">{field.label}</div>
        ) : (
          <Input
            aria-label="항목 이름"
            aria-invalid={!field.label.trim()}
            aria-describedby={!field.label.trim() ? `field-error-${field.key}` : undefined}
            value={field.label}
            onChange={(e) => onUpdate(idx, { label: e.target.value })}
            onBlur={onBlurSave}
            placeholder="항목 이름"
            className="flex-1"
          />
        )}

        {/* 위/아래 이동 버튼 — 기존 유지 */}
        <Button size="icon-sm" variant="ghost" onClick={() => onMove(idx, -1)} disabled={idx === 0}>
          <ArrowUp />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onMove(idx, 1)}
          disabled={idx === total - 1}
        >
          <ArrowDown />
        </Button>

        {/* locked 는 삭제 불가 */}
        {field.kind !== 'locked' && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`${field.label.trim() || '빈 항목'} 삭제`}
            onClick={() => onRemove(idx)}
          >
            <Trash2 />
          </Button>
        )}
      </div>

      {field.kind === 'custom' && !field.label.trim() && (
        <p id={`field-error-${field.key}`} className="pl-6 text-xs text-destructive">
          항목 이름을 입력하거나 항목을 삭제하세요.
        </p>
      )}

      {/* 커스텀 항목: 타입 선택 + 필수 스위치 */}
      {field.kind === 'custom' && (
        <div className="flex items-center gap-2 pl-6">
          <Select
            value={field.type === 'multiselect' ? 'select' : field.type}
            onValueChange={(v) => onTypeChange(idx, v)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CUSTOM_TYPE_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch checked={field.required} onCheckedChange={(v) => onRequiredToggle(idx, v)} />
            필수
          </label>
        </div>
      )}

      {/* 선택 목록 UI (select/multiselect) */}
      {field.kind === 'custom' && isSelectLike && (
        <div className="space-y-2 pl-6">
          {field.options.map((opt) => (
            <div key={opt.id} className="flex items-center gap-2">
              <Input
                value={opt.value}
                onChange={(e) => onUpdateOption(idx, opt.id, e.target.value)}
                onBlur={onBlurSave}
                placeholder="선택지"
                className="flex-1"
              />
              <Button size="icon-sm" variant="ghost" onClick={() => onRemoveOption(idx, opt.id)}>
                <X />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" onClick={() => onAddOption(idx)}>
              <Plus className="size-3.5" /> 선택지 추가
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Switch
                checked={field.type === 'multiselect'}
                onCheckedChange={(v) => onMultiselectToggle(idx, v)}
              />
              중복 선택 허용
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
