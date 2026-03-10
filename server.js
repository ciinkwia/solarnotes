const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// Load .env file if it exists
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = (match[2] || '').replace(/^['"]|['"]$/g, '');
    }
  });
}

const app = express();
const PORT = 3000;
const NOTES_FILE = path.join(__dirname, 'data', 'notes.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Check for API key
const apiKey = process.env.ANTHROPIC_API_KEY;
let anthropic = null;
if (!apiKey) {
  console.warn('\n========================================');
  console.warn('  ANTHROPIC_API_KEY is not set!');
  console.warn('  Set it in your environment:');
  console.warn('    export ANTHROPIC_API_KEY=sk-ant-...');
  console.warn('  The app will run but cannot generate answers.');
  console.warn('========================================\n');
} else {
  anthropic = new Anthropic({ apiKey });
}

const SYSTEM_PROMPT = `You are a senior solar energy engineer and instructor helping a solar technician in training. When answering questions, provide a detailed, structured report using this format:

## Summary
A brief 2-3 sentence overview of the answer.

## Detailed Explanation
The core technical explanation. Use clear language but don't oversimplify — the reader is a technician, not a homeowner.

## Practical Field Tips
Bullet points with hands-on advice relevant to installation, troubleshooting, or maintenance work in the field.

## Safety Considerations
Any relevant safety warnings, PPE requirements, or hazard awareness.

## Relevant Codes & Standards
Reference applicable NEC articles, UL standards, or local code requirements where relevant. If none apply, omit this section.

## Key Takeaway
One sentence the reader should remember above all else.

Use markdown formatting. Be thorough but scannable — this technician may be reviewing these notes between jobs.`;

// Load notes from file
function loadNotes() {
  try {
    const data = fs.readFileSync(NOTES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Save notes to file
function saveNotes(notes) {
  fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2));
}

// Ask a question — get Claude's answer and save it
app.post('/api/ask', async (req, res) => {
  const { question } = req.body;
  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'Question is required' });
  }

  if (!anthropic) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not set. Add it to your environment and restart the server.' });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: question.trim() }],
    });

    const answer = message.content[0].text;
    const notes = loadNotes();
    const note = {
      id: Date.now().toString(),
      question: question.trim(),
      answer,
      createdAt: new Date().toISOString(),
    };
    notes.unshift(note);
    saveNotes(notes);

    res.json(note);
  } catch (err) {
    console.error('Claude API error:', err.message);
    res.status(500).json({ error: 'Failed to generate answer. Check your API key and try again.' });
  }
});

// Get all saved notes
app.get('/api/notes', (req, res) => {
  res.json(loadNotes());
});

// Delete a note
app.delete('/api/notes/:id', (req, res) => {
  const notes = loadNotes();
  const filtered = notes.filter(n => n.id !== req.params.id);
  if (filtered.length === notes.length) {
    return res.status(404).json({ error: 'Note not found' });
  }
  saveNotes(filtered);
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  SolarNotes running at:`);
  console.log(`    Local:   http://localhost:${PORT}`);
  console.log(`    Phone:   http://192.168.0.104:${PORT}
`);
});
