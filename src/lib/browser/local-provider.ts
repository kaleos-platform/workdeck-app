import type { BrowserProvider, BrowserContext } from './browser-provider'

// Mac Mini 로컬 Playwright 브라우저 제공자 (스텁 구현)
// 실제 Playwright 로직은 워커 프로세스에서 구현 예정
export class LocalBrowserProvider implements BrowserProvider {
  private context: BrowserContext | null = null

  async launch(): Promise<BrowserContext> {
    // TODO: Playwright chromium.launch() → browser.newContext() 구현
    // 워커 프로세스에서 실제 Playwright 의존성과 함께 사용
    throw new Error('LocalBrowserProvider는 아직 구현되지 않았습니다. 워커 프로세스에서 사용하세요.')
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close()
      this.context = null
    }
  }
}
