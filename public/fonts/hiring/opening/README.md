# 이관 디자인용 원본 폰트

opening 웹 편집기의 @peakpay/excalidraw 배포본에 포함된 원본 파일 15개를 수정 없이 보관한다. 디자이너의 원래 글꼴·글자 폭·굵기를 복원하기 위한 웹폰트이며 OS 설치나 CDN에 의존하지 않는다.

- Pretendard: https://github.com/orioncactus/pretendard (SIL OFL 1.1)
- MaruBuri: https://hangeul.naver.com/font (네이버 글꼴 오픈 라이선스)
- GangwonPower / GangwonEduHyeonok: https://www.gwe.go.kr/main/content.do?key=bTIzMDcyMTEyMDc3MTU%3D (강원교육서체 이용 조건)
- Vidaloka: https://github.com/google/fonts/tree/main/ofl/vidaloka (SIL OFL 1.1)
- Montserrat: https://github.com/JulietaUla/Montserrat (SIL OFL 1.1)

저작권·라이선스는 함께 둔 LICENSE/OFL 파일과 각 폰트의 name 테이블에 보존했다. 파일별 원본 SHA-256와 내장 저작권은 manifest.json에 기록한다. TTF/OTF를 그대로 유지해 압축이나 글리프 변경에 따른 폭 변화를 피한다.

src/lib/hiring/opening-font-metrics.json은 원본 파일의 head.unitsPerEm, hhea.ascent, hhea.descent에서 추출한 값이다. 원본 편집기의 기본 lineHeight=1.4를 사용한다. 로더는 실제 scene에서 쓰는 폰트만 로드한다.
