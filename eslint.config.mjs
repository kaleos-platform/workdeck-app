import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import eslintConfigPrettier from 'eslint-config-prettier'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Prettier와 충돌하는 ESLint 규칙 비활성화 (항상 마지막에 배치)
  eslintConfigPrettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Prisma 자동 생성 파일 제외
    'src/generated/**',
  ]),
])

export default eslintConfig
