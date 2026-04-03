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
 * 리포트 파일 업로드
 * 워커가 다운로드한 Excel 파일을 Supabase Storage에 올린 뒤 처리 요청
 * POST /api/reports/upload
 */
export async function uploadReport(
  buffer: Buffer,
  fileName: string
): Promise<{
  uploadId: string
  inserted: number
  skipped: number
  totalRows: number
  insertedRows: number
  duplicateRows: number
}> {
  // 워커는 storagePath 방식 대신 직접 buffer를 전달해야 하므로
  // worker 전용 업로드 엔드포인트를 사용한다
  const response = await workerFetch('/api/collection/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'x-worker-api-key': getWorkerApiKey(),
      'x-file-name': encodeURIComponent(fileName),
    },
    body: buffer,
  })

  return response.json()
}
