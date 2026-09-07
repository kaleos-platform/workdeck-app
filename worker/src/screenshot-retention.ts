/**
 * 진단용 스크린샷 보존 정리
 *
 * `.screenshots` 는 로테이션이 없어 무한히 쌓인다(2026-08-08 정리 시점 1804개/1.2GB,
 * 최근 추세로 월 ~1GB 증가). 쿠팡 리포트 수집 범위가 14일이라 그보다 오래된 캡처는
 * 장애 진단에 쓰이지 않으므로 자동 삭제한다.
 */
import fs from 'fs'
import path from 'path'

const SCREENSHOT_DIR = path.resolve('.screenshots')
const RETENTION_DAYS = 14

/**
 * 보존 기간을 넘긴 스크린샷을 삭제한다.
 * 진단 보조 기능이므로 어떤 실패도 throw 하지 않는다(워커 기동을 막으면 안 된다).
 */
export function pruneScreenshots(): void {
  try {
    if (!fs.existsSync(SCREENSHOT_DIR)) return

    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000
    let removed = 0
    let bytes = 0

    for (const name of fs.readdirSync(SCREENSHOT_DIR)) {
      const filePath = path.join(SCREENSHOT_DIR, name)
      try {
        const stat = fs.statSync(filePath)
        if (!stat.isFile() || stat.mtimeMs >= cutoff) continue
        fs.unlinkSync(filePath)
        removed++
        bytes += stat.size
      } catch {
        // 개별 파일 실패는 무시하고 계속 — 동시에 쓰이는 중일 수 있다.
      }
    }

    if (removed > 0) {
      console.log(
        `[screenshots] ${RETENTION_DAYS}일 초과 ${removed}개 삭제 (${(bytes / 1048576).toFixed(1)}MB)`
      )
    }
  } catch (err) {
    console.warn(
      `[screenshots] 정리 실패(무시): ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
