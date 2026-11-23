const { fetchNotices } = require('../lib/scraper');

let cache = { at: 0, notices: [] };
const CACHE_MS = 5 * 60 * 1000;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  try {
    const refresh = req.query.refresh === '1';
    if (refresh || !cache.notices.length || Date.now() - cache.at > CACHE_MS) {
      cache.notices = await fetchNotices();
      cache.at = Date.now();
    }
    const category = String(req.query.category || '전체');
    const q = String(req.query.q || '').trim().toLowerCase();
    const notices = cache.notices.filter(n =>
      (category === '전체' || n.category === category) &&
      (!q || [n.title,n.campus,n.author,n.category].join(' ').toLowerCase().includes(q))
    ).slice(0, 100);
    const updatedAt = cache.at ? new Date(cache.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '';
    return res.status(200).json({ notices, updatedAt, count: cache.notices.length });
  } catch (error) {
    console.error('notices API error:', error);
    return res.status(502).json({ error: error.message || '공지사항 수집 중 오류가 발생했습니다.' });
  }
};
