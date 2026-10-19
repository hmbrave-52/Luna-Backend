const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 8080;

// ==========================================
// 1. SECURITY & CORS SETUP
// ==========================================
app.use(cors({ origin: ['*'] }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests from Luna, please slow down.' }
});
app.use('/api/', limiter);

// ==========================================
// 2. IN-MEMORY CACHE
// ==========================================
const cache = new Map();

// ==========================================
// 3. OFFICIAL DDG INSTANT ANSWER FETCHER
// ==========================================
async function fetchSearchResults(query) {
  // Official DDG API - Sanctioned, free, no key needed, never blocked
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  
  const response = await fetch(url, { 
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(5000) // 5s timeout just in case
  });

  if (!response.ok) throw new Error(`DDG API returned status ${response.status}`);
  
  const data = await response.json();
  const results = [];

  // 1. Direct Abstract (Usually Wikipedia summary)
  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL,
      content: data.AbstractText
    });
  }

  // 2. Related Topics (Additional context & links)
  if (Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics) {
      // Skip nested topic groups, only take direct results
      if (topic.Text && topic.FirstURL && results.length < 8) {
        results.push({
          title: topic.Text.split(' - ')[0] || topic.Text.substring(0, 60),
          url: topic.FirstURL,
          content: topic.Text
        });
      }
    }
  }

  // 3. Fallback: Definition (Dictionary/Technical terms)
  if (results.length === 0 && data.Definition) {
    results.push({
      title: data.DefinitionSource || query,
      url: data.DefinitionURL || '',
      content: data.Definition
    });
  }

  if (results.length === 0) {
    throw new Error('No instant answer found for this specific query.');
  }

  return results;
}

// ==========================================
// 4. API ENDPOINTS
// ==========================================
app.get('/', (req, res) => {
  res.send('🚀 Luna Search API is running! Use endpoint: /api/search?q=your_query');
});

app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/api/search', async (req, res) => {
  const query = req.query.q;

  if (!query) return res.status(400).json({ error: 'Missing ?q= parameter' });
  if (cache.has(query)) return res.json(cache.get(query));

  try {
    const rawResults = await fetchSearchResults(query);

    const formattedResponse = {
      query,
      results: rawResults.map(item => ({
        title: item.title,
        url: item.url,
        snippet: item.content
      }))
    };

    cache.set(query, formattedResponse);
    setTimeout(() => cache.delete(query), 10 * 60 * 1000);

    res.json(formattedResponse);
  } catch (error) {
    console.error('Search failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 5. START SERVER
// ==========================================
app.listen(PORT, () => {
  console.log(`🔍 Luna Search API running on port ${PORT}`);
});
