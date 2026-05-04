import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  dir: './',
})

const config: Config = {
  // 기본값 jsdom — 컴포넌트 테스트(.tsx)가 DOM API를 바로 사용할 수 있음.
  // node API(process.env inject 등)가 필요한 파일에는
  // 파일 최상단에 `// @jest-environment node` docblock을 추가한다.
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // worker 파일들이 ESM .js 확장자로 import — Jest(CJS) 에서는 확장자 없이 해석
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/', '<rootDir>/e2e/'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
}

export default createJestConfig(config)
