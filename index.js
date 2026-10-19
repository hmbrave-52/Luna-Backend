const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 8080;

// ==========================================
// 1. SECURITY & CORS SETUP
// ==========================================

// Allow Luna to talk to this server
// IMPORTANT: Change '*' to your actual Luna URL in production (e.g., 'https://your-luna-app.com')
app.use(cors({
  origin: ['*'] 
}));

// Prevent spam (Max 30 requests per minute per IP)
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
// 3. THE ULTIMATE DDG LITE FETCHER (METHOD 1)
// ==========================================
async function fetchSearchResults(query) {
  const response = await fetch('https://lite.duckduckgo.com/lite/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Pretend to be a normal browser so DDG doesn't block Render's IP
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    body: `q=${encodeURIComponent(query)}`
  });

  if (!response.ok) throw new Error('DDG Lite blocked the request');

  const html = await response.text();
  const results = [];

  // Regex to find links and snippets in DDG Lite's simple HTML
  const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
  const snippetRegex = /<td[^>]+class="result-snippet"[^>]*>(.*?)<\/td>/gis;

  let match;
  let snippets = [...html.matchAll(snippetRegex)];
  let i = 0;

  while ((match = linkRegex.exec(html)) !== null && i < 8) {
    const url = match[1];
    
    // Strip any leftover HTML tags from the title and snippet
    const title = match[2].replace(/<[^>]*>?/gm, '').trim();
    const snippet = snippets[i] ? snippets[i][1].replace(/<[^>]*>?/gm, '').trim() : '';

    // Filter out DuckDuckGo's own internal links, keep only real web results
    if (url.startsWith('http') && !url.includes('duckduckgo.com')) {
      results.push({ title, url, content: snippet });
      i++;
    }
  }

  if (results.length === 0) throw new Error('No results found or DDG changed their layout.');
  return results;
}


// ==========================================
// 4. API ENDPOINTS
// ==========================================

// Home route (Fixes the "Cannot GET /" error)
app.get('/', (req, res) => {
  res.send('🚀 Luna Search API is running! Use endpoint: /api/search?q=your_query');
});

// Health check route (Use this with cron-job.org to keep Render awake)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// The Main Search Endpoint
app.get('/api/search', async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.status(400).json({ error: 'Missing ?q= parameter' });
  }

  // Return cached result instantly if we searched this recently
  if (cache.has(query)) {
    return res.json(cache.get(query));
  }

  try {
    // Fetch from DuckDuckGo Lite
    const rawResults = await fetchSearchResults(query);

    // Format nicely for Luna
    const formattedResponse = {
      query: query,
      results: rawResults.map(item => ({
        title: item.title,
        url: item.url,
        snippet: item.content
      }))
    };

    // Save to cache for 10 minutes
    cache.set(query, formattedResponse);
    setTimeout(() => cache.delete(query), 10 * 60 * 1000);

    // Send back to Luna
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
