import { NextResponse } from 'next/server'
import { resolveWorkspace } from '@/lib/api-helpers'
import { getNegativeKeywordCandidates } from '@/lib/coupang-ads/negative-keyword-candidates'

// GET /api/coupang-ads/negative-keyword-candidates
// 제외 키워드 후보(캠페인별)·보호 목록·「제거했는데 지출 중」 목록. 워커도 x-workspace-id 로 요약용 호출.
export async function GET() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error

  return NextResponse.json(await getNegativeKeywordCandidates(resolved.workspace.id))
}
