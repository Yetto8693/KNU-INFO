# KNU INFO (Vercel version)

이 버전은 Google Apps Script가 아니라 Vercel Node.js Functions를 사용합니다.

## GitHub에 반영할 파일
기존 저장소의 `Code.gs`와 `appsscript.json`은 이 Vercel 버전에서 사용하지 않습니다.
아래 파일을 저장소 루트에 업로드하고 기존 `index.html`을 교체하세요.

- `index.html`
- `api/notices.js`
- `api/summarize.js`
- `lib/scraper.js`
- `package.json`

## Gemini AI 요약 설정
1. Vercel 프로젝트 → Settings → Environment Variables
2. Key: `GEMINI_API_KEY`
3. Value: 본인의 Gemini API 키
4. Production (필요하면 Preview도) 선택 후 Save
5. Redeploy

API 키를 HTML이나 GitHub 코드에 직접 적지 마세요.

## 확인
- `https://프로젝트주소/api/notices` : 공지 JSON 확인
- `https://프로젝트주소/` : 화면 확인

## 참고
공지사항 수집은 강원대학교 학사공지(게시판 718), 장학공지(게시판 721)의 공개 목록 페이지를 읽습니다.
학교 홈페이지의 HTML 구조나 접근 정책이 바뀌면 파서 수정이 필요할 수 있습니다.
Vercel 서버리스 인스턴스의 메모리 캐시는 영구 저장소가 아니므로, 장기 보관이 필요하면 별도 DB를 연결해야 합니다.
