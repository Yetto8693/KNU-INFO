const cheerio = require('cheerio');

const BOARDS = [
  { category: '학사공지', boardId: '718', url: 'https://www.kangwon.ac.kr/ko/bbs/718/list.do' },
  { category: '장학공지', boardId: '721', url: 'https://www.kangwon.ac.kr/ko/bbs/721/list.do' }
];

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
function absoluteUrl(href) {
  try { return new URL(href, 'https://www.kangwon.ac.kr').toString(); }
  catch { return ''; }
}
function parseDate(text) {
  const m = text.match(/\d{4}[.-]\s?\d{1,2}[.-]\s?\d{1,2}/);
  return m ? m[0].replace(/\s/g, '').replace(/-/g, '.') : '';
}
function parseBoard(html, board) {
  const $ = cheerio.load(html);
  const out = [];
  $('tr').each((_, tr) => {
    const row = $(tr);
    const link = row.find('a[href]').toArray().map(a => ({
      href: $(a).attr('href'),
      title: clean($(a).text())
    })).find(a => a.title && a.href && a.href.includes('/bbs/' + board.boardId + '/') && !/list\.do/i.test(a.href));
    if (!link) return;
    const rowText = clean(row.text());
    const url = absoluteUrl(link.href);
    if (!url) return;
    const idMatch = url.match(/\/bbs\/\d+\/(\d+)(?:\/|\.|$)/) || url.match(/[?&](?:nttId|articleNo|id)=(\d+)/i);
    const id = idMatch ? board.boardId + '-' + idMatch[1] : board.boardId + '-' + Buffer.from(url).toString('base64url').slice(0, 22);
    const campusMatch = rowText.match(/(강릉\s*원주|춘천\s*삼척|춘천|강릉|삼척|원주|ALL)/);
    const cells = row.find('td').map((_, td) => clean($(td).text())).get();
    out.push({
      id, category: board.category, title: link.title,
      date: parseDate(rowText), campus: campusMatch ? campusMatch[0] : '',
      author: cells.length > 2 ? cells[cells.length - 2] : '',
      url
    });
  });
  return out;
}
async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KNU-INFO/1.0)', 'Accept': 'text/html' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`학교 홈페이지 요청 실패 (${response.status})`);
  return await response.text();
}
async function fetchNotices() {
  const results = [];
  for (const board of BOARDS) {
    // 한 번의 갱신에서 각 게시판 최신 2페이지를 수집
    for (let page = 1; page <= 2; page++) {
      const url = `${board.url}?pageIndex=${page}&pageItm=20&searchGbn=0&searchOrderSort=0`;
      const html = await fetchText(url);
      results.push(...parseBoard(html, board));
    }
  }
  const unique = new Map();
  for (const item of results) if (!unique.has(item.id)) unique.set(item.id, item);
  return [...unique.values()].sort((a,b)=>dateValue(b.date)-dateValue(a.date));
}
function dateValue(s) {
  const m=String(s||'').match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  return m ? Number(m[1])*10000+Number(m[2])*100+Number(m[3]) : 0;
}
async function fetchNoticeText(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== 'www.kangwon.ac.kr' || !/^\/ko\/bbs\/(718|721)\//.test(parsed.pathname)) {
    throw new Error('허용되지 않은 공지사항 주소입니다.');
  }
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  $('script,style,nav,header,footer,form').remove();
  return clean($('body').text()).slice(0, 12000);
}
module.exports = { fetchNotices, fetchNoticeText };
