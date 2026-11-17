import { existsSync } from 'node:fs'
import path from 'node:path'
import { recruitingLanding } from '../decks/recruiting'

describe('recruiting 랜딩 데이터', () => {
  it('제거된 메시지 템플릿 기능을 언급하지 않는다', () => {
    const text = JSON.stringify(recruitingLanding)
    expect(text).not.toMatch(/메시지 템플릿|템플릿으로 안내|안내 문구는 템플릿/)
  })

  // 결과 안내 링크는 핵심 기능이 아니라 랜딩에서 내세우지 않는다(2026-11-16 결정).
  // 오프닝 이전 고객용 대응표 행만 예외로 남긴다.
  it('결과 안내를 기능·히어로·흐름·FAQ로 내세우지 않는다', () => {
    const { migration, ...rest } = recruitingLanding
    expect(migration).toBeDefined()
    expect(JSON.stringify(rest)).not.toMatch(/결과 안내|결과 확인 링크/)
  })

  it('기능 행마다 실제 화면 이미지가 있고 파일이 존재한다', () => {
    for (const feature of recruitingLanding.features) {
      expect(feature.image).toBeDefined()
      const file = path.join(process.cwd(), 'public', feature.image!.src)
      expect(existsSync(file)).toBe(true)
    }
  })

  // 일러스트에 외부 서비스 로고가 들어간 행은 상표 소유 고지를 함께 둔다(제휴 오해 방지)
  it('외부 로고가 든 이미지에 상표 고지를 붙인다', () => {
    const caption = (title: string) =>
      recruitingLanding.features.find((f) => f.title === title)?.image?.caption ?? ''
    expect(caption('공고 링크 & 간편 지원서')).toMatch(/알바몬.*사람인.*알바천국.*잡코리아.*상표/)
    expect(caption('AI 연동')).toMatch(/Anthropic.*OpenAI.*Google.*상표/)
  })

  it('요금 페이지가 쓰는 대표 스크린샷을 유지한다', () => {
    const shot = recruitingLanding.screenshots?.[0]
    expect(shot).toBeDefined()
    expect(existsSync(path.join(process.cwd(), 'public', shot!.src))).toBe(true)
  })
})
