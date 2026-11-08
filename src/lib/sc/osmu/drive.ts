// 구글 드라이브 연동 — 키 없는 구조: Vercel OIDC → GCP STS(WIF) → Space 전용 SA impersonate.
// Space 의 SA 는 서버가 DB(ScDriveConnection)에서만 고른다. 입력으로 SA·드라이브 id 를 받지 않는다(§10 P0).
// 스파이크(2026-11-06~08)로 STS·SA 생성·generateAccessToken·drives.get 까지 확인. 파일 목록·썸네일은 미검증.

import { createHash } from 'node:crypto'
import { getVercelOidcToken } from '@vercel/oidc'
import { prisma } from '@/lib/prisma'

const GCP_PROJECT = 'workdeck-drive-photos'
const GCP_PROJECT_NUMBER = '380076288367'
const WIF_PROVIDER = `//iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/vercel/providers/vercel`
const WIF_PRINCIPAL = `principalSet://iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/vercel/attribute.project/workdeck-app`
const DRIVE = 'https://www.googleapis.com/drive/v3'
const ALL_DRIVES = 'supportsAllDrives=true&includeItemsFromAllDrives=true'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}

async function json<T>(res: Response, what: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!res.ok)
    throw new DriveError(
      `${what} 실패(${res.status}): ${body.error?.message ?? ''}`.trim(),
      res.status
    )
  return body
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ─── GCP 토큰 ────────────────────────────────────────────────────────────────

let federated: { token: string; expiresAt: number } | null = null

/** Vercel OIDC 토큰을 GCP 연합 토큰으로 교환(만료 1분 전까지 재사용). */
async function federatedToken(): Promise<string> {
  if (federated && federated.expiresAt - 60_000 > Date.now()) return federated.token
  const subjectToken = await getVercelOidcToken()
  const res = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience: WIF_PROVIDER,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
      subjectToken,
    }),
  })
  const body = await json<{ access_token: string; expires_in: number }>(res, 'GCP 토큰 교환')
  federated = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 }
  return body.access_token
}

/** 환경 접두 + spaceId 해시. 운영/개발 SA 가 섞이지 않게 한다(GCP accountId 6~30자, 소문자 시작). */
export function serviceAccountIdFor(spaceId: string, production: boolean): string {
  const hash = createHash('sha256').update(spaceId).digest('hex').slice(0, 20)
  return `${production ? 'wd-p-' : 'wd-d-'}${hash}`
}

function isProduction() {
  return process.env.VERCEL_ENV === 'production'
}

/**
 * Space 전용 SA 를 만들고(이미 있으면 재사용) 이 SA 에만 TokenCreator 를 준 뒤 연결을 저장한다.
 * 반환한 이메일을 사람이 공유 드라이브(뷰어)에 추가해야 읽을 수 있다.
 */
export async function ensureSpaceServiceAccount(spaceId: string): Promise<string> {
  const existing = await prisma.scDriveConnection.findUnique({
    where: { spaceId },
    select: { serviceAccountEmail: true },
  })
  if (existing) return existing.serviceAccountEmail

  const token = await federatedToken()
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const accountId = serviceAccountIdFor(spaceId, isProduction())
  const email = `${accountId}@${GCP_PROJECT}.iam.gserviceaccount.com`

  const created = await fetch(
    `https://iam.googleapis.com/v1/projects/${GCP_PROJECT}/serviceAccounts`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ accountId, serviceAccount: { displayName: `workdeck ${spaceId}` } }),
    }
  )
  // 409 = 이전 시도에서 이미 만들어짐 → 그대로 이어간다.
  if (created.status !== 409) await json(created, 'SA 생성')

  // SA 단위 TokenCreator — 프로젝트 전체 부여 대신(§10). 생성 직후엔 전파 지연으로 404 가 날 수 있다.
  const resource = `https://iam.googleapis.com/v1/projects/${GCP_PROJECT}/serviceAccounts/${email}`
  for (let i = 0; ; i++) {
    const res = await fetch(`${resource}:setIamPolicy`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        policy: {
          bindings: [{ role: 'roles/iam.serviceAccountTokenCreator', members: [WIF_PRINCIPAL] }],
        },
      }),
    })
    if (res.ok) break
    if (res.status !== 404 || i >= 5) await json(res, 'SA 권한 부여')
    await sleep(5000)
  }

  await prisma.scDriveConnection.create({ data: { spaceId, serviceAccountEmail: email } })
  return email
}

