# Emily LLM 레이어 설계안

> 상태: 설계만 (구현 보류)
> 작성: 2026-04-12

## 목표

Emily agent에 자연어 이해 레이어를 추가하여, 정규식에 매칭되지 않는 자연어 질의도 처리할 수 있게 한다.

## 모델

- **gemini-2.5-flash** (의식주의 Gemini API 계정)
- Agent `.env`에 `GEMINI_API_KEY` 추가 (worker와 동일 키)

## 아키텍처

```
사용자 메시지
  │
  ├─ regex 매칭 시도 (기존 slack-handler.ts)
  │   ├─ 매칭됨 → 기존 핸들러 실행 (API 호출)
  │   └─ 매칭 안됨 ↓
  │
  ├─ Gemini flash intent 분류
  │   ├─ 분류됨 → 기존 핸들러에 위임
  │   └─ 분류 실패 → "도움말을 확인해주세요" 안내
  │
  └─ (향후) 자유 질의 응답 (분석 데이터 기반 대화)
```

## Intent 분류 설계

### 지원 Intent 목록

| Intent | 매핑 핸들러 | 예시 질의 |
|--------|-----------|----------|
| `kpi_status` | 상태/KPI | "지금 광고 성과 어때?", "ROAS 몇이야?" |
| `campaign_list` | 캠페인 목록 | "캠페인 보여줘", "뭐 돌리고 있어?" |
| `campaign_detail` | 캠페인 검색 | "마스크 캠페인 상세", "이 캠페인 클릭률은?" |
| `inefficient` | 비효율 키워드 | "돈 새는 키워드 있어?", "낭비되는 거 찾아줘" |
| `trigger_analysis` | 분석 실행 | "분석 돌려줘", "최근 성과 분석해" |
| `view_reports` | 리포트 조회 | "지난 분석 결과 보여줘" |
| `unknown` | 도움말 안내 | 분류 불가 시 |

### Gemini 호출 형식

```typescript
// system prompt
`당신은 쿠팡 광고 관리 에이전트 에밀리의 intent 분류기입니다.
사용자 메시지를 다음 intent 중 하나로 분류하세요:
kpi_status, campaign_list, campaign_detail, inefficient, trigger_analysis, view_reports, unknown

JSON으로만 응답: {"intent": "...", "params": {"keyword": "..."}}
params는 campaign_detail일 때만 keyword를 포함합니다.`
```

### 비용 추정

- Intent 분류: ~200 input tokens + ~50 output tokens per call
- gemini-2.5-flash: ~$0.15/1M input, ~$0.60/1M output
- 일 100회 호출 가정: ~$0.003/일 (무시 가능)

## 수정 파일 (구현 시)

1. `agent/.env` — `GEMINI_API_KEY` 추가
2. `agent/src/llm-classifier.ts` — 새 파일, intent 분류 로직
3. `agent/src/slack-handler.ts` — regex 미매칭 시 LLM fallback 분기 추가

## 고려사항

- regex 매칭은 항상 우선 (LLM 호출 없이 즉시 응답 → 비용 0)
- LLM은 regex 미매칭 시에만 호출 (fallback)
- 응답 지연: flash 모델이므로 ~1초 이내
- 에러 시: LLM 호출 실패하면 기존 도움말 안내로 graceful degradation
