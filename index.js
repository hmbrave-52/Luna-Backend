import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import JSZip from 'jszip';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
const app = express();
app.use(cors()); 
app.use(express.json({ limit: '10mb' }));

const liteRouter = new OpenAI({
  apiKey: process.env.LITEROUTER_API_KEY, 
  baseURL: "https://api.literouter.com/v1" 
});
const AI_MODEL = "glm-5.3-flash:free"; 
const tasks = {};

app.get('/', (req, res) => {
  res.send('✅ Luna AI Server is ONLINE and running the LATEST code!');
});

app.post('/api/tasks', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  const taskId = crypto.randomUUID();
  const taskDir = path.join('/tmp', taskId);
  
  tasks[taskId] = { status: 'processing', zipBase64: null, files: {} };
  res.json({ success: true, taskId, message: "Task created!" });

  try {
    await fs.mkdir(taskDir, { recursive: true });
    
    // Much stricter system prompt to force JSON output
    const completion = await liteRouter.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { 
          role: "system", 
          content: `You MUST return ONLY valid JSON. No HTML, no markdown, no explanation. 
The JSON must have exactly this structure:
{
  "files": {
    "index.html": "complete HTML code here",
    "style.css": "complete CSS code here",
    "script.js": "complete JavaScript code here"
  },
  "packages": ["array", "of", "npm", "packages"]
}
Escape all quotes and newlines properly in the strings. Return ONLY the JSON object, nothing else.`
        },
        { 
          role: "user", 
          content: `Create a web project: ${prompt}`
        }
      ],
      temperature: 0.3 // Lower temperature = more predictable output
    });

    let raw = completion.choices[0].message.content.trim();
    console.log(`[${taskId}] AI Response preview:`, raw.substring(0, 200));
    
    // Try to extract JSON from the response
    let generated;
    try {
      // First try: direct parse
      generated = JSON.parse(raw);
    } catch (e) {
      // Second try: extract JSON from markdown code blocks
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        generated = JSON.parse(jsonMatch[1]);
      } else {
        // Third try: find first { and last }
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          generated = JSON.parse(raw.substring(start, end + 1));
        } else {
          throw new Error("AI did not return valid JSON. Raw response: " + raw.substring(0, 500));
        }
      }
    }

    // Write files to temp directory
    for (const [name, content] of Object.entries(generated.files || {})) {
      await fs.writeFile(path.join(taskDir, name), content);
    }

    // Install packages if any
    if (generated.packages && generated.packages.length > 0) {
      console.log(`[${taskId}] Installing packages:`, generated.packages);
      await execPromise(`cd ${taskDir} && npm init -y && npm install ${generated.packages.join(' ')}`);
    }

    // Create ZIP
    const zip = new JSZip();
    await addDirToZip(zip, taskDir, '');
    const zipBase64 = await zip.generateAsync({ type: "base64" });

    tasks[taskId] = { status: 'completed', zipBase64: zipBase64, files: generated.files || {} };
    console.log(`[${taskId}] Task completed successfully!`);
    
  } catch (error) {
    console.error(`[${taskId}] Error:`, error.message);
    tasks[taskId] = { status: 'failed', zipBase64: null, error: error.message };
  } finally {
    // Clean up temp directory
    await fs.rm(taskDir, { recursive: true, force: true }).catch(() => {});
  }
});

app.get('/api/tasks/:taskId', (req, res) => {
  const task = tasks[req.params.taskId];
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json(task);
});

app.put('/api/tasks/:taskId/files/:fileName', (req, res) => {
  const task = tasks[req.params.taskId];
  if (!task || !task.files[req.params.fileName]) return res.status(404).json({ error: "Not found" });
  task.files[req.params.fileName] = req.body.newContent;
  res.json({ success: true, message: "File edited!" });
});

app.delete('/api/tasks/:taskId', (req, res) => {
  if (tasks[req.params.taskId]) {
    delete tasks[req.params.taskId];
    res.json({ success: true, message: "Deleted and RAM freed!" });
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

async function addDirToZip(zip, dirPath, zipPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === 'node_modules') continue; 
        const fullPath = path.join(dirPath, entry.name);
        const currentZipPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await addDirToZip(zip, fullPath, currentZipPath);
        else zip.file(currentZipPath, await fs.readFile(fullPath));
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}. Model: ${AI_MODEL}`));
