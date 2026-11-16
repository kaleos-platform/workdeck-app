import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 원본 npm tarball을 전달한다. 예: node scripts/verify-excalidraw-patches.mjs /tmp/excalidraw-excalidraw-0.18.1.tgz
const tarball = resolve(process.argv[2] ?? '')
assert.ok(
  process.argv[2] && existsSync(tarball),
  '원본 @excalidraw/excalidraw@0.18.1 npm tarball 경로가 필요합니다.'
)
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vendor = 'node_modules/@excalidraw/excalidraw'
const patches = [
  '@excalidraw+excalidraw+0.18.1.patch',
  '@excalidraw+excalidraw+0.18.1+002+opening-fonts.patch',
]
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
// 구버전 캐시에서 사용한 첫 patch가 바뀌면 이 회귀 검증의 전제도 깨진다.
assert.equal(
  sha256(join(repo, 'patches', patches[0])),
  '93936ee5af5a0c9aa0ec6a851882a89d569fafcf3a878db332d857e1e3f59054'
)
const files = [
  'dev/chunk-4FTI6OG3.js',
  'dev/index.js',
  'prod/chunk-K2UTITRG.js',
  'prod/index.js',
  'types/excalidraw/fonts/Fonts.d.ts',
  'types/excalidraw/index.d.ts',
]
const expected = files.map((file) => sha256(join(repo, vendor, 'dist', file)))
const temporary = mkdtempSync(join(tmpdir(), 'workdeck-excalidraw-patches-'))

function fixture(name) {
  const dir = join(temporary, name)
  mkdirSync(join(dir, vendor), { recursive: true })
  mkdirSync(join(dir, 'patches'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ private: true, dependencies: { '@excalidraw/excalidraw': '0.18.1' } })
  )
  execFileSync('tar', ['-xzf', tarball, '--strip-components=1', '-C', join(dir, vendor)])
  assert.equal(JSON.parse(readFileSync(join(dir, vendor, 'package.json'))).version, '0.18.1')
  return dir
}

function copyPatches(dir, names = patches) {
  for (const name of names) copyFileSync(join(repo, 'patches', name), join(dir, 'patches', name))
}

function apply(dir) {
  execFileSync(
    process.execPath,
    [join(repo, 'node_modules/patch-package/index.js'), '--error-on-fail'],
    { cwd: dir, stdio: 'pipe' }
  )
}

function checkRuntime(dir) {
  for (const [index, file] of files.entries())
    assert.equal(sha256(join(dir, vendor, 'dist', file)), expected[index], file)
  const state = JSON.parse(readFileSync(join(dir, vendor, '.patch-package.json')))
  assert.deepEqual(
    state.patches.map((patch) => patch.patchFilename),
    patches
  )
  assert.ok(state.patches.every((patch) => patch.didApply))
}

try {
  const clean = fixture('clean-install')
  copyPatches(clean)
  apply(clean)
  checkRuntime(clean)
  apply(clean)
  checkRuntime(clean)
  console.log('PASS: clean install + split-patch cache repeat; six runtime files match')

  const cached = fixture('old-radius-cache')
  copyPatches(cached, [patches[0]])
  apply(cached)
  assert.ok(!existsSync(join(cached, vendor, '.patch-package.json')))
  copyPatches(cached)
  apply(cached)
  checkRuntime(cached)
  apply(cached)
  checkRuntime(cached)
  console.log('PASS: old-radius cache upgrade + split-patch cache repeat; six runtime files match')
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
