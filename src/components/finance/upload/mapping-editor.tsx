'use client'

/**
 * 컬럼 매핑 에디터 + 다중 컬럼 선택기 + 샘플 미리보기 테이블.
 * upload-panel(단일)에서 추출 — 동작 무변경.
 */
import { CheckCircle2, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { BANK_FIELDS, CARD_FIELDS } from '@/lib/finance/parser'

import { MULTI_COLUMN_FIELDS, NONE_COLUMN, type FieldMapping, type FinKind } from './types'

// ─── 컬럼 매핑 에디터 ────────────────────────────────────────────────────────

type MappingEditorProps = {
  headers: string[]
  emptyColumns: number[]
  sampleRows: string[][]
  mapping: FieldMapping
  kind: FinKind
  onSetColumn: (field: string, colIdx: number | null) => void
  onAddColumn: (field: string, colIdx: number) => void
  onRemoveColumn: (field: string, colIdx: number) => void
}

/**
 * 좌측 = 시스템 필드(필수/선택·사용 여부), 우측 = 업로드 파일 컬럼 선택.
 * 텍스트 필드(적요/내용)는 다중 컬럼 선택 → 결합( " / " ).
 */
export function MappingEditor({
  headers,
  emptyColumns,
  sampleRows,
  mapping,
  kind,
  onSetColumn,
  onAddColumn,
  onRemoveColumn,
}: MappingEditorProps) {
  const fieldDefs = kind === 'BANK' ? BANK_FIELDS : CARD_FIELDS
  const emptySet = new Set(emptyColumns)

  return (
    <div className="divide-y rounded-md border">
      {fieldDefs.map((f) => {
        const cols = mapping[f.value] ?? []
        const isMapped = cols.length > 0
        const isMulti = MULTI_COLUMN_FIELDS.has(f.value)

        return (
          <div key={f.value} className="flex items-start gap-3 px-3 py-2.5">
            {/* 시스템 필드 (좌) */}
            <div className="flex w-44 shrink-0 items-center gap-1.5 pt-1.5">
              <span className={cn('text-sm', isMapped ? 'font-medium' : 'text-muted-foreground')}>
                {f.label}
              </span>
              {f.required && <span className="text-destructive">*</span>}
              {f.required && !isMapped && (
                <Badge
                  variant="outline"
                  className="ml-auto h-5 border-destructive/40 px-1.5 text-[10px] text-destructive"
                >
                  필수
                </Badge>
              )}
              {isMapped && <CheckCircle2 className="ml-auto size-4 shrink-0 text-emerald-500" />}
            </div>

            {/* 화살표 (시스템 ← 파일) */}
            <span className="shrink-0 pt-2 text-xs text-muted-foreground">←</span>

            {/* 파일 컬럼 선택 (우) */}
            {isMulti ? (
              <MultiColumnPicker
                headers={headers}
                emptyColumns={emptyColumns}
                sampleRows={sampleRows}
                selected={cols}
                onAdd={(idx) => onAddColumn(f.value, idx)}
                onRemove={(idx) => onRemoveColumn(f.value, idx)}
              />
            ) : (
              <Select
                value={cols.length > 0 ? String(cols[0]) : NONE_COLUMN}
                onValueChange={(v) => onSetColumn(f.value, v === NONE_COLUMN ? null : Number(v))}
              >
                <SelectTrigger className="h-8 w-64 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_COLUMN}>
                    <span className="text-muted-foreground">(선택 안 함)</span>
                  </SelectItem>
                  {headers.map((h, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {h || `컬럼 ${i + 1}`}
                      {emptySet.has(i) && (
                        <span className="ml-1 text-muted-foreground">(빈 컬럼)</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── 다중 컬럼 선택기 (적요/내용 등 텍스트 결합) ───────────────────────────────

type MultiColumnPickerProps = {
  headers: string[]
  emptyColumns: number[]
  sampleRows: string[][]
  selected: number[]
  onAdd: (colIdx: number) => void
  onRemove: (colIdx: number) => void
}

function MultiColumnPicker({
  headers,
  emptyColumns,
  sampleRows,
  selected,
  onAdd,
  onRemove,
}: MultiColumnPickerProps) {
  const emptySet = new Set(emptyColumns)
  const available = headers.map((h, i) => ({ h, i })).filter(({ i }) => !selected.includes(i))
  const preview = selected
    .map((i) => (sampleRows[0]?.[i] ?? '').trim())
    .filter((v) => v !== '')
    .join(' / ')

  return (
    <div className="flex-1 space-y-2">
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {selected.map((i) => (
            <Badge key={i} variant="secondary" className="gap-1 pr-1 text-xs">
              <span className="max-w-32 truncate">{headers[i] || `컬럼 ${i + 1}`}</span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="rounded-sm hover:bg-muted-foreground/20"
                aria-label="컬럼 제거"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <span className="flex h-8 items-center text-xs text-muted-foreground">
          선택된 컬럼 없음
        </span>
      )}

      {available.length > 0 && (
        <Select value="" onValueChange={(v) => onAdd(Number(v))}>
          <SelectTrigger className="h-8 w-64 text-xs">
            <SelectValue placeholder="+ 컬럼 추가" />
          </SelectTrigger>
          <SelectContent>
            {available.map(({ h, i }) => (
              <SelectItem key={i} value={String(i)}>
                {h || `컬럼 ${i + 1}`}
                {emptySet.has(i) && <span className="ml-1 text-muted-foreground">(빈 컬럼)</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {selected.length > 1 && preview && (
        <p className="text-xs text-muted-foreground">
          미리보기: <span className="font-mono text-foreground">{preview}</span>
        </p>
      )}
    </div>
  )
}

// ─── 샘플 미리보기 테이블 ─────────────────────────────────────────────────────

type SampleTableProps = {
  headers: string[]
  sampleRows: string[][]
  emptyColumns: number[]
  mapping: FieldMapping
}

export function SampleTable({ headers, sampleRows, emptyColumns, mapping }: SampleTableProps) {
  const emptySet = new Set(emptyColumns)
  const mappedSet = new Set(Object.values(mapping).flat())

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow>
          {headers.map((h, i) => {
            const isEmpty = emptySet.has(i)
            const isMapped = mappedSet.has(i)
            return (
              <TableHead
                key={i}
                className={cn(
                  'text-xs whitespace-nowrap',
                  isEmpty && 'italic opacity-40',
                  isMapped && !isEmpty && 'font-medium text-foreground'
                )}
              >
                {h || `컬럼 ${i + 1}`}
              </TableHead>
            )
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sampleRows.map((row, ri) => (
          <TableRow key={ri}>
            {row.map((cell, ci) => {
              const isEmpty = emptySet.has(ci)
              const isMapped = mappedSet.has(ci)
              return (
                <TableCell
                  key={ci}
                  title={cell}
                  className={cn(
                    'max-w-[200px] truncate text-xs',
                    isEmpty && 'text-muted-foreground italic opacity-40',
                    !isMapped && !isEmpty && 'text-muted-foreground opacity-60',
                    isMapped && !isEmpty && 'text-foreground'
                  )}
                >
                  {cell}
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
