
const { fetchNoticeText, fetchNotices } = require('../lib/scraper');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(503).json({
        error: 'Vercel 환경 변수 GEMINI_API_KEY가 설정되지 않았습니다.'
      });
    }

    const { id } = req.body || {};

    if (!id || !/^(718|721)-[A-Za-z0-9_-]+$/.test(String(id))) {
      return res.status(400).json({
        error: '공지 ID가 올바르지 않습니다. 목록을 새로고침해 주세요.'
      });
    }

    // 공지목록에서 해당 ID 재조회
    const notices = await fetchNotices();
    const notice = notices.find(n => n.id === id);

    if (!notice) {
      return res.status(404).json({
        error: '공지사항을 찾을 수 없습니다. 목록을 새로고침해 주세요.'
      });
    }

    const sourceText = await fetchNoticeText(notice.url);

    const prompt = [
      '너는 대학 공지사항을 학생이 이해하기 쉽게 정리하는 도우미다.',
      '아래 원문에 있는 사실만 사용하고 일정이나 대상을 추측하지 마라.',
      '한국어로 다음 형식으로 간결하게 요약해라:',
      '1. 핵심 내용 (2~3문장)',
      '2. 대상',
      '3. 주요 일정 및 신청 방법 (원문에 있을 때만)',
      '4. 학생이 확인할 점',
      '원문에서 확인할 수 없는 정보는 "원문에서 확인 필요"라고 밝혀라.',
      '',
      `제목: ${notice.title}`,
      `분류: ${notice.category}`,
      '원문:',
      sourceText
    ].join('\n');

    // Gemini 3.8 Flash
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=' + encodeURIComponent(apiKey),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        }),
        signal: AbortSignal.timeout(20000)
      }
    );

    const body = await response.json();

    if (!response.ok) {
      throw new Error(body?.error?.message || 'Gemini API 요청에 실패했습니다.');
    }

    const summary = body?.candidates?.[0]?.content?.parts
      ?.map(p => p.text || '')
      .join('\n')
      .trim();

    if (!summary) {
      throw new Error('Gemini가 요약 결과를 반환하지 않았습니다.');
    }

    return res.status(200).json({ id, summary });

  } catch (error) {
    console.error('summarize API error:', error);

    return res.status(500).json({
      error: error.message || '공지 요약 중 오류가 발생했습니다.'
    });
  }
};
