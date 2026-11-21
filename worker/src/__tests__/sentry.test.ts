/** @jest-environment node */

import type { ErrorEvent } from '@sentry/node'
import { scrubEvent } from '../sentry'

const ev = (e: Partial<ErrorEvent>) => scrubEvent({ type: undefined, ...e } as ErrorEvent)

describe('worker sentry scrubEvent', () => {
  it('로그인 실패는 한 그룹으로 묶는다', () => {
    const e = ev({
      logger: 'console',
      message: '수집 실패: 로그인 실패 — Akamai 봇 차단 (Access Denied)',
    })
    expect(e.fingerprint).toEqual(['worker-login-failure'])
  })

  it('외부 타임아웃은 마스킹 전 원문으로 판정해 한 그룹으로 묶는다', () => {
    const e = ev({
      exception: {
        values: [{ type: 'TimeoutError', value: 'page.goto: Timeout 30000ms exceeded.' }],
      },
    })
    expect(e.fingerprint).toEqual(['worker-external-timeout'])
  })

  it('그 외 에러는 기본 그룹핑을 쓴다', () => {
    expect(
      ev({ exception: { values: [{ type: 'TypeError', value: 'x is undefined' }] } }).fingerprint
    ).toBeUndefined()
  })

  it('console 이벤트는 첫 인자만 남기고 PII 를 가린다', () => {
    const e = ev({
      logger: 'console',
      message: '[manual] 상태 업데이트 실패: {"name":"홍길동"} a@b.com',
      extra: {
        arguments: ['[manual] 상태 업데이트 실패: a@b.com 01012345678', { name: '홍길동' }],
      },
      server_name: 'kaleos-Macmini',
      tags: { service: 'worker', host: 'x' },
    })
    expect(e.message).toBe('[manual] 상태 업데이트 실패: [redacted] [redacted]')
    expect(e.extra).toBeUndefined()
    expect(e.server_name).toBeUndefined()
    expect(e.tags).toEqual({ service: 'worker' })
  })

  it('예외가 둘째 인자인 console.error 는 첫 인자 라벨을 message 로 남긴다', () => {
    const e = ev({
      logger: 'console',
      exception: { values: [{ type: 'TypeError', value: 'x is undefined' }] },
      extra: { arguments: ['[manual-poller] 수집 실패 a@b.com', new Error('x')] },
    })
    expect(e.message).toBe('[manual-poller] 수집 실패 [redacted]')
  })
})
