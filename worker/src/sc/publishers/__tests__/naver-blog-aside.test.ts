/**
 * @jest-environment node
 */

// naver-blog-aside — 가짜 repl 로 단계 분기만 검증한다(실제 Aside·네이버 호출 없음).

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ASIDE_STEPS,
  NaverBlogAsidePublisher,
  readMarker,
  type AsideDeps,
  type ReplSession,
} from '../naver-blog-aside'
import type { PublishContext } from '../index'

jest.mock('../../job-poller', () => ({ markPublishAttempt: jest.fn() }))

type Answers = Partial<Record<string, string>>

function fakeRepl(answers: Answers, calls: string[]): ReplSession {
  return {
    async run(code) {
      calls.push(code)
      const key = /console\.log\('@@(\w+)/.exec(code)?.[1] ?? ''
      const out = answers[key] ?? `@@${key} {}`
      return { ok: true, out: `${out}\n[ok | 1ms]` }
    },
    async close() {},
  }
}

function ctx(over: { autoPublish?: boolean; attempted?: string | null; photo?: boolean } = {}): PublishContext {
  return {
    jobId: 'job1',
    deployment: {
      id: 'd1',
      targetUrl: 'https://t',
      shortSlug: 's',
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      publishAttemptedAt: over.attempted ?? null,
      publishSnapshot: {
        version: 1,
        title: '제목',
        blocks: [
          { kind: 'html', html: '<p>본문</p>' },
          ...(over.photo ? [{ kind: 'photo', index: 0, label: '사진', assetId: 'a1' }] : []),
        ],
        category: '환경교육 자료실',
        tags: ['환경교육'],
        autoPublish: over.autoPublish ?? true,
      },
    },
    channel: {
      id: 'c',
      name: '블로그',
      platform: 'BLOG_NAVER',
      publisherMode: 'ASIDE',
      config: { aside: { blogId: 'meaning-lab' } },
    },
    content: { id: 'x', title: '제목', doc: {} },
    assets: [{ id: 'a1', mimeType: 'image/png', slotKey: null, url: 'https://x.supabase.co/a.png', alt: null }],
    deploymentUrl: 'https://app/c/s',
  }
}

const OK_STATE = '@@STATE {"url":"https://blog.naver.com/PostWriteForm.naver","autosave":false,"editor":true}'
const OK_VERIFY = (images = 0, textLength = 2) =>
  `@@VERIFY {"images":${images},"placeholder":false,"textLength":${textLength},"title":"제목"}`
const OK_SETTINGS = '@@SETTINGS {"panel":true,"categoryOk":true,"public":true}'

function setup(answers: Answers, attemptOk = true) {
  const calls: string[] = []
  const deps: AsideDeps = {
    openRepl: async () => fakeRepl(answers, calls),
    markPublishAttempt: jest.fn().mockResolvedValue(attemptOk),
    fetchImage: jest.fn().mockResolvedValue(Buffer.from('img')),
    jobDir: () => mkdtempSync(join(tmpdir(), 'aside-')),
  }
  return { publisher: new NaverBlogAsidePublisher(deps), deps, calls }
}

describe('NaverBlogAsidePublisher', () => {
  it('발행 성공 시 글 주소를 돌려주고 발행 시도를 한 번 기록한다', async () => {
    const { publisher, deps, calls } = setup({
      STATE: OK_STATE,
      VERIFY: OK_VERIFY(1),
      SETTINGS: OK_SETTINGS,
      PUBLISHED: '@@PUBLISHED {"url":"https://blog.naver.com/meaning-lab/224500000000"}',
    })
    const r = await publisher.publish(ctx({ photo: true }))
    expect(r).toEqual({ ok: true, platformUrl: 'https://blog.naver.com/meaning-lab/224500000000' })
    expect(deps.markPublishAttempt).toHaveBeenCalledTimes(1)
    expect(deps.fetchImage).toHaveBeenCalledWith('https://x.supabase.co/a.png')
    // 본문은 코드에 이어 붙이지 않는다 — 파일(J)에서만 읽는다.
    expect(calls.join('\n')).not.toContain('<p>본문</p>')
  })

  it('리허설이면 임시저장까지만 하고 발행하지 않는다', async () => {
    const { publisher, deps } = setup({
      STATE: OK_STATE,
      VERIFY: OK_VERIFY(),
      DRAFT: '@@DRAFT {"before":5,"after":6}',
    })
    expect(await publisher.publish(ctx({ autoPublish: false }))).toEqual({ ok: true, draftSaved: true })
    expect(deps.markPublishAttempt).not.toHaveBeenCalled()
  })

  it('로그인이 풀리면 AUTH_FAILED', async () => {
    const { publisher } = setup({ STATE: '@@STATE {"url":"https://nid.naver.com/nidlogin.login","autosave":false,"editor":false}' })
    expect((await publisher.publish(ctx())).errorCode).toBe('AUTH_FAILED')
  })

  it('작성 중인 글 팝업이 있으면 건드리지 않고 사람 확인', async () => {
    const { publisher, calls } = setup({ STATE: OK_STATE.replace('"autosave":false', '"autosave":true') })
    expect((await publisher.publish(ctx())).errorCode).toBe('NEEDS_REVIEW')
    expect(calls.some((c) => c.includes('J.title'))).toBe(false)
  })

  it('이미 발행을 시도한 배포는 에디터를 열지 않는다', async () => {
    const { publisher, calls } = setup({})
    expect((await publisher.publish(ctx({ attempted: '2026-11-05T00:00:00Z' }))).errorCode).toBe('NEEDS_REVIEW')
    expect(calls).toHaveLength(0)
  })

  it('발행 시도 기록이 거부되면 발행 버튼을 누르지 않는다', async () => {
    const { publisher, calls } = setup({ STATE: OK_STATE, VERIFY: OK_VERIFY(), SETTINGS: OK_SETTINGS }, false)
    expect((await publisher.publish(ctx())).errorCode).toBe('NEEDS_REVIEW')
    expect(calls.some((c) => c === ASIDE_STEPS.publish())).toBe(false)
  })

  it('발행 뒤 주소를 못 찾으면 재시도 없이 사람 확인', async () => {
    const { publisher } = setup({
      STATE: OK_STATE,
      VERIFY: OK_VERIFY(),
      SETTINGS: OK_SETTINGS,
      PUBLISHED: '@@PUBLISHED {"url":"https://blog.naver.com/PostWriteForm.naver"}',
    })
    expect((await publisher.publish(ctx())).errorCode).toBe('NEEDS_REVIEW')
  })

  it('본문이 들어가지 않았으면 발행하지 않는다', async () => {
    const { publisher, deps } = setup({ STATE: OK_STATE, VERIFY: OK_VERIFY(0, 0) })
    expect((await publisher.publish(ctx())).errorCode).toBe('NEEDS_REVIEW')
    expect(deps.markPublishAttempt).not.toHaveBeenCalled()
  })

  it('사진 수가 맞지 않으면 발행하지 않는다', async () => {
    const { publisher, deps } = setup({ STATE: OK_STATE, VERIFY: OK_VERIFY(0) })
    expect((await publisher.publish(ctx({ photo: true }))).errorCode).toBe('NEEDS_REVIEW')
    expect(deps.markPublishAttempt).not.toHaveBeenCalled()
  })
})

describe('readMarker', () => {
  it('마커 줄의 JSON 을 읽는다', () => {
    expect(readMarker('x\n@@A {"n":1}\n[ok | 1ms]', 'A')).toEqual({ n: 1 })
    expect(readMarker('@@A nope', 'A')).toBeNull()
  })
})
