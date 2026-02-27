import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FileSpreadsheet } from 'lucide-react'

type UploadHistoryRow = {
  id: string
  fileName: string
  uploadedAt: Date
  periodStart: Date
  periodEnd: Date
  totalRows?: number | null
  insertedRows?: number | null
  duplicateRows?: number | null
}

interface UploadHistoryCardProps {
  rows: UploadHistoryRow[]
  title?: string
  emptyMessage?: string
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

export function UploadHistoryCard({
  rows,
  title = '업로드 이력',
  emptyMessage = '업로드된 리포트가 없습니다',
}: UploadHistoryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <div className="space-y-1">
            {rows.map((upload) => (
              <div
                key={upload.id}
                className="flex items-center justify-between border-b py-2.5 last:border-0"
              >
                <div className="flex items-center gap-2.5">
                  <FileSpreadsheet className="h-4 w-4 flex-shrink-0 text-green-600" />
                  <div>
                    <p className="text-sm font-medium">{upload.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(upload.periodStart)} ~ {formatDate(upload.periodEnd)}
                    </p>
                    {upload.insertedRows != null && (
                      <p className="text-xs text-muted-foreground">
                        저장 {upload.insertedRows.toLocaleString()}건
                        {upload.duplicateRows != null && upload.duplicateRows > 0 && (
                          <span className="ml-1">
                            / 중복 제외 {upload.duplicateRows.toLocaleString()}건
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                <p className="ml-4 text-xs whitespace-nowrap text-muted-foreground">
                  {formatDate(upload.uploadedAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
