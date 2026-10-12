/**
 * 사용자에게 메시지를 그대로 보여도 되는 도구 오류(도메인 오류). 이 클래스(와 하위 클래스)가 아닌 오류는
 * runTool·호출 경로에서 일반 문구로 바뀌고, 원문은 마스킹해 감사 행·서버 로그에만 남는다.
 */
export class ToolUserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolUserError'
  }
}
