import { redirect } from 'next/navigation'
import { ShieldCheck, KeyRound, LayoutGrid, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const metadata = {
  title: 'Workdeck 접근 권한 요청',
  description: '외부 애플리케이션의 Workdeck 접근을 승인하거나 거부하세요',
}

// OAuth scope 별 한국어 설명 (알려진 표준 scope만 보강)
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: '로그인 및 사용자 식별',
  profile: '이름 등 기본 프로필 정보',
  email: '이메일 주소',
}

// 접근 대상 안내에 사용할 Space + 활성 Deck 목록.
// 조회 실패 시 페이지가 깨지지 않도록 빈 배열로 방어한다.
type SpaceAccess = {
  spaceId: string
  spaceName: string
  deckAppIds: string[]
}

async function loadSpaceAccess(userId: string): Promise<SpaceAccess[]> {
  try {
    const memberships = await prisma.spaceMember.findMany({
      where: { userId },
      include: { space: { select: { id: true, name: true } } },
    })

    const result: SpaceAccess[] = []
    for (const membership of memberships) {
      let deckAppIds: string[] = []
      try {
        const decks = await prisma.deckInstance.findMany({
          where: { spaceId: membership.space.id, isActive: true },
          select: { deckAppId: true },
        })
        deckAppIds = decks.map((deck) => deck.deckAppId)
      } catch {
        // 개별 Space의 Deck 조회 실패는 무시하고 계속 진행
        deckAppIds = []
      }
      result.push({
        spaceId: membership.space.id,
        spaceName: membership.space.name,
        deckAppIds,
      })
    }
    return result
  } catch {
    // 조회 실패 시에도 동의 화면은 정상 렌더링
    return []
  }
}

function ConsentShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>
}) {
  const { authorization_id: authorizationId } = await searchParams

  // authorization_id 누락 → 잘못된 진입
  if (!authorizationId) {
    return (
      <ConsentShell>
        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              <CardTitle className="text-xl">잘못된 요청</CardTitle>
            </div>
            <CardDescription>
              authorization_id 파라미터가 없습니다. 올바른 인증 요청을 통해 다시 시도하세요.
            </CardDescription>
          </CardHeader>
        </Card>
      </ConsentShell>
    )
  }

  const supabase = await createClient()

  // 세션 확인 — 미인증이면 로그인 후 이 동의 페이지로 복귀
  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims
  if (!claims) {
    const returnPath = `/oauth/consent?authorization_id=${authorizationId}`
    redirect(`/login?redirectTo=${encodeURIComponent(returnPath)}`)
  }

  const userId = claims.sub

  // 인증 상세 조회 — 에러 또는 이미 동의(redirect) 브랜치 처리
  const { data: authData, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId)

  if (error || !authData) {
    return (
      <ConsentShell>
        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              <CardTitle className="text-xl">인증 정보를 불러올 수 없습니다</CardTitle>
            </div>
            <CardDescription>
              요청이 만료되었거나 유효하지 않습니다. 애플리케이션에서 다시 시도하세요.
            </CardDescription>
          </CardHeader>
        </Card>
      </ConsentShell>
    )
  }

  // union narrowing: authorization_id 키가 있으면 동의 필요, 없으면 이미 동의 → 즉시 리다이렉트
  if (!('authorization_id' in authData)) {
    redirect(authData.redirect_url)
  }

  const authDetails = authData
  const scopes = authDetails.scope.split(' ').filter(Boolean)
  const spaceAccess = await loadSpaceAccess(userId)

  return (
    <ConsentShell>
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </span>
            <div className="space-y-0.5">
              <CardTitle className="text-xl">접근 권한 요청</CardTitle>
              <CardDescription>
                <span className="font-medium text-foreground">{authDetails.client.name}</span>
                이(가) 회원님의 Workdeck 계정 접근을 요청합니다.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* 요청 애플리케이션 정보 */}
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">애플리케이션</span>
              <span className="font-medium">{authDetails.client.name}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-muted-foreground">리다이렉트 주소</span>
              <span className="max-w-[60%] truncate text-right font-mono text-xs">
                {authDetails.redirect_uri}
              </span>
            </div>
          </div>

          {/* 요청 권한(scope) */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <KeyRound className="size-4 text-muted-foreground" />
              요청 권한
            </div>
            {scopes.length > 0 ? (
              <ul className="space-y-1.5">
                {scopes.map((scope) => (
                  <li key={scope} className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary" className="font-mono">
                      {scope}
                    </Badge>
                    {SCOPE_DESCRIPTIONS[scope] ? (
                      <span className="text-muted-foreground">{SCOPE_DESCRIPTIONS[scope]}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">요청된 권한이 없습니다.</p>
            )}
          </div>

          {/* 접근 대상 안내 — Space + 활성 Deck */}
          {spaceAccess.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <LayoutGrid className="size-4 text-muted-foreground" />이 애플리케이션이 다음
                워크스페이스와 활성 카드에 접근합니다
              </div>
              <ul className="space-y-2">
                {spaceAccess.map((space) => (
                  <li key={space.spaceId} className="rounded-lg border p-3 text-sm">
                    <div className="font-medium">{space.spaceName}</div>
                    {space.deckAppIds.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {space.deckAppIds.map((deckAppId) => (
                          <Badge key={deckAppId} variant="outline">
                            {deckAppId}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">활성 카드 없음</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>

        {/* 승인 / 거부 — 서버 라우트로 form POST */}
        <CardFooter>
          <form action="/api/oauth/decision" method="POST" className="flex w-full gap-2">
            <input type="hidden" name="authorization_id" value={authDetails.authorization_id} />
            <Button type="submit" name="decision" value="deny" variant="outline" className="flex-1">
              거부
            </Button>
            <Button type="submit" name="decision" value="approve" className="flex-1">
              허용
            </Button>
          </form>
        </CardFooter>
      </Card>
    </ConsentShell>
  )
}
