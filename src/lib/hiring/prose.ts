// 공고 본문(Tiptap) 렌더 공통 타이포 클래스.
// 에디터·미리보기·공개 페이지·상세 미리보기에서 동일하게 재사용해 표시를 일치시킨다.
// 문단 정렬(text-align)은 Tiptap 이 inline style 로 출력하므로 CSS 불필요.
export const HIRING_PROSE_CLASS =
  '[&_a]:text-primary [&_a]:underline ' +
  '[&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold ' +
  '[&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold ' +
  '[&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold ' +
  '[&_p]:mb-2 [&_p]:text-sm ' +
  '[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-sm ' +
  '[&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:text-sm ' +
  '[&_hr]:my-4 [&_hr]:border-t ' +
  '[&_mark]:rounded-sm [&_mark]:bg-yellow-200 [&_mark]:px-0.5 [&_mark]:text-inherit dark:[&_mark]:bg-yellow-500/40 ' +
  '[&_u]:underline'
