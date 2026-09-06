import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { buildSignedDate, buildMessage, buildAuthorization } from '../signature.js'

// 문서(https://developers.coupang.com/hc/ko/articles/360033461914)에 실제 서명 결과값
// 예시가 없어 공식 테스트 벡터는 없다. 대신 node:crypto로 독립 재계산한 값과
// 대조해 구현이 문서에 적힌 message/포맷 규칙을 정확히 따르는지 회귀 검증한다.

const FIXED_NOW = new Date(Date.UTC(2018, 7, 9, 10, 15, 30)) // 2018-08-09 10:15:30 UTC
const ACCESS_KEY = 'test-access-key'
const SECRET_KEY = 'test-secret-key'
const PATH = '/v2/providers/rg_open_api/apis/api/v1/vendors/A00123456/rg/inventory/summaries'
const QUERY = 'nextToken=abc'

test("buildSignedDate — GMT+0 yyMMdd'T'HHmmss'Z' 포맷", () => {
  assert.equal(buildSignedDate(FIXED_NOW), '180809T101530Z')
})

test('buildSignedDate — 자정 근처도 자릿수 패딩 유지', () => {
  const d = new Date(Date.UTC(2026, 0, 5, 3, 4, 5))
  assert.equal(buildSignedDate(d), '260105T030405Z')
})

test('buildMessage — signedDate+method+path+query 순서로 이어붙임, 구분자 없음', () => {
  const message = buildMessage({
    signedDate: '180809T101530Z',
    method: 'GET',
    path: PATH,
    query: QUERY,
  })
  assert.equal(message, `180809T101530Z${'GET'}${PATH}${QUERY}`)
})

test('buildMessage — 빈 query 도 그대로 이어붙임(별도 구분자 없음)', () => {
  const message = buildMessage({
    signedDate: '180809T101530Z',
    method: 'GET',
    path: PATH,
    query: '',
  })
  assert.equal(message, `180809T101530Z${'GET'}${PATH}`)
})

test('buildAuthorization — CEA 헤더 포맷 + HmacSHA256 서명이 독립 재계산과 일치', () => {
  const header = buildAuthorization({
    method: 'GET',
    path: PATH,
    query: QUERY,
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    now: FIXED_NOW,
  })

  const expectedSignedDate = '180809T101530Z'
  const expectedMessage = `${expectedSignedDate}GET${PATH}${QUERY}`
  const expectedSignature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(expectedMessage, 'utf8')
    .digest('hex')
  const expected = `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${expectedSignedDate}, signature=${expectedSignature}`

  assert.equal(header, expected)
})

test('buildAuthorization — method 는 대문자로 정규화되어 서명에 반영됨', () => {
  const lower = buildAuthorization({
    method: 'get',
    path: PATH,
    query: QUERY,
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    now: FIXED_NOW,
  })
  const upper = buildAuthorization({
    method: 'GET',
    path: PATH,
    query: QUERY,
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    now: FIXED_NOW,
  })
  assert.equal(lower, upper)
})

test('buildAuthorization — 서명은 첫 문자 "CEA algorithm=HmacSHA256, "로 고정 프리픽스', () => {
  const header = buildAuthorization({
    method: 'GET',
    path: PATH,
    query: '',
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    now: FIXED_NOW,
  })
  assert.match(
    header,
    /^CEA algorithm=HmacSHA256, access-key=test-access-key, signed-date=180809T101530Z, signature=[0-9a-f]{64}$/
  )
})
