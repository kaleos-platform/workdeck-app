import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// OAuth 2.1 동의 화면의 승인/거부 결정을 처리한다.
// consent 페이지의 <form method="POST">에서 호출된다.
export async function POST(request: Request) {
  const formData = await request.formData()
  const decision = formData.get('decision')
  const authorizationId = formData.get('authorization_id')

  if (typeof authorizationId !== 'string' || !authorizationId) {
    return NextResponse.json({ error: 'authorization_id 파라미터가 없습니다.' }, { status: 400 })
  }

  const supabase = await createClient()

  // approve/deny 분기 — approve 외의 값은 모두 거부로 처리
  const { data, error } =
    decision === 'approve'
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId)

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? '인증 결정을 처리하지 못했습니다.' },
      { status: 400 }
    )
  }

  // POST → GET 리다이렉트(303)로 OAuth 클라이언트에 code/error 전달
  return NextResponse.redirect(data.redirect_url, 303)
}
