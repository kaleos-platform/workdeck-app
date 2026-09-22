/** @jest-environment node */
import { execFileSync } from 'node:child_process'

// 실제 RSC 렌더러에서 요청 내 중복 제거와 요청 간 격리를 확인한다.
test('사용자와 멤버십은 렌더링 안에서 공유하고 다음 요청에서는 다시 확인한다', () => {
  const script = String.raw`
    const assert = require('node:assert/strict')
    const fs = require('node:fs')
    const Module = require('node:module')
    const ts = require('typescript')
    const React = require('react')
    const { renderToReadableStream } = require('next/dist/compiled/react-server-dom-webpack/server.node')
    let userId = 'first'
    let userCalls = 0
    let membershipCalls = 0
    const originalLoad = Module._load
    let userModule
    Module._load = function (id, ...args) {
      if (id === '@/lib/supabase/server') return { createClient: async () => ({ auth: { getUser: async () => {
        userCalls++
        return { data: { user: userId ? { id: userId } : null } }
      } } }) }
      if (id === '@/hooks/use-user') return userModule.exports
      if (id === '@/lib/prisma') return { prisma: { spaceMember: { findFirst: async ({ where }) => {
        membershipCalls++
        return { space: { id: where.userId, name: where.userId }, role: 'OWNER' }
      } } } }
      if (id === '@/lib/coupang-ads/server-timing') return { measureCoupangAds: (_name, fn) => fn() }
      if (id === 'next/server') return { NextResponse: { json: (_body, init) => ({ status: init.status }) } }
      if (id === 'next/headers') return { headers: async () => new Headers() }
      return originalLoad.call(this, id, ...args)
    }
    function load(file) {
      const path = process.cwd() + '/' + file
      const m = new Module(path, module)
      m.filename = path
      m.paths = module.paths
      m._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }).outputText, path)
      return m
    }
    userModule = load('src/hooks/use-user.ts')
    const { getUser } = userModule.exports
    const { resolveSpaceContext } = load('src/lib/api-helpers.ts').exports
    async function Component() {
      const users = await Promise.all([getUser(), getUser(), getUser()])
      assert.deepEqual(users.map(user => user?.id ?? null), [userId, userId, userId])
      const spaces = await Promise.all([resolveSpaceContext(), resolveSpaceContext()])
      if (userId) assert.deepEqual(spaces.map(result => result.space.id), [userId, userId])
      else assert.deepEqual(spaces.map(result => result.error.status), [401, 401])
      return React.createElement('p', null, 'verified')
    }
    ;(async () => {
      for (const id of ['first', 'second', null, 'first']) {
        userId = id
        const errors = []
        const stream = await renderToReadableStream(React.createElement(Component), {}, {
          onError: error => errors.push(error.message)
        })
        await new Response(stream).text()
        assert.deepEqual(errors, [])
      }
      assert.equal(userCalls, 4, '각 RSC 요청마다 사용자 조회는 한 번이어야 한다')
      assert.equal(membershipCalls, 3, '인증된 RSC 요청마다 멤버십 조회는 한 번이어야 한다')
    })().catch(error => { console.error(error.message); process.exitCode = 1 })
  `
  execFileSync(process.execPath, ['--conditions', 'react-server', '-e', script], {
    cwd: process.cwd(),
    timeout: 15_000,
    stdio: 'pipe',
  })
})
