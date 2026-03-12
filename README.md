# recruitment-url-sheet

URL만 넣으면 채용공고를 파싱해 Google Sheets `시트1`에 누적하는 OpenClaw skill입니다.

지원:
- zighang.com
- wanted.co.kr
- 기타 JobPosting(JSON-LD) 사이트

핵심 기능:
- IT 공고 필터(`--it-only`)
- 중복 URL 자동 스킵
- `시트1` 연속 데이터 구간 다음 행에만 추가
- D-day 수식 / 바로가기 링크 / 지원 체크박스 자동화

## 빠른 시작

```bash
npm install -g @googleworkspace/cli
gws auth login -s sheets,drive
node recruitment-url-sheet/scripts/recruitment_url_to_sheet.mjs \
  --url "https://www.wanted.co.kr/wd/294072" \
  --sheet-id "<google_sheet_id>" \
  --tab "시트1" \
  --it-only
```

## OpenClaw에서 설치

- 로컬 스킬 폴더에 복사하거나
- `dist/recruitment-url-sheet.skill` 파일을 사용해 배포
