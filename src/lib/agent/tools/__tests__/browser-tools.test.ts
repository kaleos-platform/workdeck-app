/** @jest-environment node */
// browser 도구 scope — browser:read/write 는 폐지되어 브랜드 운영(sellerhub) scope 로 흡수됐다.
jest.mock('@/lib/prisma', () => ({ prisma: { browserWriteJob: { findFirst: jest.fn() } } }))
import { browserTools } from '../browser-tools'

it.each([
  ['browser_propose_cafe24_dev_check', 'sellerhub:write', 'write'],
  ['browser_get_write_job', 'sellerhub:read', 'read'],
])('%s 는 %s scope(%s)', (name, scope, mode) => {
  const t = browserTools.find((x) => x.name === name)!
  expect(t.scope).toBe(scope)
  expect(t.mode).toBe(mode)
})
