/** @jest-environment node */
import { fetchWekeepInventory, WekeepError } from '../wekeep-client'

const PW = 'S3cretPw!zz'
const cred = { username: 'u', password: PW }
const loginOk = () =>
  new Response(null, {
    status: 302,
    headers: { location: '/fbw/clientMain.do', 'set-cookie': 'JSESSIONID=abc; Path=/; HttpOnly' },
  })
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
const item = (n: number) => ({
  skuNo: `S${n}`,
  productName: `p${n}`,
  availableQty: n,
  reserveQty: 1,
  faultyQty: 2,
  damageQty: 3,
})

describe('fetchWekeepInventory', () => {
  it('2페이지를 모아 반환하고 쿠키를 보낸다', async () => {
    const f = jest
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        json({ result: true, data: { inventoryCnt: 3, inventoryList: [item(1), item(2)] } })
      )
      .mockResolvedValueOnce(
        json({ result: true, data: { inventoryCnt: 3, inventoryList: [item(3)] } })
      )
    const rows = await fetchWekeepInventory(cred, f)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({
      skuNo: 'S1',
      productName: 'p1',
      available: 1,
      reserve: 1,
      faulty: 2,
      damage: 3,
    })
    expect(f).toHaveBeenCalledTimes(3)
    expect(f.mock.calls[1][1].headers.cookie).toBe('JSESSIONID=abc')
  })

  const fails = async (f: jest.Mock, code: string) => {
    const err = await fetchWekeepInventory(cred, f).catch((e) => e)
    expect(err).toBeInstanceOf(WekeepError)
    expect(err.code).toBe(code)
    expect(err.message).not.toContain(PW)
    expect(String(err.stack)).not.toContain(PW)
  }

  it('로그인 페이지로 리다이렉트 → LOGIN_FAILED', () =>
    fails(
      jest
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 302, headers: { location: '/fbw/member/login.do?error' } })
        ),
      'LOGIN_FAILED'
    ))

  it('재고 응답이 HTML → LOGIN_FAILED', () =>
    fails(
      jest
        .fn()
        .mockResolvedValueOnce(loginOk())
        .mockResolvedValueOnce(
          new Response('<html>login</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        ),
      'LOGIN_FAILED'
    ))

  it('result false → UNEXPECTED', () =>
    fails(
      jest
        .fn()
        .mockResolvedValueOnce(loginOk())
        .mockResolvedValueOnce(json({ result: false })),
      'UNEXPECTED'
    ))

  it('네트워크 오류 → BLOCKED (원인 메시지에 비밀번호 없음)', () =>
    fails(jest.fn().mockRejectedValue(new Error(`boom ${PW}`)), 'BLOCKED'))
})
