'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

type Slot = { index: number; label: string }
type Choice = { assetId?: string | null; skip?: boolean }
type Image = { id: string; url: string }

type Props = {
  deploymentId: string
  contentId: string
  slots: Slot[]
  initial: Record<number, Choice>
  images: Image[]
}

/** 사진 대기 배포: 본문의 `[사진: …]` 자리마다 사진을 올리거나 빼고, 다 채우면 게시를 시작한다. */
export function AssetPlanPanel({ deploymentId, contentId, slots, initial, images }: Props) {
  const router = useRouter()
  const [choices, setChoices] = useState<Record<number, Choice>>(initial)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>(
    Object.fromEntries(images.map((i) => [i.id, i.url]))
  )
  const [uploading, setUploading] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const done = slots.filter((s) => choices[s.index]?.assetId || choices[s.index]?.skip).length
  const ready = done === slots.length

  function plan() {
    return {
      slots: slots.map((s) => ({
        index: s.index,
        assetId: choices[s.index]?.skip ? null : (choices[s.index]?.assetId ?? null),
        skip: choices[s.index]?.skip ?? false,
      })),
    }
  }

  async function upload(index: number, file: File) {
    setError(null)
    setUploading(index)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('slotKey', `photo:${index}`)
      const res = await fetch(`/api/sc/contents/${contentId}/assets`, { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.asset?.id) {
        setError(data?.message ?? '사진을 올리지 못했습니다')
        return
      }
      setImageUrls((prev) => ({ ...prev, [data.asset.id]: data.asset.url }))
      setChoices((prev) => ({ ...prev, [index]: { assetId: data.asset.id, skip: false } }))
    } finally {
      setUploading(null)
    }
  }

  async function submit(complete: boolean) {
    setError(null)
    setNotice(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/sc/deployments/${deploymentId}/asset-plan`, {
        method: complete ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan()),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message ?? '저장하지 못했습니다')
        return
      }
      if (complete) router.refresh()
      else setNotice('저장했습니다')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <p className="text-xs text-muted-foreground">
        사진 자리 {slots.length}곳 중 {done}곳 처리. 모두 사진을 올리거나 「빼기」를 고르면 게시를
        시작합니다.
      </p>
      <ol className="space-y-2">
        {slots.map((s) => {
          const c = choices[s.index] ?? {}
          const url = c.assetId ? imageUrls[c.assetId] : null
          return (
            <li key={s.index} className="flex items-center gap-3 rounded-md border p-2">
              <span className="w-6 shrink-0 text-center text-muted-foreground">{s.index + 1}</span>
              {url && !c.skip ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={s.label} className="h-12 w-12 shrink-0 rounded object-cover" />
              ) : (
                <div className="h-12 w-12 shrink-0 rounded bg-muted" />
              )}
              <span className={['flex-1', c.skip ? 'text-muted-foreground line-through' : ''].join(' ')}>
                {s.label}
              </span>
              <label className="shrink-0">
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  aria-label={`${s.index + 1}번 사진 올리기`}
                  disabled={uploading !== null || saving}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void upload(s.index, file)
                    e.target.value = ''
                  }}
                />
                <span className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-xs hover:bg-muted">
                  {uploading === s.index ? '올리는 중…' : url ? '바꾸기' : '사진 올리기'}
                </span>
              </label>
              <Button
                type="button"
                size="sm"
                variant={c.skip ? 'secondary' : 'ghost'}
                onClick={() =>
                  setChoices((prev) => ({
                    ...prev,
                    [s.index]: { assetId: prev[s.index]?.assetId, skip: !prev[s.index]?.skip },
                  }))
                }
              >
                {c.skip ? '빼기 취소' : '이 자리 빼기'}
              </Button>
            </li>
          )
        })}
      </ol>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => submit(false)}>
          중간 저장
        </Button>
        <Button type="button" size="sm" disabled={!ready || saving} onClick={() => submit(true)}>
          사진 등록 완료
        </Button>
        {notice && <span className="text-xs text-muted-foreground">{notice}</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  )
}
