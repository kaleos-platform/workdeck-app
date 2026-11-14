import type { PostingStatus } from './status-badge'

// 공고 마감 API 호출 — 공고 상세와 목록 행 메뉴가 같은 경로를 쓴다.
export async function closePosting(postingId: string): Promise<{ status: PostingStatus }> {
  const res = await fetch(`/api/hiring-posts/postings/${postingId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'close' }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.message ?? '처리에 실패했습니다')
  }
  const { posting } = await res.json()
  return posting
}
