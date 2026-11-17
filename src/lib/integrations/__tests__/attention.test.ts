import { buildAttention, coupangProbeError } from '../attention'

const now = new Date('2026-11-01T00:00:00Z')
const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000)
const empty = { coupangError: null, agents: [], envSecrets: [], now }

describe('buildAttention', () => {
  it('문제가 없으면 비어 있다', () => {
    expect(
      buildAttention({
        ...empty,
        agents: [
          { name: '무기한', tokens: [{ expiresAt: null }] },
          { name: '여유', tokens: [{ expiresAt: inDays(8) }] },
          { name: '토큰 없음', tokens: [] },
        ],
        envSecrets: [{ name: 'ok', expiresAt: inDays(30) }],
      })
    ).toEqual([])
  })

  it('쿠팡 오류를 첫 항목으로 올린다', () => {
    const items = buildAttention({
      ...empty,
      coupangError: 'IP 미등록',
      envSecrets: [{ name: 'github-read', expiresAt: inDays(-1) }],
    })
    expect(items.map((i) => i.tab)).toEqual(['services', 'secrets'])
    expect(items[0].message).toBe('쿠팡 Open API — IP 미등록')
    expect(items[1].message).toBe('비밀값 만료 — github-read')
  })

  it('7일 경계와 남은 일수를 표시한다', () => {
    const items = buildAttention({
      ...empty,
      agents: [{ name: 'Claude 공용', tokens: [{ expiresAt: inDays(7) }] }],
    })
    expect(items).toEqual([
      { tab: 'agents', cardId: 'agent-tokens', message: '토큰 7일 뒤 만료 — Claude 공용' },
    ])
  })

  it('새 토큰으로 교체했으면 옛 토큰을 경고하지 않는다', () => {
    expect(
      buildAttention({
        ...empty,
        agents: [
          { name: '교체됨', tokens: [{ expiresAt: inDays(-30) }, { expiresAt: inDays(90) }] },
        ],
      })
    ).toEqual([])
  })
})

describe('coupangProbeError', () => {
  it('성공과 결과 없음은 경고하지 않는다', () => {
    expect(
      coupangProbeError({ status: 'COMPLETED', error: null, probeResult: { ok: true } })
    ).toBeNull()
    expect(coupangProbeError({ status: 'COMPLETED', error: null, probeResult: null })).toBeNull()
  })

  it('IP 차단과 실패 사유를 구분한다', () => {
    expect(
      coupangProbeError({
        status: 'FAILED',
        error: null,
        probeResult: { ok: false, ipBlocked: true },
      })
    ).toBe('워커 IP가 Wing 허용목록에 없음')
    expect(coupangProbeError({ status: 'FAILED', error: '워커 오류', probeResult: null })).toBe(
      '워커 오류'
    )
  })
})
