/** @jest-environment node */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWorker } from '@/lib/worker-auth'
import { claimJobs, enqueueJob } from '@/lib/sc/jobs'
import { readChannelCredential } from '@/lib/sc/credentials'
import { GET as pendingRuns } from '../../../app/api/collection/runs/pending/route'
import { GET as notificationTarget } from '../../../app/api/slack/notification-target/route'
import { POST as completeScJob } from '../../../app/api/sc/jobs/[id]/complete/route'
import {
  GET as scJobsWorkerGet,
  POST as scJobsWorkerPost,
} from '../../../app/api/sc/jobs/worker/route'
import { POST as analysisTrigger } from '../../../app/api/analysis/trigger/route'
import { headers } from 'next/headers'
import { resolveWorkspace } from '@/lib/api-helpers'
import { resolveCollectionAuth } from '@/lib/collection/resolve-workspace'

jest.mock('next/headers', () => ({ headers: jest.fn() }))
jest.mock('@/lib/worker-auth', () => {
  const actual = jest.requireActual('@/lib/worker-auth')
  return { ...actual, authenticateWorker: jest.fn() }
})
jest.mock('@/lib/prisma', () => ({
  prisma: {
    collectionRun: { findMany: jest.fn() },
    salesContentJob: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    contentDeployment: { findFirst: jest.fn() },
  },
}))
jest.mock('@/lib/sc/jobs', () => ({
  ...jest.requireActual('@/lib/sc/jobs'),
  claimJobs: jest.fn(),
  enqueueJob: jest.fn(),
  reapStaleClaims: jest.fn().mockResolvedValue(0),
}))
jest.mock('@/lib/sc/credentials', () => ({
  readChannelCredential: jest.fn().mockResolvedValue({ payload: { secret: 'x' }, expiresAt: null }),
  readChannelCredentialSealed: jest
    .fn()
    .mockResolvedValue({ encryptedPayload: 'v1:k1:a:b:c', iv: 'v1', expiresAt: null }),
}))
jest.mock('@/lib/domain', () => ({ getAppOrigin: () => 'https://app.test' }))
jest.mock('@/lib/billing/entitlement', () => ({
  canWorkspaceCollect: jest.fn().mockResolvedValue(true),
}))
jest.mock('@/lib/slack/notification-target', () => ({
  resolveSlackNotificationTarget: jest.fn().mockResolvedValue(null),
  resolveDeckNotifyEnabled: jest.fn().mockResolvedValue(true),
}))

const auth = authenticateWorker as jest.Mock
const mock = prisma as unknown as {
  collectionRun: { findMany: jest.Mock }
  salesContentJob: { findUnique: jest.Mock; updateMany: jest.Mock }
  contentDeployment: { findFirst: jest.Mock }
}
const SPACE_A = { kind: 'space', tokenId: 't1', spaceId: 'space-a', workspaceId: 'ws-a' }

beforeEach(() => {
  jest.clearAllMocks()
  auth.mockResolvedValue({ scope: SPACE_A })
})

test('runs/pending 은 토큰의 워크스페이스로만 조회한다', async () => {
  mock.collectionRun.findMany.mockResolvedValue([])
  await pendingRuns(new NextRequest('http://t/api/collection/runs/pending'))
  expect(mock.collectionRun.findMany.mock.calls[0][0].where.workspaceId).toBe('ws-a')
})

test('notification-target: 다른 Space 워크스페이스 → 403', async () => {
  const res = await notificationTarget(
    new NextRequest('http://t/api/slack/notification-target?workspaceId=ws-b')
  )
  expect(res.status).toBe(403)
})

test('sc job complete: 다른 Space 의 job → 404(존재 은닉), 갱신 없음', async () => {
  mock.salesContentJob.findUnique.mockResolvedValue({
    id: 'j1',
    spaceId: 'space-b',
    status: 'CLAIMED',
  })
  const res = await completeScJob(
    new NextRequest('http://t/api/sc/jobs/j1/complete', {
      method: 'POST',
      body: JSON.stringify({ ok: true }),
    }),
    { params: Promise.resolve({ id: 'j1' }) }
  )
  expect(res.status).toBe(404)
  expect(mock.salesContentJob.updateMany).not.toHaveBeenCalled()
})

