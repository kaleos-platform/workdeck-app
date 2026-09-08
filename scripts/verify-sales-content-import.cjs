/* eslint-disable @typescript-eslint/no-require-imports -- TypeScript 소스를 읽는 수동 CJS 검증 스크립트 */
// 공개 상품 한 건을 실제 Gemini로 분석하는 수동 검증. DB·워크스페이스 설정은 변경하지 않는다.
// 실행: node scripts/verify-sales-content-import.cjs [상품 URL]
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
require('@next/env').loadEnvConfig(process.cwd())

const originalResolve = Module._resolveFilename
Module._resolveFilename = function (id, ...args) {
  return originalResolve.call(
    this,
    id.startsWith('@/') ? path.join(process.cwd(), 'src', id.slice(2)) : id,
    ...args
  )
}
Module._extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  module._compile(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    filename
  )
}

// 검증은 DB 권한/쿼터 경로 대신 테스트용 환경 키를 사용한다. 실제 제품 호출은 generateTextForSpace를 사용한다.
const originalLoad = Module._load
Module._load = function (id, ...args) {
  if (id === '@/lib/ai/resolve')
    return {
      generateTextForSpace: async (_spaceId, request) => {
        const { GeminiApiProvider } = require('../src/lib/ai/providers/text-gemini-api.ts')
        const provider = new GeminiApiProvider()
        return {
          result: await provider.generate(request),
          providerName: provider.name,
          mode: 'WORKDECK',
        }
      },
    }
  return originalLoad.call(this, id, ...args)
}

async function main() {
  if (!process.env.GOOGLE_AI_API_KEY && !process.env.GEMINI_API_KEY)
    throw new Error('검증용 Gemini 키가 필요합니다')
  const {
    readProductPage,
    extractSalesProduct,
  } = require('../src/lib/sc/product-import/extract.ts')
  const source = await readProductPage(
    process.argv[2] || 'https://meaninglab.co.kr/product/detail.html?product_no=62'
  )
  const result = await extractSalesProduct('public-import-verification', source, '기업 ESG 담당자')
  if (!result.draft.name || !result.imageAnalysis.read)
    throw new Error('상품명 또는 이미지 분석 결과가 없습니다')
  console.log(JSON.stringify({ sourceUrl: source.sourceUrl, ...result }, null, 2))
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : '검증 실패')
  process.exitCode = 1
})
