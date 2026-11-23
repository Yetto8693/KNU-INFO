const CONFIG = {
  SHEET_NAME: 'Notices',
  BOARDS: [
    { category: '학사공지', boardId: '718', url: 'https://www.kangwon.ac.kr/ko/bbs/718/list.do' },
    { category: '장학공지', boardId: '721', url: 'https://www.kangwon.ac.kr/ko/bbs/721/list.do' }
  ],
  PAGE_COUNT: 3,
  PAGE_SIZE: 20,
  GEMINI_MODEL: 'gemini-2.5-flash'
};

const HEADERS = ['id', 'category', 'title', 'date', 'campus', 'author', 'url', 'summary', 'fetchedAt'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('KNU INFO | 강원대학교 공지 통합')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function setupKnuInfo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('먼저 Google Sheets에서 확장 프로그램 > Apps Script를 열어 프로젝트를 만들어 주세요.');
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  sheet.clear();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, HEADERS.length);
  return '시트 준비 완료';
}

function getNotices(options) {
  options = options || {};
  const sheet = getOrCreateSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return { notices: [], updatedAt: '', message: '아직 수집된 공지가 없습니다. 새로고침을 눌러 공지를 수집해 주세요.' };
  }
  const rows = values.slice(1).filter(r => r[0]).map(r => ({
    id: String(r[0]), category: String(r[1] || ''), title: String(r[2] || ''),
    date: String(r[3] || ''), campus: String(r[4] || ''), author: String(r[5] || ''),
    url: String(r[6] || ''), summary: String(r[7] || '')
  }));
  const category = options.category || '전체';
  const query = String(options.query || '').trim().toLowerCase();
  const filtered = rows.filter(n =>
    (category === '전체' || n.category === category) &&
    (!query || [n.title, n.campus, n.author, n.category].join(' ').toLowerCase().includes(query))
  );
  filtered.sort((a, b) => dateKey_(b.date) - dateKey_(a.date));
  const updatedAt = PropertiesService.getScriptProperties().getProperty('LAST_FETCHED_AT') || '';
  return { notices: filtered.slice(0, 100), updatedAt, message: '' };
}

function refreshNotices() {
  const sheet = getOrCreateSheet_();
  const all = [];
  CONFIG.BOARDS.forEach(board => {
    for (let page = 1; page <= CONFIG.PAGE_COUNT; page++) {
      const url = board.url + '?pageIndex=' + page + '&pageItm=' + CONFIG.PAGE_SIZE + '&searchGbn=0&searchOrderSort=0';
      const html = fetchHtml_(url);
      all.push.apply(all, parseNoticeList_(html, board));
    }
  });

  const unique = {};
  all.forEach(n => { if (n.id && !unique[n.id]) unique[n.id] = n; });
  const notices = Object.keys(unique).map(k => unique[k]);
  notices.sort((a, b) => dateKey_(b.date) - dateKey_(a.date));

  sheet.clearContents();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  if (notices.length) {
    const rows = notices.map(n => [n.id, n.category, n.title, n.date, n.campus, n.author, n.url, '', new Date()]);
    sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
  PropertiesService.getScriptProperties().setProperty('LAST_FETCHED_AT', Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'));
  return { count: notices.length, updatedAt: PropertiesService.getScriptProperties().getProperty('LAST_FETCHED_AT') };
}

function summarizeNotice(noticeId) {
  const sheet = getOrCreateSheet_();
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1, row;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(noticeId)) { rowIndex = i + 1; row = data[i]; break; }
  }
  if (!row) throw new Error('공지 데이터를 찾을 수 없습니다. 목록을 새로고침해 주세요.');

  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('Gemini API 키가 설정되지 않았습니다. Apps Script 설정 방법은 README를 확인해 주세요.');
  if (row[7]) return String(row[7]);

  const detailHtml = fetchHtml_(String(row[6]));
  const plainText = htmlToText_(detailHtml).slice(0, 12000);
  const prompt = [
    '너는 대학 공지사항을 학생이 빠르게 이해하도록 정리하는 도우미다.',
    '아래 공지 원문에 있는 사실만 사용하고, 모르는 내용이나 신청 마감일을 추측하지 마라.',
    '한국어로 다음 형식에 맞춰 간결하게 요약해라:',
    '1. 핵심 내용 (2~3문장)',
    '2. 대상',
    '3. 주요 일정 및 신청 방법 (원문에 있을 때만)',
    '4. 학생이 확인할 점',
    '원문이 불충분하면 "원문에서 확인 필요"라고 밝혀라.',
    '',
    '제목: ' + row[2],
    '분류: ' + row[1],
    '원문 텍스트:',
    plainText
  ].join('\n');

  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    CONFIG.GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);
  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const body = JSON.parse(response.getContentText());
  if (status < 200 || status >= 300) {
    const message = body && body.error && body.error.message ? body.error.message : 'Gemini API 요청에 실패했습니다.';
    throw new Error(message);
  }
  const summary = (((body.candidates || [])[0] || {}).content || {}).parts;
  const result = summary && summary.length ? summary.map(p => p.text || '').join('\n').trim() : '';
  if (!result) throw new Error('Gemini가 요약 결과를 반환하지 않았습니다.');
  sheet.getRange(rowIndex, 8).setValue(result);
  return result;
}

