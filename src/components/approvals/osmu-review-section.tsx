'use client'

// OSMU 발행 요청 제안의 승인 보조 — 사진 자리별 썸네일(제안 시점 복사본)과 소재 사실·근거.
import { useEffect, useState } from 'react'

type Review = {
  source: {
    title: string
    version: number | null
    facts: { text: string; evidence: { text: string } }[]
    quotes: { speaker: string | null; text: string; evidence: { text: string } }[]
  } | null
  copies: { id: string; url: string; name: string; caption: string | null }[]
}

type Photo = { slot: number; copyId: string }

export function OsmuReviewSection({ requestId, photos }: { requestId: string; photos: Photo[] }) {
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/sc/osmu/requests/${requestId}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}))
        if (!alive) return
        if (res.ok) setReview(json)
        else setError(json.message ?? '소재를 불러오지 못했습니다(이 요청의 Space 에서 열어주세요)')
      })
      .catch(() => alive && setError('소재를 불러오지 못했습니다'))
    return () => {
      alive = false
    }
  }, [requestId])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!review) return <p className="text-sm text-muted-foreground">소재 불러오는 중…</p>

  const byId = new Map(review.copies.map((c) => [c.id, c]))
  const sorted = [...photos].sort((a, b) => a.slot - b.slot)

  return (
    <div className="space-y-4">
      {sorted.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium">사진 자리 (게시될 사진)</h4>
          <div className="grid grid-cols-3 gap-2">
            {sorted.map((p) => {
              const c = byId.get(p.copyId)
              return (
                <figure key={p.slot} className="space-y-1">
                  {c ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.url}
                      alt={c.caption ?? c.name}
                      className="aspect-square w-full rounded border object-cover"
                    />
                  ) : (
                    <div className="aspect-square w-full rounded border bg-muted" />
                  )}
                  <figcaption className="text-xs text-muted-foreground">
                    {p.slot}번 · {c?.caption ?? c?.name ?? '사진 없음'}
                  </figcaption>
                </figure>
              )
            })}
          </div>
        </div>
      )}
      {review.source && (
        <div>
          <h4 className="mb-2 text-sm font-medium">
            소재 「{review.source.title}」 v{review.source.version} — 본문 사실이 아래 근거 안에
            있는지 확인하세요
          </h4>
          <ul className="space-y-2 text-sm">
            {review.source.facts.map((f, i) => (
              <li key={`f${i}`} className="rounded border p-2">
                <p>{f.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">근거: “{f.evidence.text}”</p>
              </li>
            ))}
            {review.source.quotes.map((q, i) => (
              <li key={`q${i}`} className="rounded border p-2">
                <p>
                  “{q.text}”{q.speaker && ` — ${q.speaker}`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">근거: “{q.evidence.text}”</p>
              </li>
            ))}
            {review.source.facts.length + review.source.quotes.length === 0 && (
              <li className="text-muted-foreground">
                검증된 사실이 없습니다 — 본문 사실을 직접 확인하세요
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