test('sc jobs worker GET: 다른 Space 배포를 가리키는 job 에는 컨텍스트·자격증명을 붙이지 않는다', async () => {
  ;(claimJobs as jest.Mock).mockResolvedValue([
    { id: 'j1', spaceId: 'space-a', kind: 'PUBLISH', targetId: 'deploy-of-b' },
  ])
  mock.contentDeployment.findFirst.mockResolvedValue(null) // job.spaceId 조건으로 조회하므로 B 의 배포는 안 잡힌다
  const res = await scJobsWorkerGet(new NextRequest('http://t/api/sc/jobs/worker'))
  const body = await res.json()
  expect(mock.contentDeployment.findFirst.mock.calls[0][0].where).toEqual({
    id: 'deploy-of-b',
    spaceId: 'space-a',
    content: { spaceId: 'space-a' },
    channel: { spaceId: 'space-a' },
  })
  expect(body.jobs[0]).toEqual({ job: expect.objectContaining({ id: 'j1' }) })
  expect(readChannelCredential).not.toHaveBeenCalled()
  expect((claimJobs as jest.Mock).mock.calls[0][0].spaceId).toBe('space-a')
})

test('sc jobs worker POST: 다른 Space 배포를 targetId 로 enqueue → 404, enqueue 없음', async () => {
  const SPACE_ID = 'cspaceaaaaaaaaaa1' // enqueueSchema 가 cuid 형식을 요구한다
  auth.mockResolvedValue({ scope: { ...SPACE_A, spaceId: SPACE_ID } })
  mock.contentDeployment.findFirst.mockResolvedValue(null)
  const res = await scJobsWorkerPost(
    new NextRequest('http://t/api/sc/jobs/worker', {
      method: 'POST',
      body: JSON.stringify({ spaceId: SPACE_ID, kind: 'PUBLISH', targetId: 'deploy-of-b' }),
    })
  )
  expect(res.status).toBe(404)
  expect(mock.contentDeployment.findFirst.mock.calls[0][0].where).toEqual({
    id: 'deploy-of-b',
    spaceId: SPACE_ID,
  })
  expect(enqueueJob).not.toHaveBeenCalled()
})

test('인증 실패는 그대로 401', async () => {
  const { NextResponse } = jest.requireActual('next/server')
  auth.mockResolvedValue({ error: NextResponse.json({}, { status: 401 }) })
  const res = await pendingRuns(new NextRequest('http://t/api/collection/runs/pending'))
  expect(res.status).toBe(401)
})

test('resolveWorkspace: x-workspace-id 가 다른 Space 의 워크스페이스면 403', async () => {
  ;(headers as jest.Mock).mockResolvedValue(
    new Headers({ 'x-worker-api-key': 'wdw_a', 'x-workspace-id': 'ws-b' })
  )
  const res = await resolveWorkspace()
  expect('error' in res && res.error?.status).toBe(403)
})

test('resolveCollectionAuth: x-workspace-id 가 다른 Space 의 워크스페이스면 403', async () => {
  const res = await resolveCollectionAuth(
    new NextRequest('http://t/api/collection/source-setting', {
      headers: { 'x-worker-api-key': 'wdw_a', 'x-workspace-id': 'ws-b' },
    })
  )
  expect('error' in res && res.error.status).toBe(403)
})

test('analysis/trigger: 워커 요청 본문이 JSON 이 아니면 400', async () => {
  const res = await analysisTrigger(
    new NextRequest('http://t/api/analysis/trigger', {
      method: 'POST',
      headers: { 'x-worker-api-key': 'wdw_a' },
      body: '{not json',
    })
  )
  expect(res?.status).toBe(400)
})
