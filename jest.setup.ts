// jest-dom matchers (toBeInTheDocument, toHaveTextContent 등) 전역 등록
import '@testing-library/jest-dom'

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