/** Space SA 로 drive.readonly 토큰(10분). 연결이 없으면 오류. */
export async function driveTokenForSpace(spaceId: string): Promise<string> {
  const conn = await prisma.scDriveConnection.findUnique({
    where: { spaceId },
    select: { serviceAccountEmail: true },
  })
  if (!conn) throw new DriveError('드라이브 연결이 없습니다')
  const token = await federatedToken()
  // 신규 SA·바인딩은 전파에 1~3분 — 짧게 재시도하고 그래도 안 되면 다음 cron 에 맡긴다.
  for (let i = 0; ; i++) {
    const res = await fetch(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${conn.serviceAccountEmail}:generateAccessToken`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: ['https://www.googleapis.com/auth/drive.readonly'],
          lifetime: '600s',
        }),
      }
    )
    if (res.ok) return (await res.json()).accessToken as string
    if (i >= 2 || (res.status !== 403 && res.status !== 404)) await json(res, '드라이브 토큰 발급')
    await sleep(5000)
  }
}

// ─── 드라이브 조회 ───────────────────────────────────────────────────────────

export type DriveFile = {
  id: string
  name: string
  mimeType: string
  driveId?: string
  parents?: string[]
  md5Checksum?: string
  modifiedTime: string
  thumbnailLink?: string
  imageMediaMetadata?: { time?: string; width?: number; height?: number }
}

const FILE_FIELDS =
  'id,name,mimeType,driveId,parents,md5Checksum,modifiedTime,thumbnailLink,imageMediaMetadata(time,width,height)'

export async function getDriveFile(token: string, fileId: string): Promise<DriveFile> {
  const res = await fetch(
    `${DRIVE}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${FILE_FIELDS}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  return json<DriveFile>(res, '드라이브 파일 조회')
}

/** 폴더 바로 아래 항목 한 페이지. pageToken 으로 이어 받는다(커서는 호출자가 저장). */
export async function listFolderPage(
  token: string,
  folderId: string,
  pageToken?: string
): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  const q = encodeURIComponent(`'${folderId.replace(/'/g, '')}' in parents and trashed=false`)
  const res = await fetch(
    `${DRIVE}/files?${ALL_DRIVES}&pageSize=200&fields=nextPageToken,files(${FILE_FIELDS})&q=${q}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''),
    { headers: { Authorization: `Bearer ${token}` } }
  )
  return json(res, '드라이브 폴더 조회')
}

/** 썸네일(JPEG) 다운로드. HEIC 도 썸네일은 JPEG 라 게시용은 =s2048 을 쓴다. */
export async function downloadThumbnail(
  token: string,
  file: DriveFile,
  size = 2048
): Promise<{ bytes: Buffer; mimeType: string }> {
  if (!file.thumbnailLink) throw new DriveError(`썸네일이 없는 파일입니다: ${file.name}`)
  const url = file.thumbnailLink.replace(/=s\d+$/, `=s${size}`)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new DriveError(`썸네일 다운로드 실패(${res.status})`, res.status)
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    mimeType: res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg',
  }
}

/** 폴더가 허용 root 안인지. root 는 공유 드라이브 id(하위 폴더 조상 탐색은 안 함). 미설정이면 거부. */
export function isWithinRoot(folder: DriveFile, rootId: string | null): boolean {
  if (!rootId) return false
  return folder.driveId === rootId || folder.id === rootId
}