function saveGeminiApiKey(apiKey) {
  if (!apiKey || String(apiKey).trim().length < 10) throw new Error('올바른 API 키를 입력해 주세요.');
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', String(apiKey).trim());
  return 'Gemini API 키가 스크립트 속성에 저장되었습니다.';
}

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('연결된 Google Sheets가 없습니다. README의 설정 순서를 따라 주세요.');
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function fetchHtml_(url) {
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KNU-INFO/1.0)' }
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error('학교 홈페이지 요청 실패 (' + status + '): ' + url);
  return response.getContentText('UTF-8');
}

function parseNoticeList_(html, board) {
  const output = [];
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  rows.forEach((tr, index) => {
    const anchors = tr.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi) || [];
    let chosen = null;
    anchors.forEach(a => {
      const hrefMatch = a.match(/href\s*=\s*["']([^"']+)["']/i);
      const titleMatch = a.match(/>([\s\S]*?)<\/a>/i);
      if (!hrefMatch || !titleMatch) return;
      const href = hrefMatch[1];
      const title = cleanText_(titleMatch[1]);
      if (title && href.indexOf('/bbs/' + board.boardId + '/') >= 0 && !/list\.do/i.test(href)) {
        chosen = { href, title };
      }
    });
    if (!chosen) return;
    const text = cleanText_(tr);
    const dateMatch = text.match(/\d{4}[.-]\s?\d{1,2}[.-]\s?\d{1,2}/);
    const date = dateMatch ? dateMatch[0].replace(/\s/g, '').replace(/-/g, '.') : '';
    const campusMatch = text.match(/(강릉\s*원주|춘천\s*삼척|춘천|강릉|삼척|원주|ALL)/);
    const campus = campusMatch ? campusMatch[0] : '';
    const url = chosen.href.startsWith('http') ? chosen.href : 'https://www.kangwon.ac.kr' + (chosen.href.startsWith('/') ? '' : '/') + chosen.href;
    const idMatch = url.match(/\/bbs\/\d+\/(\d+)\//) || url.match(/[?&](?:nttId|articleNo|id)=(\d+)/i);
    const id = idMatch ? board.boardId + '-' + idMatch[1] : board.boardId + '-' + Utilities.base64EncodeWebSafe(url).slice(0, 24);
    output.push({ id, category: board.category, title: chosen.title, date, campus, author: '', url });
  });
  return output;
}

function cleanText_(html) {
  return decodeEntities_(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim());
}

function htmlToText_(html) {
  let text = String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities_(text).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

function decodeEntities_(text) {
  return String(text).replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function dateKey_(date) {
  const m = String(date || '').match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
}
