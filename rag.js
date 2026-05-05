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
  const {
    name, birthDate, birthTime, birthPlace,
    lagna, sun, moon, mars, mercury, jupiter, venus, saturn, rahu, ketu,
    currentDasha, yogas,
    // flat fields from chartBot.js
    sunSign, sunHouse, moonSign, moonHouse, marsSign, marsHouse,
    meSign, meHouse, jupSign, jupHouse, venusSign, venusHouse,
    satSign, satHouse, rahuHouse, ketuHouse,
    nakshatra, tithi, yoga, vara,
  } = chartContext;

  // Support both flat (from chartBot) and nested (legacy) formats
  const sunStr     = sun     ? `${sun.sign} in House ${sun.house}`     : `${sunSign} in House ${sunHouse}`;
  const moonStr    = moon    ? `${moon.sign} in House ${moon.house}`   : `${moonSign} in House ${moonHouse}`;
  const marsStr    = mars    ? `${mars.sign} in House ${mars.house}`   : `${marsSign} in House ${marsHouse}`;
  const meStr      = mercury ? `${mercury.sign} in House ${mercury.house}` : `${meSign} in House ${meHouse}`;
  const jupStr     = jupiter ? `${jupiter.sign} in House ${jupiter.house}` : `${jupSign} in House ${jupHouse}`;
  const venStr     = venus   ? `${venus.sign} in House ${venus.house}` : `${venusSign} in House ${venusHouse}`;
  const satStr     = saturn  ? `${saturn.sign} in House ${saturn.house}` : `${satSign} in House ${satHouse}`;
  const rahuStr    = rahu    ? `${rahu.sign} in House ${rahu.house}`   : `House ${rahuHouse}`;
  const ketuStr    = ketu    ? `${ketu.sign} in House ${ketu.house}`   : `House ${ketuHouse}`;
  const nakshatraStr = moon?.nakshatra || nakshatra || 'Unknown';

  const birthSection = (birthDate && birthDate !== 'Unknown')
    ? `BIRTH DETAILS:\n- Name: ${name || 'Native'}\n- Date of Birth: ${birthDate}\n- Time of Birth: ${birthTime}\n- Place of Birth: ${birthPlace}\n`
    : '';

  return `
${birthSection}
BIRTH CHART SUMMARY (Vedic / Sidereal, Lahiri Ayanamsa):
- Lagna (Ascendant): ${lagna}
- Sun: ${sunStr}
- Moon: ${moonStr} — Nakshatra: ${nakshatraStr}
- Mars: ${marsStr}
- Mercury: ${meStr}
- Jupiter: ${jupStr}
- Venus: ${venStr}
- Saturn: ${satStr}
- Rahu: ${rahuStr}
- Ketu: ${ketuStr}
- Current Dasha: ${currentDasha || 'See Dasha tab'}
- Notable Yogas: ${yogas || 'See Yogas tab'}
- Panchanga — Tithi: ${tithi || 'Unknown'}, Yoga: ${yoga || 'Unknown'}, Vara: ${vara || 'Unknown'}
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

  const prompt = `You are an expert Vedic astrologer with deep knowledge of Jyotisha. Answer the user's question based on their specific birth chart.

${chartSummary}
${webSection}

USER QUESTION: ${question}

Instructions:
- Address the person by name if provided
- Reference their specific birth date, time, and place when relevant to the answer
- Give a personalized answer based on the exact planetary positions in this chart
- Use the web knowledge to enrich your answer with deeper insights
- Be specific about which planets, signs, houses, and nakshatras are relevant
- Keep the answer focused, warm, and practical (4-6 sentences)
- Use Vedic astrology terminology naturally (e.g., Lagna, Graha, Bhava, Dasha)
- Do NOT mention that you searched the web or used external sources
- Do NOT give generic answers — every sentence should relate to this specific chart

After your answer, suggest exactly 4 follow-up questions the user might want to ask next, based on what you just answered and their specific chart. These should be natural, curious, and chart-specific — not generic.

Respond in this exact JSON format:
{
  "answer": "Your full answer here...",
  "followUps": [
    "First follow-up question?",
    "Second follow-up question?",
    "Third follow-up question?",
    "Fourth follow-up question?"
  ]
}`;

  const result = await model.generateContent(prompt);
  const raw = result.response.text().trim();

  // Parse JSON response from Gemini
  try {
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonStr);
    return {
      answer: parsed.answer || raw,
      followUps: Array.isArray(parsed.followUps) ? parsed.followUps.slice(0, 4) : [],
    };
  } catch {
    // Gemini didn't return valid JSON — extract answer as plain text, no follow-ups
    return { answer: raw, followUps: [] };
  }
}

// ── Main RAG function ─────────────────────────────────────────────────────────

async function ragAnswer(question, chartContext) {
  // Build search query from question + chart context
  const searchQuery = `vedic astrology ${question} ${chartContext.lagna} lagna ${chartContext.moonSign || chartContext.moon?.sign || ''} moon ${chartContext.nakshatra || ''} nakshatra`;

  // Crawl in parallel with a timeout
  const webContent = await Promise.race([
    searchAndCrawl(searchQuery),
    new Promise(resolve => setTimeout(() => resolve([]), 8000)), // 8s timeout
  ]);

  // Generate answer with Gemini
  const { answer, followUps } = await generateWithGemini(question, chartContext, webContent);

  return {
    answer,
    followUps,
    sources: webContent.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
  };
}

module.exports = { ragAnswer };
