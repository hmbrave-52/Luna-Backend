const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios'); // <--- THE FIX

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
// 3. THE ULTIMATE DDG LITE FETCHER (Using Axios)
// ==========================================
async function fetchSearchResults(query) {
  try {
    // Use URLSearchParams to safely format the POST body
    const params = new URLSearchParams();
    params.append('q', query);

    const response = await axios.post('https://lite.duckduckgo.com/lite/', params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      timeout: 8000 // Fail fast if DDG is hanging
    });

    const html = response.data;
    const results = [];

    // Improved Regex: Catches links even if class order changes slightly
    const linkRegex = /<a[^>]*rel="nofollow"[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>|<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
    const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>(.*?)<\/td>/gis;

    let match;
    let snippets = [...html.matchAll(snippetRegex)];
    let i = 0;

    while ((match = linkRegex.exec(html)) !== null && i < 8) {
      // Because of the OR (|) in regex, data might be in group 1&2 OR 3&4
      const url = match[1] || match[3];
      const rawTitle = match[2] || match[4];
      
      const title = rawTitle.replace(/<[^>]*>?/gm, '').trim();
      const snippet = snippets[i] ? snippets[i][1].replace(/<[^>]*>?/gm, '').trim() : '';

      if (url && url.startsWith('http') && !url.includes('duckduckgo.com')) {
        results.push({ title, url, content: snippet });
        i++;
      }
    }

    if (results.length === 0) {
      // If we got HTML but no results, DDG might have thrown a CAPTCHA
      throw new Error('DDG returned empty results (possible temporary block).');
    }

    return results;

  } catch (error) {
    // Pass the exact Axios error up so we can see it in logs
    if (error.response) {
      throw new Error(`DDG blocked us. Status: ${error.response.status}`);
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('DDG request timed out.');
    } else {
      throw new Error(error.message || 'Network request failed');
    }
  }
}

// ==========================================
// 4. API ENDPOINTS
// ==========================================
app.get('/', (req, res) => {
  res.send('🚀 Luna Search API is running! Use endpoint: /api/search?q=your_query');
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
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
    const rawResults = await fetchSearchResults(query);

    const formattedResponse = {
      query: query,
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
    // Return the EXACT error so you know what went wrong
    res.status(500).json({ error: error.message }); 
  }
});

// ==========================================
// 5. START SERVER
// ==========================================
app.listen(PORT, () => {
  console.log(`🔍 Luna Search API running on port ${PORT}`);
});
