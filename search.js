const fetch = (...args) => import('node-fetch').then(m => m.default(...args));

const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_CX      = process.env.GOOGLE_SEARCH_CX; // Custom Search Engine ID

// Trusted astrology sources to prioritize
const TRUSTED_SOURCES = [
  'astrosage.com', 'cafeastrology.com', 'astrology.com',
  'vedicastrology.us', 'ganeshaspeaks.com', 'astroved.com',
  'indastro.com', 'astrocamp.com', 'quora.com',
];

// Build a focused astrology search query from the user question + chart context
function buildQuery(question, chartContext) {
  const { lagna, sun, moon, currentDasha } = chartContext;
  const base = question.toLowerCase();

  // Enrich query with chart specifics
  let query = `vedic astrology ${question}`;

  if (base.includes('love') || base.includes('marriage')) {
    query = `vedic astrology ${lagna} lagna love marriage ${sun.sign} sun ${moon.sign} moon`;
  } else if (base.includes('career') || base.includes('job')) {
    query = `vedic astrology ${lagna} ascendant career profession ${sun.sign} sun`;
  } else if (base.includes('health')) {
    query = `vedic astrology ${lagna} lagna health ${moon.sign} moon`;
  } else if (base.includes('dasha')) {
    query = `vedic astrology ${currentDasha.split('/')[0].trim()} mahadasha effects predictions`;
  } else if (base.includes('remedy') || base.includes('gemstone')) {
    query = `vedic astrology remedies ${lagna} lagna gemstone mantra`;
  }

  return query + ' site:astrosage.com OR site:cafeastrology.com OR site:ganeshaspeaks.com OR site:indastro.com OR site:quora.com';
}

async function searchGoogle(query) {
  if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    return null; // Fall back to DuckDuckGo
  }

  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=5`;
  const res  = await fetch(url, { timeout: 5000 });
  const data = await res.json();

  if (!data.items) return null;

  return data.items.map(item => ({
    title:   item.title,
    snippet: item.snippet,
    url:     item.link,
    source:  new URL(item.link).hostname.replace('www.', ''),
  }));
}

async function searchDuckDuckGo(query) {
  // DuckDuckGo Instant Answer API (no key needed)
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res  = await fetch(url, { timeout: 5000 });
  const data = await res.json();

  const results = [];

  if (data.AbstractText) {
    results.push({
      title:   data.Heading || query,
      snippet: data.AbstractText.slice(0, 400),
      url:     data.AbstractURL,
      source:  data.AbstractSource,
    });
  }

  if (data.RelatedTopics) {
    for (const t of data.RelatedTopics.slice(0, 4)) {
      if (t.Text) {
        results.push({
          title:   t.Text.slice(0, 80),
          snippet: t.Text.slice(0, 300),
          url:     t.FirstURL,
          source:  'DuckDuckGo',
        });
      }
    }
  }

  return results.length > 0 ? results : null;
}

// Main search function — tries Google first, falls back to DuckDuckGo
async function searchAstrology(question, chartContext) {
  const query = buildQuery(question, chartContext);
  console.log('Search query:', query);

  try {
    const results = await searchGoogle(query) || await searchDuckDuckGo(query);
    return { query, results: results || [] };
  } catch (err) {
    console.error('Search error:', err.message);
    return { query, results: [] };
  }
}

module.exports = { searchAstrology };
