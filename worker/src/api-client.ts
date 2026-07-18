/**
 * Workdeck API 클라이언트
 * 워커에서 메인 Next.js 앱 API를 호출하기 위한 래퍼
 */

// ─── 타입 정의 ─────────────────────────────────────────────────────────────────

/** CollectionRun 상태 */
export type CollectionStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'DOWNLOADING'
  | 'PARSING'
  | 'COMPLETED'
  | 'FAILED'

/** CollectionRun 데이터 */
export type CollectionRun = {
  id: string
  workspaceId: string
  status: CollectionStatus
  triggeredBy: string
  error: string | null
  uploadId: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

/** Run 업데이트 요청 */
export type UpdateRunData = {
  status?: CollectionStatus
  error?: string | null
  uploadId?: string | null
}

/** 자격증명 응답 */
export type CredentialResponse = {
  workspaceId: string
  loginId: string
  encryptedPassword: string
  passwordIv: string
  /** 쿠팡 판매분석(VENDOR) 수집 여부 — false면 inventory_health만 수집 */
  collectVendorSales?: boolean
}

// ─── API 클라이언트 ──────────────────────────────────────────────────────────────

function getBaseUrl(): string {
  const url = process.env.WORKDECK_API_URL
  if (!url) throw new Error('WORKDECK_API_URL 환경변수가 설정되지 않았습니다')
  return url.replace(/\/$/, '') // trailing slash 제거
}

function getWorkerApiKey(): string {
  const key = process.env.WORKER_API_KEY
  if (!key) throw new Error('WORKER_API_KEY 환경변수가 설정되지 않았습니다')
  return key
}

/** 워커 인증 헤더를 포함한 fetch 래퍼 */
async function workerFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${getBaseUrl()}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-worker-api-key': getWorkerApiKey(),
    ...(options.headers as Record<string, string> | undefined),
  }

  const response = await fetch(url, { ...options, headers })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`API 요청 실패 [${response.status}]: ${path} — ${body}`)
  }

  return response
}

// ─── 공개 메서드 ─────────────────────────────────────────────────────────────────

/**
 * 새 수집 실행(CollectionRun) 생성
 * POST /api/collection/runs
 */
export async function createCollectionRun(triggeredBy: string): Promise<CollectionRun> {
  const response = await workerFetch('/api/collection/runs', {
    method: 'POST',
    body: JSON.stringify({ triggeredBy }),
  })
  const data = await response.json()
  return data.run
}

/**
 * 수집 실행 상태 업데이트
 * PATCH /api/collection/runs/[runId]
 */
export async function updateCollectionRun(
  runId: string,
  data: UpdateRunData
): Promise<CollectionRun> {
  const response = await workerFetch(`/api/collection/runs/${runId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  const result = await response.json()
  return result.run
}

/**
 * 암호화된 자격증명 조회 (셋업 전용)
 * GET /api/collection/credentials
 */
export async function getCredentials(): Promise<CredentialResponse> {
  const response = await workerFetch('/api/collection/credentials')
  const data = await response.json()
  return data.credential
}

/**
 * 미처리 수동 수집 조회 (Worker 폴링용)
 * GET /api/collection/runs/pending
 * @returns 가장 오래된 PENDING 레코드 1건 또는 null
 */
export async function getPendingRun(): Promise<{ id: string; workspaceId: string } | null> {
  const response = await workerFetch('/api/collection/runs/pending')
  const data = await response.json()
  return data.run ?? null
}

/**
 * 리포트 파일 업로드 (multipart/form-data)
 * POST /api/collection/upload
 */
export async function uploadReport(
  buffer: Buffer,
  fileName: string,
  workspaceId?: string
): Promise<{
  uploadId: string
  inserted: number
  skipped: number
  totalRows: number
  insertedRows: number
  duplicateRows: number
  periodStart?: string
  periodEnd?: string
}> {
  const formData = new FormData()
  formData.append('file', new Blob([new Uint8Array(buffer)]), fileName)
  if (workspaceId) {
    formData.append('workspaceId', workspaceId)
  }

  const url = `${getBaseUrl()}/api/collection/upload`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-worker-api-key': getWorkerApiKey(),
      // Content-Type은 FormData가 자동 설정 (boundary 포함)
    },
    body: formData,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`API 요청 실패 [${response.status}]: /api/collection/upload — ${body}`)
  }

  return response.json()
}

/** Slack 알림 발송 대상 (멀티테넌트 — Space에 등록된 notifications 채널) */
export type SlackNotificationTargetResponse = {
  spaceId: string
  channelId: string
  botToken: string // AES-256-CBC hex 암호문 — 워커가 ENCRYPTION_KEY로 복호화
  botTokenIv: string
} | null

/** Slack 알림 조회 결과 — target(발송 채널) + notifyEnabled(Deck 토글) */
export type SlackNotificationLookup = {
  target: SlackNotificationTargetResponse
  notifyEnabled: boolean
}

/**
 * workspaceId로 Slack 알림 발송 대상 + Deck 토글 상태 조회.
 * target이 null이면 notifications 채널 미등록(레거시 env 경로로 폴백).
 * deckKey를 넘기면 해당 Deck의 slackNotifyEnabled를 반환한다 — false면 호출자가 레거시 포함 전부 skip.
 * eventKey까지 넘기면 이벤트 단위 토글도 반영된다(togglable 이벤트가 off면 false).
 * deckKey 미지정이면 notifyEnabled는 항상 true(토글 무관).
 * GET /api/slack/notification-target?workspaceId=...&deckKey=...&eventKey=...
 */
export async function getSlackNotificationTarget(
  workspaceId: string,
  deckKey?: string,
  eventKey?: string
): Promise<SlackNotificationLookup> {
  const params = new URLSearchParams({ workspaceId })
  if (deckKey) params.set('deckKey', deckKey)
  if (eventKey) params.set('eventKey', eventKey)
  const response = await workerFetch(`/api/slack/notification-target?${params.toString()}`)
  const data = await response.json()
  return { target: data.target ?? null, notifyEnabled: data.notifyEnabled !== false }
}

/**
 * 재고 엑셀 파일 업로드 (multipart/form-data)
 * POST /api/inventory/upload-worker
 */
export async function uploadInventory(
  buffer: Buffer,
  fileName: string,
  workspaceId: string,
  snapshotDate?: string
): Promise<{
  success: boolean
  fileType: string
  totalRows: number
  insertedRows: number
  error?: string
}> {
  const formData = new FormData()
  formData.append('file', new Blob([new Uint8Array(buffer)]), fileName)
  formData.append('workspaceId', workspaceId)
  if (snapshotDate) {
    formData.append('snapshotDate', snapshotDate)
  }

  const url = `${getBaseUrl()}/api/inventory/upload-worker`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-worker-api-key': getWorkerApiKey(),
    },
    body: formData,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`API 요청 실패 [${response.status}]: /api/inventory/upload-worker — ${body}`)
  }

  return response.json()
}
