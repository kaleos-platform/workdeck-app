import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { createClient } from '@/lib/supabase/server'

// GET /api/reports/upload-url?fileName={fileName}
// 브라우저가 Supabase Storage에 직접 업로드하기 위한 signed URL 발급
export async function GET(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved
  const user = 'user' in resolved ? resolved.user : undefined

  const url = new URL(request.url)
  const fileName = url.searchParams.get('fileName')
  if (!fileName) {
    return errorResponse('fileName 파라미터가 필요합니다', 400)
  }

  // 스토리지 RLS 호환: 사용자 기준 최상위 경로를 유지
  // {userId}/{workspaceId}/{timestamp}_{fileName}
  const userId = user?.id ?? 'worker'
  const storagePath = `${userId}/${workspace.id}/${Date.now()}_${fileName}`

  const supabase = await createClient()
  const { data, error } = await supabase.storage.from('reports').createSignedUploadUrl(storagePath)

  if (error || !data) {
    console.error('Signed upload URL 생성 오류:', error)
    return errorResponse('업로드 URL 생성에 실패했습니다', 500)
  }

  return NextResponse.json({ signedUrl: data.signedUrl, storagePath })
}
