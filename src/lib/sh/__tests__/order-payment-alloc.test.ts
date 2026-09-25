import { allocateOrderPayment } from '@/lib/sh/order-payment-alloc'

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

describe('allocateOrderPayment', () => {
  it('단일 라인은 전액', () => {
    expect(allocateOrderPayment(19900, [1])).toEqual([19900])
  })

  it('수량 비례로 나눈다', () => {
    expect(allocateOrderPayment(30000, [2, 1])).toEqual([20000, 10000])
  })

  it('나누어떨어지지 않아도 합이 결제금액과 정확히 같다', () => {
    const out = allocateOrderPayment(10000, [1, 1, 1])
    expect(sum(out)).toBe(10000)
    expect(out).toEqual([3334, 3333, 3333])
  })

  it('미매칭 라인이 섞여도 그 몫이 0이 아니다 (정가 비례와의 차이)', () => {
    // 라인2가 미매칭이라 정가가 없어도 수량 가중치는 존재한다
    const out = allocateOrderPayment(30000, [1, 2])
    expect(out[1]).toBeGreaterThan(0)
    expect(sum(out)).toBe(30000)
  })

  it('paymentAmount 가 null 이면 전부 0 (잔액은 호출부가 미매칭으로 잡는다)', () => {
    expect(allocateOrderPayment(null, [1, 2])).toEqual([0, 0])
  })

  it('라인이 없으면 빈 배열', () => {
    expect(allocateOrderPayment(10000, [])).toEqual([])
  })

  it('수량 합이 0이면 전부 0 — 합이 결제금액과 달라진다(의도된 미매칭 잔액)', () => {
    const out = allocateOrderPayment(10000, [0, 0])
    expect(out).toEqual([0, 0])
    expect(10000 - sum(out)).toBe(10000)
  })

  it('음수 수량은 0으로 취급', () => {
    expect(allocateOrderPayment(10000, [-5, 1])).toEqual([0, 10000])
  })
})
