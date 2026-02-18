# .claude/commands/dev/review.md

---

description: "변경된 코드를 리뷰하고 개선점을 제안합니다"
allowed-tools: ["Bash(git diff:*)", "Bash(git status:*)", "Read", "Grep"]

---

# 코드 리뷰

현재 변경사항을 리뷰합니다.

## 체크리스트

1. **타입 안전성**: TypeScript 타입 누락 확인
2. **보안**: 인증/권한 체크, 입력 검증 (Zod)
3. **성능**: 불필요한 리렌더링, N+1 쿼리
4. **접근성**: Radix UI 컴포넌트 올바른 사용
5. **일관성**: 기존 코드 패턴과 일치하는지

## 출력 형식

- ✅ 잘된 점
- ⚠️ 개선 제안
- 🚨 반드시 수정 필요
