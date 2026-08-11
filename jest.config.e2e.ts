import nextJest from 'next/jest.js'

// E2E 전용 — 실제 라우트 핸들러 + dev DB(Prisma 7 WASM 런타임).
// next/jest 기본 transformIgnorePatterns가 node_modules 전체를 제외해 Prisma 런타임 .mjs를
// 변환하지 못하므로(=Unexpected token 'export'), @prisma/client 런타임만 변환 대상으로 되돌린다.
const createJestConfig = nextJest({ dir: './' })

const base = createJestConfig({
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // 원격 dev DB 왕복이라 시드 beforeAll 이 jest 기본 5초를 넘긴다(네트워크 상태에 따라 flaky).
  // 로직 실패와 타임아웃 실패를 구분하기 위해 넉넉히 준다.
  testTimeout: 60_000,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/__tests__/**/*.e2e.test.ts'],
})

export default async () => {
  const config = await base()
  config.transformIgnorePatterns = [
    '/node_modules/(?!(@prisma/client|\\.prisma|prisma)/)',
    '^.+\\.module\\.(css|sass|scss)$',
  ]
  return config
}
