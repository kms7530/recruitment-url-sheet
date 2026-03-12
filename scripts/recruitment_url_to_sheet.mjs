#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = { url: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];

    if (key === 'url') {
      if (next && !next.startsWith('--')) {
        args.url.push(next);
        i++;
      }
      continue;
    }

    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function cleanText(s = '') {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeJsonString(s) {
  try {
    return JSON.parse(`"${String(s).replace(/"/g, '\\"')}"`);
  } catch {
    return String(s);
  }
}

function extractMatch(text, regex) {
  const m = String(text).match(regex);
  if (!m) return null;
  return decodeJsonString(m[1]);
}

function formatDateOnly(dateIsoLike) {
  if (!dateIsoLike) return '';
  const m = String(dateIsoLike).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function buildDdayFormula(rowNum) {
  return `=IF(F${rowNum}="", "", IF(F${rowNum}<TODAY(), "마감", IF(F${rowNum}=TODAY(), "D-DAY", "D-"&(F${rowNum}-TODAY()))))`;
}

function isITLike(text = '') {
  return /(IT|개발|엔지니어|software|developer|data|ml|ai|보안|정보보호|프론트|백엔드|클라우드|infra|SRE)/i.test(
    text
  );
}

function normalizeRoleText(s = '') {
  return cleanText(s)
    .replace(/_/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalRole(s = '') {
  return String(s).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

function uniqFiltered(parts = []) {
  // 1) canonical 기준 중복 제거(더 긴 표기를 우선)
  const bestByCanonical = new Map();
  for (const p of parts.filter(Boolean)) {
    const cp = canonicalRole(p);
    const prev = bestByCanonical.get(cp);
    if (!prev || String(p).length > String(prev).length) bestByCanonical.set(cp, p);
  }
  const uniq = [...bestByCanonical.values()];

  // 2) 포괄 관계 중복 제거 (예: "엔지니어" vs "머신러닝 엔지니어")
  return uniq.filter((p, i, arr) => {
    const cp = canonicalRole(p);
    return !arr.some((q, j) => {
      if (i === j) return false;
      const cq = canonicalRole(q);
      return cq.includes(cp) && cq.length > cp.length;
    });
  });
}

function pickITRoleParts(strings = []) {
  const out = [];
  for (const s of strings) {
    const norm = normalizeRoleText(s);
    if (!norm) continue;
    const split = norm.split(',').map((x) => x.trim()).filter(Boolean);
    for (const p of split) {
      if (isITLike(p)) out.push(p.replace(/\s*추진$/i, '').trim());
    }
  }
  return uniqFiltered(out);
}

function extractArrayAll(text, arrayKey) {
  const re = new RegExp(`\\"${arrayKey}\\":\\[(.*?)\\]`);
  const m = String(text).match(re);
  if (!m) return [];
  const raw = m[1];
  const out = [];
  const strRe = /\"([^\"]+)\"/g;
  let s;
  while ((s = strRe.exec(raw)) !== null) out.push(decodeJsonString(s[1]));
  return out;
}

function extractKeywords(text) {
  return extractArrayAll(text, 'keywords');
}

function pickIndustry(keywords = [], fallback = '') {
  if (keywords.length === 0) return fallback || '';
  const score = (k) => {
    const pat = /(보험|금융|은행|증권|카드|캐피탈|제조|반도체|바이오|제약|건설|유통|이커머스|플랫폼|게임|IT|테크|미디어|교육|물류|모빌리티|에너지|화학|전자|소프트웨어)/i;
    return pat.test(k) ? 1 : 0;
  };
  const sorted = [...keywords].sort((a, b) => score(b) - score(a));
  return sorted[0] || fallback || '';
}

function findJobPosting(obj) {
  if (!obj || typeof obj !== 'object') return null;

  const t = obj['@type'];
  if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) {
    return obj;
  }

  if (Array.isArray(obj)) {
    for (const x of obj) {
      const hit = findJobPosting(x);
      if (hit) return hit;
    }
    return null;
  }

  for (const v of Object.values(obj)) {
    const hit = findJobPosting(v);
    if (hit) return hit;
  }
  return null;
}

function extractLdJsonJobPosting(html) {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      const hit = findJobPosting(obj);
      if (hit) return hit;
    } catch {
      // ignore malformed blobs
    }
  }
  return null;
}

async function extractFromZighang(url, html, { itOnly }) {
  const text = html.replace(/\\\"/g, '"');

  const companyName = extractMatch(text, /"company":\{[^}]*?"name":"([^"]+)"/) || '';
  const title = extractMatch(text, /"title":"([^"]+)","summary":/) || '';
  const employeeTypes = extractArrayAll(text, 'employeeTypes');
  const endDateRaw = extractMatch(text, /"endDate":"([^"]+)"/) || '';
  const depthOnes = extractArrayAll(text, 'depthOnes');
  const depthTwos = extractArrayAll(text, 'depthTwos');
  const keywords = extractKeywords(text);
  const industry = pickIndustry(keywords);

  const itDutyMatch = text.match(/IT\s*직군[\s\S]{0,260}?주요업무:\s*(IT[^\n\"<]{1,260})/i);
  const itDuty = itDutyMatch ? cleanText(itDutyMatch[1]).split(/우대사항|인턴십|전형안내|유의사항/i)[0].trim() : '';

  const roleParts = pickITRoleParts([...depthTwos, itDuty, ...depthOnes, title]);
  const itDetailedRole = roleParts.join(' / ');
  const isITPost = roleParts.length > 0 || isITLike(`${title} ${depthOnes.join(' ')} ${depthTwos.join(' ')}`);

  const defaultRole = depthOnes[0] || title;
  const jobRole = itOnly ? (itDetailedRole || (isITPost ? defaultRole : '')) : defaultRole;

  return {
    source: 'zighang',
    url,
    companyName,
    jobRole,
    industry,
    employeeType: employeeTypes[0] || '',
    endDate: endDateRaw,
    endDateDateOnly: formatDateOnly(endDateRaw),
    isITPost,
  };
}

async function extractFromWanted(url, html, { itOnly }) {
  const job = extractLdJsonJobPosting(html) || {};
  const text = html.replace(/\\\"/g, '"');

  let dueTime = extractMatch(text, /"due_time":(?:"([^"]+)"|null|undefined)/);
  if (dueTime === 'undefined' || dueTime === 'null') dueTime = '';

  const title = cleanText(job.title || '');
  const companyName = cleanText(job?.hiringOrganization?.name || '');
  const occupationalCategory = cleanText(job.occupationalCategory || '');
  const employeeType = cleanText(job.employmentType || '');
  const industry = cleanText(job.industry || '');
  const endDateRaw = dueTime || cleanText(job.validThrough || '');

  const titleRole = title.replace(/^\[[^\]]+\]\s*/, '');
  const roleParts = pickITRoleParts([occupationalCategory, titleRole]);
  const itDetailedRole = roleParts.join(' / ');
  const isITPost = roleParts.length > 0 || isITLike(`${title} ${occupationalCategory}`);

  const defaultRole = occupationalCategory || titleRole || title;
  const jobRole = itOnly ? (itDetailedRole || (isITPost ? defaultRole : '')) : defaultRole;

  return {
    source: 'wanted',
    url,
    companyName,
    jobRole,
    industry,
    employeeType,
    endDate: endDateRaw,
    endDateDateOnly: formatDateOnly(endDateRaw),
    isITPost,
  };
}

async function extractFromGeneric(url, html, { itOnly }) {
  const job = extractLdJsonJobPosting(html) || {};

  const title = cleanText(job.title || '');
  const companyName = cleanText(job?.hiringOrganization?.name || job?.hiringOrganization || '');
  const occupationalCategory = cleanText(job.occupationalCategory || '');
  const employeeType = cleanText(job.employmentType || '');
  const industry = cleanText(job.industry || '');
  const endDateRaw = cleanText(job.validThrough || '');

  const roleParts = pickITRoleParts([occupationalCategory, title]);
  const itDetailedRole = roleParts.join(' / ');
  const isITPost = roleParts.length > 0 || isITLike(`${title} ${occupationalCategory}`);

  const defaultRole = occupationalCategory || title;
  const jobRole = itOnly ? (itDetailedRole || (isITPost ? defaultRole : '')) : defaultRole;

  return {
    source: 'generic',
    url,
    companyName,
    jobRole,
    industry,
    employeeType,
    endDate: endDateRaw,
    endDateDateOnly: formatDateOnly(endDateRaw),
    isITPost,
  };
}

async function extractRecruitment(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`페이지 요청 실패: ${res.status}`);
  const html = await res.text();

  const host = new URL(url).hostname.toLowerCase();
  if (host.includes('zighang.com')) return extractFromZighang(url, html, options);
  if (host.includes('wanted.co.kr')) return extractFromWanted(url, html, options);
  return extractFromGeneric(url, html, options);
}

function runGws(args) {
  const out = execFileSync('gws', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out;
}

function ensureGwsReady() {
  const raw = runGws(['auth', 'status']);
  const data = JSON.parse(raw);
  if (!data.token_valid) {
    throw new Error('gws 인증이 유효하지 않습니다. 먼저 `gws auth login -s sheets,drive`를 실행하세요.');
  }
}

function extractUrlFromCell(cell = '') {
  const m = String(cell).match(/HYPERLINK\("([^"]+)"/i);
  if (m) return m[1];
  if (/^https?:\/\//i.test(String(cell))) return String(cell);
  return null;
}

function ensureHeader(spreadsheetId, tabName = '시트1') {
  runGws([
    'sheets',
    'spreadsheets',
    'values',
    'update',
    '--params',
    JSON.stringify({
      spreadsheetId,
      range: `${tabName}!A1:H1`,
      valueInputOption: 'USER_ENTERED',
    }),
    '--json',
    JSON.stringify({
      values: [
        [
          '회사명',
          '직무',
          '업종',
          '채용형태',
          '마감일까지 남은 날짜',
          '마감일(원본)',
          '공고 바로가기',
          '지원 여부',
        ],
      ],
    }),
  ]);
}

function getTabSheetNumericId(spreadsheetId, tabName = '시트1') {
  const raw = runGws([
    'sheets',
    'spreadsheets',
    'get',
    '--params',
    JSON.stringify({ spreadsheetId, fields: 'sheets.properties' }),
  ]);
  const data = JSON.parse(raw);
  const sheets = data.sheets || [];
  const exact = sheets.find((s) => s?.properties?.title === tabName);
  if (exact?.properties?.sheetId !== undefined) return exact.properties.sheetId;
  throw new Error(`탭을 찾지 못했습니다: ${tabName}`);
}

function getExistingUrls(spreadsheetId, tabName = '시트1') {
  const raw = runGws([
    'sheets',
    'spreadsheets',
    'values',
    'get',
    '--params',
    JSON.stringify({
      spreadsheetId,
      range: `${tabName}!G2:G`,
      valueRenderOption: 'FORMULA',
    }),
  ]);
  const data = JSON.parse(raw);
  return new Set((data.values || []).map((r) => extractUrlFromCell(r?.[0])).filter(Boolean));
}

function getNextRow(spreadsheetId, tabName = '시트1') {
  const raw = runGws([
    'sheets',
    'spreadsheets',
    'values',
    'get',
    '--params',
    JSON.stringify({
      spreadsheetId,
      range: `${tabName}!G:G`,
      valueRenderOption: 'FORMULA',
    }),
  ]);
  const data = JSON.parse(raw);
  const values = data.values || [];

  let maxRow = 1;
  // 헤더(1행) 다음부터 연속된 URL 블록까지 유효 데이터로 간주
  for (let i = 1; i < values.length; i++) {
    const rowNum = i + 1;
    const hasUrl = Boolean(extractUrlFromCell(values[i]?.[0] || ''));
    if (rowNum === maxRow + 1 && hasUrl) {
      maxRow = rowNum;
      continue;
    }
    if (!hasUrl || rowNum > maxRow + 1) break;
  }
  return maxRow + 1;
}

function ensureCheckboxValidation(spreadsheetId, tabName, startRow, endRow) {
  if (endRow < startRow) return;
  const sheetId = getTabSheetNumericId(spreadsheetId, tabName);
  runGws([
    'sheets',
    'spreadsheets',
    'batchUpdate',
    '--params',
    JSON.stringify({ spreadsheetId }),
    '--json',
    JSON.stringify({
      requests: [
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: startRow - 1,
              endRowIndex: endRow,
              startColumnIndex: 7,
              endColumnIndex: 8,
            },
            cell: {
              dataValidation: {
                condition: { type: 'BOOLEAN' },
                strict: true,
                showCustomUi: true,
              },
            },
            fields: 'dataValidation',
          },
        },
      ],
    }),
  ]);
}

function appendRows(spreadsheetId, tabName, rows) {
  if (rows.length === 0) return;
  runGws([
    'sheets',
    'spreadsheets',
    'values',
    'append',
    '--params',
    JSON.stringify({
      spreadsheetId,
      range: `${tabName}!A:H`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
    }),
    '--json',
    JSON.stringify({ values: rows }),
  ]);
}

function collectUrls(args) {
  const fromRepeated = args.url || [];
  const fromCsv = args.urls
    ? String(args.urls)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
  const fromFile = args['urls-file']
    ? readFileSync(args['urls-file'], 'utf8')
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean)
    : [];

  const all = [...fromRepeated, ...fromCsv, ...fromFile].filter((u) => /^https?:\/\//i.test(u));
  return [...new Set(all)];
}

async function main() {
  const args = parseArgs(process.argv);

  const urls = collectUrls(args);
  if (urls.length === 0) {
    console.error(
      '사용법:\n' +
        '  node recruitment_url_to_sheet.mjs --url <공고URL> [--url <공고URL> ...] [--it-only]\n' +
        '  node recruitment_url_to_sheet.mjs --urls "url1,url2,..." [--it-only]\n' +
        '  node recruitment_url_to_sheet.mjs --urls-file ./urls.txt [--it-only]\n' +
        '  + 시트 저장 시: --sheet-id <ID> [--tab 시트1]'
    );
    process.exit(1);
  }

  const itOnly = Boolean(args['it-only']);
  const extracted = [];
  const failed = [];

  for (const url of urls) {
    try {
      const row = await extractRecruitment(url, { itOnly });
      extracted.push(row);
    } catch (e) {
      failed.push({ url, error: e?.message || String(e) });
    }
  }

  const sheetId = args['sheet-id'] || null;
  const tab = args.tab || '시트1';
  const dryRun = Boolean(args['dry-run']);

  const summary = {
    totalInput: urls.length,
    extracted: extracted.length,
    failed: failed.length,
    failedItems: failed,
  };

  if (!sheetId) {
    console.log(JSON.stringify({ mode: 'extract-only', options: { itOnly }, summary, rows: extracted }, null, 2));
    return;
  }

  ensureGwsReady();
  ensureHeader(sheetId, tab);

  const existing = getExistingUrls(sheetId, tab);
  const nextRow = getNextRow(sheetId, tab);

  const rowsToAppend = [];
  const skippedDuplicates = [];
  const skippedNonIT = [];

  for (const row of extracted) {
    if (existing.has(row.url)) {
      skippedDuplicates.push(row.url);
      continue;
    }
    if (itOnly && !row.isITPost) {
      skippedNonIT.push(row.url);
      continue;
    }

    const rowNum = nextRow + rowsToAppend.length;
    rowsToAppend.push([
      row.companyName || '',
      row.jobRole || '',
      row.industry || '',
      row.employeeType || '',
      buildDdayFormula(rowNum),
      row.endDateDateOnly || '',
      `=HYPERLINK("${row.url}","바로가기")`,
      false,
    ]);
    existing.add(row.url);
  }

  if (!dryRun && rowsToAppend.length > 0) {
    appendRows(sheetId, tab, rowsToAppend);
    ensureCheckboxValidation(sheetId, tab, nextRow, nextRow + rowsToAppend.length - 1);
  }

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? 'dry-run' : 'append',
        options: { itOnly, sheetId, tab },
        summary: {
          ...summary,
          added: rowsToAppend.length,
          skippedDuplicates: skippedDuplicates.length,
          skippedNonIT: skippedNonIT.length,
        },
        skippedDuplicateUrls: skippedDuplicates,
        skippedNonITUrls: skippedNonIT,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
