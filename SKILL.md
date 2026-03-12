---
name: recruitment-url-sheet
description: 채용공고 URL(직행, 원티드, 기타 JobPosting 구조화 데이터 지원)를 자동 분석해 Google Spreadsheet 시트1에 누적 저장한다. 사용 시점: 사용자가 공고 링크를 주며 시트에 정리/추가/중복제거를 요청할 때, 특히 IT 공고만 필터링해 저장할 때.
metadata: {"openclaw":{"emoji":"🧲","homepage":"https://github.com/googleworkspace/cli","requires":{"bins":["gws"]},"install":[{"id":"node","kind":"node","package":"@googleworkspace/cli","bins":["gws"],"label":"Install Google Workspace CLI (npm)"}]}}
---

# Recruitment URL Sheet

여러 채용 사이트 URL을 하나의 스킬로 처리해 Google Spreadsheet `시트1`에 누적 저장한다.

## Core behavior

- URL 도메인 자동 감지
  - `zighang.com`
  - `wanted.co.kr`
  - 기타: `JobPosting` JSON-LD 기반 일반 파서
- 중복 URL 자동 스킵 (`공고 바로가기` 컬럼 기준)
- 항상 `시트1`에 이어서 작성 (새 시트 생성 없음)
- 컬럼 고정: A~H
  1. 회사명
  2. 직무
  3. 업종
  4. 채용형태
  5. 마감일까지 남은 날짜 (수식)
  6. 마감일(원본)
  7. 공고 바로가기 (HYPERLINK)
  8. 지원 여부 (체크박스, 기본 FALSE)

## First-time setup (for new users)

```bash
npm install -g @googleworkspace/cli
gws auth login -s sheets,drive
gws auth status
```

- `token_valid: true`가 보이면 준비 완료
- 이후에는 URL만 넣어 실행하면 `시트1`에 누적 저장됨

## Command

### 1) 추출만 확인 (시트 미기록)

```bash
node {baseDir}/scripts/recruitment_url_to_sheet.mjs \
  --url "https://zighang.com/recruitment/..." \
  --url "https://www.wanted.co.kr/wd/..." \
  --it-only
```

### 2) 시트1에 추가

```bash
node {baseDir}/scripts/recruitment_url_to_sheet.mjs \
  --url "https://zighang.com/recruitment/..." \
  --url "https://www.wanted.co.kr/wd/..." \
  --sheet-id "<google_sheet_id>" \
  --tab "시트1" \
  --it-only
```

### 3) URL 파일 일괄 처리

```bash
node {baseDir}/scripts/recruitment_url_to_sheet.mjs \
  --urls-file ./urls.txt \
  --sheet-id "<google_sheet_id>" \
  --tab "시트1" \
  --it-only
```

## Options

- `--url <url>`: 반복 가능
- `--urls "url1,url2,..."`: CSV 입력
- `--urls-file <path>`: 파일 입력(줄바꿈)
- `--sheet-id <id>`: 지정 시 시트 기록
- `--tab <name>`: 기본 `시트1`
- `--it-only`: IT 공고만 기록
- `--dry-run`: 시트 기록 없이 추가 예정 결과만 출력

## Requirements

- `gws` CLI 설치
- `gws auth login -s sheets,drive` 인증 완료

## Notes

- `시트1`의 연속 데이터 블록(링크 컬럼 G 기준) 다음 행에만 추가해, 멀리 떨어진 꼬리 행으로 붙는 문제를 방지한다.
- 사이트가 마감일을 제공하지 않으면 D-day 수식 결과는 빈값으로 유지된다.
- 체크박스는 추가된 행 범위에만 데이터 검증(BOOLEAN)을 적용한다.
