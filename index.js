const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 8080;

// 1. CORS & Rate Limiting
app.use(cors({
  origin: ['*'] // Change '*' to your Luna URL in production
}));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
app.use('/api/', limiter);

// 2. Cache
const cache = new Map();

// 3. List of free public SearXNG instances (Fallbacks)
const SEARX_INSTANCES = [
  'https://search.sapti.me',
  'https://searx.be',
  'https://search.ononoki.org',
  'https://searx.tiekoetter.com'
];

// Helper function to try searching across instances
async function fetchSearchResults(query) {
  for (const instance of SEARX_INSTANCES) {
    try {
      const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json`;
      
      // Fetch with a 5-second timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) continue; // Try next instance if this one fails

      const data = await response.json();
      return data.results || []; // Return results if successful
      
    } catch (err) {
      console.warn(`Instance ${instance} failed, trying next...`);
      continue; // Move to the next instance
    }
  }
  throw new Error('All search instances failed. Try again later.');
}

// 4. The Search Endpoint
app.get('/', (req, res) => {
  res.send('🚀 Luna Search API is running! Use /api/search?q=your_query');
});

app.get('/api/search', async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.status(400).json({ error: 'Missing ?q= parameter' });
  }

  if (cache.has(query)) {
    return res.json(cache.get(query));
  }

  try {
    // Use our new robust fetcher
    const rawResults = await fetchSearchResults(query);

    const formattedResponse = {
      query: query,
      results: rawResults.slice(0, 8).map(item => ({
        title: item.title || '',
        url: item.url || '',
        snippet: item.content || ''
      }))
    };

    // Cache for 10 minutes
    cache.set(query, formattedResponse);
    setTimeout(() => cache.delete(query), 10 * 60 * 1000);

    res.json(formattedResponse);

  } catch (error) {
    console.error('Search failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🔍 Luna Search API running on port ${PORT}`);
});
