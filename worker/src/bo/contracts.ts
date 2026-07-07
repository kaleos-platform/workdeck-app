// Blog Ops (bo) 워커 ↔ 웹앱 /api/bo/jobs/claim, /api/bo/jobs/[id]/complete contract.
// sc/contracts.ts 패턴 적용. 웹앱 API 응답이 변경되면 이 파일도 동기화해야 한다.
//
// Claim API: POST /api/bo/jobs/claim {claimedBy, kinds?}
//   → {job: {id, kind, payload:{deploymentId}}, context: {...}} | {job: null}
// Complete API: POST /api/bo/jobs/[id]/complete {ok, platformUrl?, errorCode?, errorMessage?}

export type BoJobKind = 'PUBLISH'

export type BoJobMeta = {
  id: string
  kind: BoJobKind
  payload: {
    deploymentId: string
  }
}

export type BoChannelPlatform = 'NAVER_BLOG' | 'TISTORY' | 'OWN_HOMEPAGE'

// NAVER_BLOG 채널 config 추가 설정 타입.
export type NaverBlogChannelConfig = {
  visibility?: 'public' | 'private'
}

// 웹앱 claim 응답의 context 필드 — publisher 가 발행에 필요한 모든 정보를 포함.
export type BoPublishContext = {
  deployment: {
    id: string
  }
  variant: {
    title: string
    doc: unknown // TipTap JSON
  }
  channel: {
    platform: BoChannelPlatform
    config: Record<string, unknown> & NaverBlogChannelConfig
  }
  credential: {
    kind: string
    payload: Record<string, unknown>
  } | null
}

export type BoClaimResponse = { job: BoJobMeta; context: BoPublishContext } | { job: null }
