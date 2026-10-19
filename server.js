import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import JSZip from 'jszip';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

// Allows us to run terminal commands safely
const execPromise = util.promisify(exec);

const app = express();
app.use(cors()); 
app.use(express.json({ limit: '10mb' })); // Allow larger JSON payloads

const liteRouter = new OpenAI({
  apiKey: process.env.LITEROUTER_API_KEY, 
  baseURL: "https://api.literouter.com/v1" 
});

const AI_MODEL = "glm-5.3-flash:free"; 

app.post('/api/advanced-generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  const taskId = crypto.randomUUID();
  
  // Create a safe, temporary workspace in the server's RAM/Storage
  const taskDir = path.join('/tmp', taskId);
  
  try {
    await fs.mkdir(taskDir, { recursive: true });

    console.log(`[${taskId}] Asking AI for code and required packages...`);
    const completion = await liteRouter.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { 
          role: "system", 
          content: "You are an expert developer. Return ONLY valid JSON with exactly two keys: 'files' (an object where keys are filenames and values are file content) and 'packages' (an array of npm package strings needed, e.g., ['axios', 'express']). Do NOT include markdown. Just raw JSON." 
        },
        { role: "user", content: prompt }
      ]
    });

    let rawContent = completion.choices[0].message.content.trim();
    rawContent = rawContent.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    const generated = JSON.parse(rawContent);

    // 1. Write the AI's files to the temporary workspace
    console.log(`[${taskId}] Writing files to sandbox...`);
    for (const [fileName, fileContent] of Object.entries(generated.files)) {
      await fs.writeFile(path.join(taskDir, fileName), fileContent);
    }

    // 2. Run Terminal Commands: Install requested packages
    if (generated.packages && generated.packages.length > 0) {
      const pkgList = generated.packages.join(' ');
      console.log(`[${taskId}] Running terminal command: npm install ${pkgList}`);
      
      // Initialize package.json and install packages in the sandbox
      await execPromise(`cd ${taskDir} && npm init -y && npm install ${pkgList}`);
    }

    // 3. Create the ZIP file (Skipping node_modules to save RAM!)
    console.log(`[${taskId}] Zipping project...`);
    const zip = new JSZip();
    await addDirToZip(zip, taskDir, '');
    
    const zipBase64 = await zip.generateAsync({ type: "base64" });

    // 4. Send to Luna
    res.json({ success: true, zipBase64 });

  } catch (error) {
    console.error(`[${taskId}] Sandbox Error:`, error.message);
    res.status(500).json({ error: error.message });
  } finally {
    // 5. CLEANUP: Completely delete the folder to free up RAM and Storage!
    console.log(`[${taskId}] Cleaning up sandbox to free RAM...`);
    await fs.rm(taskDir, { recursive: true, force: true });
  }
});

// Helper function to read folders and add to ZIP
async function addDirToZip(zip, dirPath, zipPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        // CRITICAL: Skip node_modules. It is huge and will crash Render's 512MB RAM limit.
        if (entry.name === 'node_modules') continue; 
        
        const fullPath = path.join(dirPath, entry.name);
        const currentZipPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;
        
        if (entry.isDirectory()) {
            await addDirToZip(zip, fullPath, currentZipPath);
        } else {
            const content = await fs.readFile(fullPath);
            zip.file(currentZipPath, content);
        }
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sandbox Server running. Model: ${AI_MODEL}`));
