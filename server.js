const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const admin = require('firebase-admin');

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

// Initialize Firebase Admin
let db;
try {
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    // Try loading from local file for development
    const saPath = path.join(__dirname, 'firebase-service-account.json');
    if (fs.existsSync(saPath)) {
      serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
    }
  }

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    db = admin.firestore();
    console.log('Firebase Admin initialized successfully');
  } else {
    console.warn('\n========================================');
    console.warn('  Firebase service account not found!');
    console.warn('  Set FIREBASE_SERVICE_ACCOUNT env var');
    console.warn('  or place firebase-service-account.json in project root.');
    console.warn('========================================\n');
  }
} catch (err) {
  console.error('Firebase Admin init error:', err.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

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

// Auth middleware — verify Firebase ID token
async function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name || decodedToken.email,
    };
    next();
  } catch (err) {
    console.error('Auth error:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Get current user info
app.get('/api/me', verifyAuth, (req, res) => {
  res.json(req.user);
});

// Ask a question — get Claude's answer and save it to Firestore
app.post('/api/ask', verifyAuth, async (req, res) => {
  const { question } = req.body;
  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'Question is required' });
  }

  if (!anthropic) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not set. Add it to your environment and restart the server.' });
  }

  if (!db) {
    return res.status(503).json({ error: 'Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT.' });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: question.trim() }],
    });

    const answer = message.content[0].text;
    const noteData = {
      userId: req.user.uid,
      question: question.trim(),
      answer,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection('notes').add(noteData);

    res.json({
      id: docRef.id,
      question: question.trim(),
      answer,
      followUps: [],
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Claude API error:', err.message);
    res.status(500).json({ error: 'Failed to generate answer. Check your API key and try again.' });
  }
});

// Follow up on an existing note
app.post('/api/notes/:id/followup', verifyAuth, async (req, res) => {
  const { question } = req.body;
  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'Follow-up question is required' });
  }

  if (!anthropic) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not set.' });
  }

  if (!db) {
    return res.status(503).json({ error: 'Firebase is not configured.' });
  }

  try {
    const docRef = db.collection('notes').doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Note not found' });
    }

    if (doc.data().userId !== req.user.uid) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const noteData = doc.data();
    const followUps = noteData.followUps || [];

    // Build conversation history for Claude
    const messages = [
      { role: 'user', content: noteData.question },
      { role: 'assistant', content: noteData.answer },
    ];
    for (const fu of followUps) {
      messages.push({ role: 'user', content: fu.question });
      messages.push({ role: 'assistant', content: fu.answer });
    }
    messages.push({ role: 'user', content: question.trim() });

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages,
    });

    const answer = message.content[0].text;
    const newFollowUp = {
      question: question.trim(),
      answer,
      createdAt: new Date().toISOString(),
    };

    followUps.push(newFollowUp);
    await docRef.update({ followUps });

    res.json(newFollowUp);
  } catch (err) {
    console.error('Follow-up error:', err.message);
    res.status(500).json({ error: 'Failed to generate follow-up answer.' });
  }
});

// Get all saved notes for the current user
app.get('/api/notes', verifyAuth, async (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'Firebase is not configured.' });
  }

  try {
    const snapshot = await db.collection('notes')
      .where('userId', '==', req.user.uid)
      .orderBy('createdAt', 'desc')
      .get();

    const notes = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        question: data.question,
        answer: data.answer,
        followUps: data.followUps || [],
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
      };
    });

    res.json(notes);
  } catch (err) {
    console.error('Firestore read error:', err.message);
    res.status(500).json({ error: 'Failed to load notes.' });
  }
});

// Delete a note (only if it belongs to the current user)
app.delete('/api/notes/:id', verifyAuth, async (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'Firebase is not configured.' });
  }

  try {
    const docRef = db.collection('notes').doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Note not found' });
    }

    if (doc.data().userId !== req.user.uid) {
      return res.status(403).json({ error: 'Not authorized to delete this note' });
    }

    await docRef.delete();
    res.json({ success: true });
  } catch (err) {
    console.error('Firestore delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete note.' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  SolarNotes running at:`);
  console.log(`    Local:   http://localhost:${PORT}`);
  console.log(`    Phone:   http://192.168.0.104:${PORT}
`);
});
