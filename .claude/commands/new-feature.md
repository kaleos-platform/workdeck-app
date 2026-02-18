# .claude/commands/dev/new-feature.md

---

description: "새로운 기능을 위한 페이지, 컴포넌트, API 라우트를 생성합니다"
allowed-tools: ["Read", "Write", "Glob"]

---

# 새 기능 스캐폴딩

$ARGUMENTS 기능을 위한 파일들을 생성합니다.

## 프로세스

1. 기존 코드 패턴 분석 (app/, components/ 구조)
2. 필요한 파일 목록 제안:
   - 페이지 (app/[route]/page.tsx)
   - 컴포넌트 (components/[name].tsx)
   - API 라우트 (필요시)
3. 기존 UI 컴포넌트(Radix UI, Tailwind) 스타일 따르기
4. TypeScript 타입 정의 포함
