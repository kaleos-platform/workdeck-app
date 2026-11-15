// 사전 질문(지원서 커스텀 항목) — 번호+굵은 질문, 아래 답변. 서버 렌더(PII 포함 가능).
import type { ApplicationEntryValue } from '@/lib/hiring/pii'

export function PreQuestions({ entries }: { entries: ApplicationEntryValue[] }) {
  if (entries.length === 0) return null
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">사전 질문</h2>
      <ol className="divide-y rounded-lg border">
        {entries.map((e, i) => (
          <li key={e.key} className="space-y-1 p-4 text-sm">
            <p className="font-semibold">
              {i + 1}. {e.label || e.key}
            </p>
            <p className="whitespace-pre-wrap">
              {Array.isArray(e.value) ? e.value.join(', ') : String(e.value)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}
