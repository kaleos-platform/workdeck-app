import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unwrapWriteResult, CoupangWriteError } from '../write-result.js'

// 실물 성공 응답 — 성공 판정은 HTTP 200 이 아니라 중첩된 data.code 다.
const SUCCESS = {
  code: '200',
  message: '',
  data: { code: 'SUCCESS', message: '', data: 427011919 },
}

test('성공 — 중첩 data.code 가 SUCCESS 면 내부 data 를 돌려준다', () => {
  assert.equal(unwrapWriteResult(SUCCESS, 200), 427011919)
})

test('HTTP 200 이어도 중첩 code 가 ERROR 면 실패로 던진다', () => {
  const body = {
    code: '200',
    message: '',
    data: { code: 'ERROR', message: '삭제된 상품은 변경이 불가능합니다', data: null },
  }
  assert.throws(
    () => unwrapWriteResult(body, 200),
    (err: unknown) =>
      err instanceof CoupangWriteError && err.coupangMessage === '삭제된 상품은 변경이 불가능합니다'
  )
})

test('HTTP 400 — 최상위 message 를 사람이 읽을 사유로 쓴다', () => {
  const body = {
    code: '400',
    message: '변경전 판매가의 최대 50% 인하/최대 100%인상까지 변경가능합니다.',
  }
  assert.throws(
    () => unwrapWriteResult(body, 400),
    (err: unknown) =>
      err instanceof CoupangWriteError &&
      err.coupangMessage.includes('최대 50% 인하') &&
      err.httpStatus === 400
  )
})

test('예상 밖 형태 — 조용히 성공 처리하지 않는다', () => {
  assert.throws(() => unwrapWriteResult({ ok: true }, 200), CoupangWriteError)
  assert.throws(() => unwrapWriteResult(null, 200), CoupangWriteError)
})

test('중첩 data.code 가 SUCCESS 도 ERROR 도 아닐 때 — 알 수 없는 형태로 던진다', () => {
  const body = {
    data: { code: 'UNKNOWN' },
  }
  assert.throws(
    () => unwrapWriteResult(body, 200),
    (err: unknown) =>
      err instanceof CoupangWriteError && err.coupangMessage.includes('알 수 없는 응답 형태')
  )
})

test('SUCCESS 이어도 내부 data 가 숫자가 아니면 0 을 돌려준다', () => {
  const body = {
    code: '200',
    message: '',
    data: { code: 'SUCCESS', message: '', data: 'not-a-number' },
  }
  assert.equal(unwrapWriteResult(body, 200), 0)
})
