// jest-dom matchers (toBeInTheDocument, toHaveTextContent 등) 전역 등록
import '@testing-library/jest-dom'
import { TextDecoder, TextEncoder } from 'node:util'

// Jest의 테스트 VM 컨텍스트(jsdom/node 공통)에는 Node 전역 TextEncoder/TextDecoder가
// 자동으로 딸려오지 않는다. Prisma 7 런타임(@noble/hashes → cuid2)이 모듈 로드 시점에
// TextEncoder를 바로 참조하므로, prisma를 import하는 모듈을 테스트하면 즉시 죽는다.
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder
}
if (typeof globalThis.TextDecoder === 'undefined') {
  // Node util 타입과 lib.dom 타입이 미세하게 달라 캐스팅이 필요하다
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder
}

// Radix UI 컴포넌트가 jsdom 에서 필요로 하는 누락 API 폴리필
// DropdownMenu 등 Radix primitive가 내부적으로 참조함
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
}

// Radix Tooltip(@radix-ui/react-use-size) 이 마운트 시 ResizeObserver 를 참조한다. jsdom 에는
// 없으므로 no-op 스텁을 둔다 — 크기 측정 결과를 검증하는 테스트는 없다.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver
}
