'use client'

import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  type DelFormatColumn,
  type DelFieldMapping,
  FIELD_LABELS,
  indexToColumnLetter,
} from '@/lib/del/format-templates'

type FormatEditorProps = {
  value: DelFormatColumn[]
  onChange: (columns: DelFormatColumn[]) => void
}

const NONE_VALUE = '__none__'
const FIELD_OPTIONS = Object.entries(FIELD_LABELS) as [DelFieldMapping, string][]

export function FormatEditor({ value, onChange }: FormatEditorProps) {
  function addColumn() {
    const nextLetter = indexToColumnLetter(value.length)
    onChange([...value, { column: nextLetter, field: null, label: '', defaultValue: '' }])
  }

  function removeColumn(index: number) {
    const next = value.filter((_, i) => i !== index)
    onChange(next.map((col, i) => ({ ...col, column: indexToColumnLetter(i) })))
  }

  function updateColumn(index: number, updates: Partial<DelFormatColumn>) {
    const next = value.map((col, i) => (i === index ? { ...col, ...updates } : col))
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>파일 포맷 설정</Label>
        <Button variant="outline" size="sm" type="button" onClick={addColumn}>
          <Plus className="mr-1 h-4 w-4" />컬럼 추가
        </Button>
      </div>

      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          양식 파일을 업로드해 불러오거나 컬럼을 수동으로 추가해 주세요
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">컬럼</TableHead>
                <TableHead className="w-40">매핑 필드</TableHead>
                <TableHead>헤더 텍스트</TableHead>
                <TableHead>기본값</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {value.map((col, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-center">{col.column}</TableCell>
                  <TableCell>
                    <Select
                      value={col.field ?? NONE_VALUE}
                      onValueChange={(v) =>
                        updateColumn(i, {
                          field: v === NONE_VALUE ? null : (v as DelFieldMapping),
                        })
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>(빈 컬럼)</SelectItem>
                        {FIELD_OPTIONS.map(([key, label]) => (
                          <SelectItem key={key} value={key}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8"
                      value={col.label}
                      onChange={(e) => updateColumn(i, { label: e.target.value })}
                      placeholder="헤더"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8"
                      value={col.defaultValue ?? ''}
                      onChange={(e) =>
                        updateColumn(i, { defaultValue: e.target.value || undefined })
                      }
                      placeholder="—"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => removeColumn(i)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
