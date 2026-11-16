// 자주 쓰는 메시지 변수 치환({이름} {공고명} {직무}) + 문자 앱용 전화번호 정규화.
export type MessageVars = {
  name?: string | null
  postingTitle?: string | null
  positionName?: string | null
}

export function fillMessage(content: string, v: MessageVars): string {
  return content
    .replaceAll('{이름}', v.name ?? '')
    .replaceAll('{공고명}', v.postingTitle ?? '')
    .replaceAll('{직무}', v.positionName ?? '')
    .replace(/[ \t]{2,}/g, ' ') // 빈 변수가 남긴 겹친 공백 정리
}

/** 숫자만 남기고 9~11자리가 아니면 null (sms: 링크에 쓸 수 없는 번호). */
export function normalizeSmsPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  return digits.length >= 9 && digits.length <= 11 ? digits : null
}

export const SAMPLE_MESSAGES = [
  {
    title: '서류 합격·면접 안내',
    content:
      '안녕하세요, {이름}님. {공고명} {직무} 지원서를 검토한 결과 서류 전형에 합격하셨습니다. 면접 일정과 장소는 별도로 안내드리겠습니다. 확인 후 회신 부탁드립니다. 감사합니다.',
  },
  {
    title: '최종 합격',
    content:
      '안녕하세요, {이름}님. {공고명} {직무} 최종 합격을 진심으로 축하드립니다. 입사 일정과 준비 서류는 추가로 안내드리겠습니다. 함께하게 되어 기쁩니다. 감사합니다.',
  },
  {
    title: '불합격 안내',
    content:
      '안녕하세요, {이름}님. {공고명} {직무}에 지원해 주셔서 감사합니다. 안타깝게도 이번에는 함께하지 못하게 되었음을 알려드립니다. 소중한 시간을 내어 주셔서 감사드리며, 앞날에 좋은 일이 가득하시길 바랍니다.',
  },
]

// ─── 편집기용 평문 ↔ TipTap JSON ───
export const MESSAGE_VARIABLES = ['이름', '공고명', '직무'] as const
export type MessageVariableKey = (typeof MESSAGE_VARIABLES)[number]

export type MessageDocNode = {
  type: string
  attrs?: { key?: string }
  text?: string
  content?: MessageDocNode[]
}

const TOKEN_SPLIT = new RegExp(`(\\{(?:${MESSAGE_VARIABLES.join('|')})\\})`)

/** 평문 → 문서. '\n'마다 문단 1개(빈 줄=빈 문단), {이름} 등은 messageVariable 노드. */
export function textToDoc(text: string): MessageDocNode {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => {
      const content = line
        .split(TOKEN_SPLIT)
        .filter(Boolean)
        .map((part): MessageDocNode => {
          const m = /^\{(.+)\}$/.exec(part)
          return m && (MESSAGE_VARIABLES as readonly string[]).includes(m[1])
            ? { type: 'messageVariable', attrs: { key: m[1] } }
            : { type: 'text', text: part }
        })
      return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
    }),
  }
}

/** 문서 → 평문. 문단 사이와 hardBreak는 '\n'. */
export function docToText(doc: MessageDocNode): string {
  const inline = (n: MessageDocNode): string =>
    n.type === 'text'
      ? (n.text ?? '')
      : n.type === 'messageVariable'
        ? `{${n.attrs?.key ?? ''}}`
        : n.type === 'hardBreak'
          ? '\n'
          : (n.content ?? []).map(inline).join('')
  return (doc.content ?? []).map(inline).join('\n')
}
