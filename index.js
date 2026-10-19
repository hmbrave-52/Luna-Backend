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

// TEST ROUTE: To check if the new code is loaded
app.get('/', (req, res) => {
  res.send('✅ Luna AI Server is ONLINE and running the LATEST code!');
});

// 1. POST METHOD (Generate)
app.post('/api/tasks', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  const taskId = crypto.randomUUID();
  const taskDir = path.join('/tmp', taskId);
  
  tasks[taskId] = { status: 'processing', zipBase64: null, files: {} };
  res.json({ success: true, taskId, message: "Task created!" });

  try {
    await fs.mkdir(taskDir, { recursive: true });
    const completion = await liteRouter.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: "Return ONLY valid JSON with keys: 'files' (object of filename to content) and 'packages' (array of npm packages). No markdown." },
        { role: "user", content: prompt }
      ]
    });

    let raw = completion.choices[0].message.content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    const generated = JSON.parse(raw);

    for (const [name, content] of Object.entries(generated.files)) {
      await fs.writeFile(path.join(taskDir, name), content);
    }

    if (generated.packages && generated.packages.length > 0) {
      await execPromise(`cd ${taskDir} && npm init -y && npm install ${generated.packages.join(' ')}`);
    }

    const zip = new JSZip();
    await addDirToZip(zip, taskDir, '');
    const zipBase64 = await zip.generateAsync({ type: "base64" });

    tasks[taskId] = { status: 'completed', zipBase64: zipBase64, files: generated.files };
  } catch (error) {
    tasks[taskId] = { status: 'failed', zipBase64: null, error: error.message };
  } finally {
    await fs.rm(taskDir, { recursive: true, force: true });
  }
});

// 2. GET METHOD (Check Status)
app.get('/api/tasks/:taskId', (req, res) => {
  const task = tasks[req.params.taskId];
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json(task);
});

// 3. PUT METHOD (Edit File)
app.put('/api/tasks/:taskId/files/:fileName', (req, res) => {
  const task = tasks[req.params.taskId];
  if (!task || !task.files[req.params.fileName]) return res.status(404).json({ error: "Not found" });
  task.files[req.params.fileName] = req.body.newContent;
  res.json({ success: true, message: "File edited!" });
});

// 4. DELETE METHOD (Free RAM)
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
