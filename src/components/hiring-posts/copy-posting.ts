// 공고 복사 API 호출 — 성공 시 새 공고 id 반환, 실패 시 Error.
export async function copyPosting(postingId: string): Promise<string> {
  const res = await fetch(`/api/hiring-posts/postings/${postingId}/copy`, { method: 'POST' })
  if (!res.ok) throw new Error('공고 복사에 실패했습니다')
  const { posting } = await res.json()
  return posting.id as string
}
