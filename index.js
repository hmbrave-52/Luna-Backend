const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { search, SafeSearchType } = require('duck-duck-scrape');

const app = express();
const PORT = process.env.PORT || 8080;

// ==========================================
// 1. SECURITY & CORS SETUP
// ==========================================

// Allow Luna to talk to this server
// CHANGE 'https://your-luna-app.com' TO YOUR ACTUAL LUNA URL
app.use(cors({
  origin: ['https://your-luna-app.com', 'http://localhost:3000', 'http://localhost:5173'] 
}));

// Prevent people from spamming your API (Max 30 requests per minute per IP)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please slow down.' }
});
app.use('/api/', limiter);


// ==========================================
// 2. IN-MEMORY CACHE (Saves repeated searches)
// ==========================================
const cache = new Map();


// ==========================================
// 3. THE SEARCH ENDPOINT
// ==========================================
app.get('/api/search', async (req, res) => {
  const query = req.query.q;

  // If Luna didn't send a query
  if (!query) {
    return res.status(400).json({ error: 'Missing ?q= parameter' });
  }

  // If we already searched this recently, return cached result instantly
  if (cache.has(query)) {
    return res.json(cache.get(query));
  }

  try {
    // Perform the web search (Free, no API key needed)
    const rawResults = await search(query, { 
      safeSearch: SafeSearchType.MODERATE 
    });

    // Format the data nicely for Luna
    const formattedResponse = {
      query: query,
      results: rawResults.results.slice(0, 8).map(item => ({
        title: item.title,
        url: item.url,
        snippet: item.description
      }))
    };

    // Save to cache for 10 minutes
    cache.set(query, formattedResponse);
    setTimeout(() => cache.delete(query), 10 * 60 * 1000);

    // Send answer back to Luna
    res.json(formattedResponse);

  } catch (error) {
    console.error('Search failed:', error);
    res.status(500).json({ error: 'Search engine failed. Try again later.' });
  }
});

// Health check endpoint (Good for keeping Render awake)
app.get('/health', (req, res) => {
  res.status(200).send('Luna Search API is alive!');
});


// ==========================================
// 4. START SERVER
// ==========================================
app.listen(PORT, () => {
  console.log(`🔍 Luna Search API running on port ${PORT}`);
});
