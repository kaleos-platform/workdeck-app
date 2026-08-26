// 제품코드 컬럼이 없는 재고 대조 파일용 합성 externalCode.
// InvLocationProductMap 이 (locationId, externalCode) 유니크라, 코드가 없으면 수동 매칭을
// 저장할 키 자체가 없다(= [상품 선택]이 무반응). 상품명+옵션명으로 안정적인 키를 만든다.
// xlsx 등 서버 전용 의존을 넣지 말 것 — 클라이언트 컴포넌트도 이 모듈을 import 한다.

export const SYNTHETIC_CODE_PREFIX = 'name:'
// export 엑셀 셀에 실릴 수 있으므로 제어문자 대신 출력 가능한 구분자를 쓴다.
const SEP = '::'

function norm(s?: string): string {
  return (s ?? '')
    .normalize('NFC') // 맥 엑셀 한글은 NFD — 정규화 안 하면 같은 파일이 다른 키가 된다
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase() // 매처 이름 폴백이 case-insensitive 라 키도 맞춘다
}

export function syntheticExternalCode(productName: string, optionName?: string): string {
  return `${SYNTHETIC_CODE_PREFIX}${norm(productName)}${SEP}${norm(optionName)}`
}

export function isSyntheticExternalCode(code?: string | null): boolean {
  return !!code && code.startsWith(SYNTHETIC_CODE_PREFIX)
}
