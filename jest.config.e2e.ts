import nextJest from 'next/jest.js'

// E2E 전용 — 실제 라우트 핸들러 + dev DB(Prisma 7 WASM 런타임).
// next/jest 기본 transformIgnorePatterns가 node_modules 전체를 제외해 Prisma 런타임 .mjs를
// 변환하지 못하므로(=Unexpected token 'export'), @prisma/client 런타임만 변환 대상으로 되돌린다.
const createJestConfig = nextJest({ dir: './' })

const base = createJestConfig({
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/__tests__/**/routes.e2e.test.ts'],
})

export default async () => {
  const config = await base()
  config.transformIgnorePatterns = [
    '/node_modules/(?!(@prisma/client|\\.prisma|prisma)/)',
    '^.+\\.module\\.(css|sass|scss)$',
  ]
  return config
}
