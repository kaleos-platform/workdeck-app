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
}> {
  const formData = new FormData()
  formData.append('file', new Blob([buffer]), fileName)
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
