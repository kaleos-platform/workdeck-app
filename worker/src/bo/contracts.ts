// Blog Ops (bo) 워커 ↔ 웹앱 /api/bo/jobs/claim, /api/bo/jobs/[id]/complete contract.
// sc/contracts.ts 패턴 적용. 웹앱 API 응답이 변경되면 이 파일도 동기화해야 한다.
//
// Claim API: POST /api/bo/jobs/claim {claimedBy, kinds}
//   kinds 에 처리 가능한 job kind 목록을 전달: ['PUBLISH', 'DELETE_POST']
//   응답: {job: {id, kind, payload:{deploymentId}}, context: {...}} | {job: null}
//   - PUBLISH → context: BoPublishContext (variant, channel, credential 포함)
//   - DELETE_POST → context: BoDeleteContext (deployment.platformUrl, channel, credential 포함)
// Complete API: POST /api/bo/jobs/[id]/complete {ok, platformUrl?, errorCode?, errorMessage?}
//   DELETE_POST 는 platformUrl 불필요.
//   신규 에러코드: DELETE_FAILED (재시도 가능), AUTH_FAILED (비재시도), VALIDATION, PLATFORM_ERROR

export type BoJobKind = 'PUBLISH' | 'DELETE_POST'

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

// DELETE_POST claim 응답의 context — 삭제에 필요한 정보만 포함.
// deployment.platformUrl: 삭제 대상 포스트 URL (없으면 VALIDATION 처리).
export type BoDeleteContext = {
  deployment: {
    id: string
    platformUrl: string | null
  }
  channel: {
    platform: BoChannelPlatform
    config: Record<string, unknown>
  }
  credential: {
    kind: string
    payload: Record<string, unknown>
  } | null
}

export type BoClaimResponse =
  | { job: BoJobMeta & { kind: 'PUBLISH' }; context: BoPublishContext }
  | { job: BoJobMeta & { kind: 'DELETE_POST' }; context: BoDeleteContext }
  | { job: null }
