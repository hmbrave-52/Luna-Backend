import express from 'express';
import { search } from 'duck-duck-scrape';
import OpenAI from 'openai';
import JSZip from 'jszip';

const app = express();
app.use(express.json());

// ==========================================
// LITEROUTER CONFIGURATION
// ==========================================
const liteRouter = new OpenAI({
  // Render injects your secret key automatically
  apiKey: process.env.LITEROUTER_API_KEY, 
  baseURL: "https://api.literouter.com/v1" 
});

const AI_MODEL = "glm-5.3-flash:free"; 
// ==========================================

// In-memory storage for tasks (No Redis needed)
const tasks = {};

// 1. Endpoint to START the task
app.post('/api/generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  const taskId = crypto.randomUUID();
  tasks[taskId] = { status: 'processing', zipBase64: null, error: null };

  // Reply immediately so Luna doesn't freeze
  res.json({ success: true, taskId });

  // Run the heavy AI work in the background
  processTask(taskId, prompt).catch(err => console.error(`Task ${taskId} failed:`, err));
});

// 2. Endpoint to CHECK the task status
app.get('/api/status/:taskId', (req, res) => {
  const task = tasks[req.params.taskId];
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// Background processing function
async function processTask(taskId, userPrompt) {
  try {
    console.log(`[${taskId}] Starting DuckDuckGo Search...`);
    const searchResults = await search(userPrompt + " html css js code example");
    const context = searchResults.results ? searchResults.results.slice(0, 2).map(r => r.description).join("\n") : "";

    console.log(`[${taskId}] Asking LiteRouter (${AI_MODEL}) for code...`);
    
    const completion = await liteRouter.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { 
          role: "system", 
          content: "You are an expert web developer. Return ONLY valid JSON with exactly three keys: 'index.html', 'style.css', and 'script.js'. Do NOT include markdown formatting like ```json. Just raw JSON." 
        },
        { 
          role: "user", 
          content: `Context from web search: ${context}\n\nUser Request: ${userPrompt}` 
        }
      ]
    });

    let rawContent = completion.choices[0].message.content.trim();
    
    // Smart Parser: Clean up markdown if the AI ignored the prompt
    rawContent = rawContent.replace(/^```json\s*/i, '')
                           .replace(/^```\s*/i, '')
                           .replace(/\s*```$/i, '');

    const generatedFiles = JSON.parse(rawContent);

    console.log(`[${taskId}] Creating ZIP file...`);
    const zip = new JSZip();
    
    for (const [fileName, fileContent] of Object.entries(generatedFiles)) {
      zip.file(fileName, fileContent);
    }
    
    const zipBase64 = await zip.generateAsync({ type: "base64" });
    tasks[taskId] = { status: 'completed', zipBase64: zipBase64, error: null };
    console.log(`[${taskId}] Finished successfully!`);

  } catch (error) {
    console.error(`[${taskId}] Error:`, error.message);
    tasks[taskId] = { status: 'failed', zipBase64: null, error: error.message };
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}. Model: ${AI_MODEL}`);
});
