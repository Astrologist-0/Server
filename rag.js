// RAG Engine: Web Crawler + Gemini LLM
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_CX  = process.env.GOOGLE_SEARCH_CX;

// ── Step 1: Crawl relevant astrology content ──────────────────────────────────

async function crawlPage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AstrologistBot/1.0)' },
      signal: AbortSignal.timeout(5000),
    });
    const html = await res.text();
    // Strip HTML tags, get plain text
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000); // Max 3000 chars per page
    return text;
  } catch {
    return null;
  }
}

async function searchAndCrawl(query) {
  const results = [];

  // Try Google Custom Search first
  if (GOOGLE_KEY && GOOGLE_CX) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=3`;
      const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      if (data.items) {
        for (const item of data.items.slice(0, 3)) {
          const text = await crawlPage(item.link);
          if (text) results.push({ title: item.title, url: item.link, content: text, snippet: item.snippet });
        }
      }
    } catch (e) { console.warn('Google search failed:', e.message); }
  }

  // Fallback: DuckDuckGo instant answers
  if (results.length === 0) {
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
      const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      if (data.AbstractText) {
        results.push({ title: data.Heading, url: data.AbstractURL, content: data.AbstractText, snippet: data.AbstractText.slice(0, 200) });
      }
      for (const t of (data.RelatedTopics || []).slice(0, 3)) {
        if (t.Text) results.push({ title: t.Text.slice(0, 60), url: t.FirstURL, content: t.Text, snippet: t.Text.slice(0, 200) });
      }
    } catch (e) { console.warn('DuckDuckGo failed:', e.message); }
  }

  return results;
}

// ── Step 2: Build chart context string ───────────────────────────────────────

function buildChartContext(chartContext) {
  const { lagna, sun, moon, mars, mercury, jupiter, venus, saturn, rahu, ketu, currentDasha, yogas } = chartContext;
  return `
BIRTH CHART SUMMARY:
- Lagna (Ascendant): ${lagna}
- Sun: ${sun?.sign} in House ${sun?.house} (${sun?.strength})
- Moon: ${moon?.sign} in House ${moon?.house} (${moon?.strength}) — Nakshatra: ${moon?.nakshatra}
- Mars: ${mars?.sign} in House ${mars?.house} (${mars?.strength})
- Mercury: ${mercury?.sign} in House ${mercury?.house} (${mercury?.strength})
- Jupiter: ${jupiter?.sign} in House ${jupiter?.house} (${jupiter?.strength})
- Venus: ${venus?.sign} in House ${venus?.house} (${venus?.strength})
- Saturn: ${saturn?.sign} in House ${saturn?.house} (${saturn?.strength})
- Rahu: ${rahu?.sign} in House ${rahu?.house}
- Ketu: ${ketu?.sign} in House ${ketu?.house}
- Current Dasha: ${currentDasha}
- Notable Yogas: ${yogas}
`.trim();
}

// ── Step 3: Generate answer with Gemini ──────────────────────────────────────

async function generateWithGemini(question, chartContext, webContent) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(GEMINI_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const chartSummary = buildChartContext(chartContext);

  const webSection = webContent.length > 0
    ? `\nRELEVANT ASTROLOGY KNOWLEDGE (from web):\n${webContent.map((r, i) => `[${i+1}] ${r.title}\n${r.content}`).join('\n\n')}`
    : '';

  const prompt = `You are an expert Vedic astrologer. Answer the user's question based on their specific birth chart and the astrology knowledge provided.

${chartSummary}
${webSection}

USER QUESTION: ${question}

Instructions:
- Give a personalized answer based on the specific planetary positions in this chart
- Use the web knowledge to enrich your answer with deeper insights
- Be specific about which planets and houses are relevant
- Keep the answer focused, warm, and practical (3-5 sentences)
- Use Vedic astrology terminology naturally
- Do NOT mention that you searched the web or used external sources

ANSWER:`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ── Main RAG function ─────────────────────────────────────────────────────────

async function ragAnswer(question, chartContext) {
  // Build search query from question + chart context
  const searchQuery = `vedic astrology ${question} ${chartContext.lagna} lagna ${chartContext.moon?.sign} moon`;

  // Crawl in parallel with a timeout
  const webContent = await Promise.race([
    searchAndCrawl(searchQuery),
    new Promise(resolve => setTimeout(() => resolve([]), 8000)), // 8s timeout
  ]);

  // Generate answer with Gemini
  const answer = await generateWithGemini(question, chartContext, webContent);

  return {
    answer,
    sources: webContent.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
  };
}

module.exports = { ragAnswer };
