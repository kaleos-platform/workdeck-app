// 브라우저 컨텍스트 인터페이스 (Playwright BrowserContext와 호환)
export interface BrowserContext {
  // 새 페이지 생성
  newPage(): Promise<unknown>
  // 컨텍스트 종료
  close(): Promise<void>
}

// 브라우저 제공자 인터페이스
// 로컬(Mac Mini Playwright) 또는 원격(클라우드) 브라우저를 추상화
export interface BrowserProvider {
  // 브라우저 컨텍스트를 시작하고 반환
  launch(): Promise<BrowserContext>
  // 브라우저 리소스 정리
  close(): Promise<void>
}
