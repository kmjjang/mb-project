// api/service.js
export default async function handler(req, res) {
  const { action, sources, title } = req.query;

  // 1. RSS 피드 수집 (서버 대 서버 통신으로 CORS 원천 차단)
  if (action === 'rss') {
    const RSS_MAP = {
      naver_finance: 'https://news.naver.com/main/rss/rss.nhn?oid=015',
      naver_econ:    'https://news.naver.com/main/rss/rss.nhn?oid=018',
      yonhap:        'https://www.yna.co.kr/rss/economy.xml',
      hankyung:      'https://www.hankyung.com/feed/economy',
      mk:            'https://www.mk.co.kr/rss/40300001/',
      edaily:        'https://www.edaily.co.kr/rss/news.asp?head=economic'
    };
    
    const targetSources = sources ? sources.split(',') : [];
    let allItems = [];
    
    // 네이버 봇 차단 회피용 브라우저 위장 헤더
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml; q=0.9, */*; q=0.8'
    };

    for (const key of targetSources) {
      const url = RSS_MAP[key];
      if (!url) continue;
      try {
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
        if (!response.ok) continue;
        
        const xml = await response.text();
        // Node.js 환경을 위한 초경량 정규식 기반 XML 파서 (O(N) 복잡도)
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;
        let count = 0;
        
        while ((match = itemRegex.exec(xml)) !== null && count < 12) {
          const itemStr = match[1];
          const itemTitle = (itemStr.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || itemStr.match(/<title>([\s\S]*?)<\/title>/))?.[1] || '';
          const itemLink = (itemStr.match(/<link>([\s\S]*?)<\/link>/))?.[1] || '';
          const itemDate = (itemStr.match(/<pubDate>([\s\S]*?)<\/pubDate>/))?.[1] || '';
          
          if (itemTitle.length > 3) {
            allItems.push({
              key,
              title: itemTitle.trim().replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"'),
              link: itemLink.trim(),
              pubDate: itemDate.trim(),
              source: key
            });
            count++;
          }
        }
      } catch (error) {
        console.warn(`[Zero] ${key} Fetch Error`);
      }
    }
    return res.status(200).json({ success: true, items: allItems });
  }

  // 2. Gemini AI 텍스트 분석 (Vercel 환경 변수에 숨겨둔 키 사용)
  if (action === 'ai') {
    // Vercel에서 설정할 환경변수 (코드를 털려도 API 키는 안전함)
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: '서버에 API 키가 설정되지 않았습니다.' });
    
    try {
      const prompt = `다음 한국 경제 뉴스 헤드라인을 주식시장 관점에서 2문장으로 분석해줘. 영향 섹터와 주목 이유 포함. 한국어로만 답해.\n뉴스: ${title}`;
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 160, temperature: 0.3 }
        }),
        signal: AbortSignal.timeout(12000)
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
      
      if (text) return res.status(200).json({ success: true, text });
      else return res.status(500).json({ error: 'AI 응답을 파싱할 수 없습니다.' });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
  
  return res.status(400).json({ error: 'Invalid Action' });
}