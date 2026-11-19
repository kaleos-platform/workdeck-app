/** @jest-environment node */
// 액션 정의 분류표(plan 2026-11-18-agent-deck-rw-permissions) — scope 와 external(승인 필수) 지정을 고정한다.
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
import { isExternalParams } from '../decision-policy'
import { listActionDefinitions, getActionDefinition } from '../registry'
import { isDeckWriteScope } from '@/lib/agent/identity/principal'

const defs = listActionDefinitions()

it('모든 액션 정의에 쓰기 scope 가 있다', () => {
  for (const d of defs) expect(d.scope.endsWith(':write')).toBe(true)
})

it('내부(바로 실행) 액션의 scope 는 업무 쓰기 scope 다(비밀값 제외)', () => {
  for (const d of defs) if (!isExternalParams(d, {})) expect(isDeckWriteScope(d.scope)).toBe(true)
})

const INTERNAL = [
  ['seller-hub.reorder.plan.create', 'sellerhub:write'],
  ['seller-hub.keywords.update', 'sellerhub:write'],
  ['recruiting.posting.create_draft', 'hiring:write'],
  ['recruiting.posting.update_draft', 'hiring:write'],
  ['sales-content.setup.apply', 'sc:write'],
  ['coupang-ads.analysis.trigger', 'ads:write'],
] as const
it.each(INTERNAL)('%s 는 내부(바로 실행) · %s', (type, scope) => {
  const d = getActionDefinition(type)!
  expect(d.scope).toBe(scope)
  expect(isExternalParams(d, {})).toBe(false)
})

it('finance 재분류: learn 기본/true 는 승인, learn:false 만 바로 실행', () => {
  const d = getActionDefinition('finance.transaction.reclassify')!
  expect(d.scope).toBe('finance:write')
  expect(isExternalParams(d, { transactionId: 't', categoryId: 'c' })).toBe(true)
  expect(isExternalParams(d, { transactionId: 't', categoryId: 'c', learn: true })).toBe(true)
  expect(isExternalParams(d, { transactionId: 't', categoryId: 'c', learn: false })).toBe(false)
})

const EXTERNAL = [
  'finance.classrule.create',
  'coupang-ads.execution.approve',
  'sales-content.post.publish',
  'secret.http.request',
]
it.each(EXTERNAL)('%s 는 외부(승인 필수)', (type) => {
  expect(isExternalParams(getActionDefinition(type)!, {})).toBe(true)
})

it('meta-ads.*·google-marketing.*·browser 는 전부 외부(승인 필수)', () => {
  const group = defs.filter(
    (d) => /^(meta-ads|google-marketing)\./.test(d.actionType) || /browser/i.test(d.actionType)
  )
  expect(group.length).toBeGreaterThan(5)
  for (const d of group) expect(isExternalParams(d, {})).toBe(true)
  expect(
    getActionDefinition(group.find((d) => /browser/i.test(d.actionType))!.actionType)!.scope
  ).toBe('sellerhub:write')
})

it('나머지 모든 액션은 위 표에 있다(새 액션은 분류를 정해야 한다)', () => {
  const known = new Set<string>([
    ...INTERNAL.map((x) => x[0]),
    'finance.transaction.reclassify',
    ...EXTERNAL,
  ])
  const rest = defs.filter(
    (d) =>
      !known.has(d.actionType) &&
      !/^(meta-ads|google-marketing)\./.test(d.actionType) &&
      !/browser/i.test(d.actionType)
  )
  expect(rest.map((d) => d.actionType)).toEqual([])
})
