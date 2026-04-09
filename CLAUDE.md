# SolarNotes

> **⚠️ INSTRUCTION TO CLAUDE:** This file is the source of truth for the project. **Any time we make a meaningful change to SolarNotes — new feature, architectural decision, deploy gotcha, dependency change, file restructure, schema change, or hard-won bug fix — you must update this CLAUDE.md before considering the task done.** Treat it as part of the deliverable. Bump the "Last updated" date at the bottom every time you edit it. If you're unsure whether something is worth recording, record it.

---

A PWA for asking field questions as a solar tech and getting **Perplexity Sonar Pro**–backed answers with citations, saved as "notes" in Firestore. Each note can be extended with threaded follow-up questions that carry the full conversation history back to Perplexity.

This is the **older sibling** of SolarJournal — the user built this first as an in-the-moment Q&A tool; SolarJournal is the end-of-day reflection companion. Both apps **share the same Firebase project** (`solarnotes-9c059`).

**Owner:** ciinkwia (jarridbaldwin@gmail.com)
**Stack:** Express + vanilla JS PWA, Firebase (Auth + Firestore), Perplexity Sonar Pro
**Deploy target:** Render (free tier)

---

## Architecture

```
Browser (PWA)
   │
   ├── Firebase Web SDK (compat 10.12.0) — Google Sign-In popup → redirect fallback
   │
   └── fetch → Express backend (Node)
         │
         ├── verifyAuth middleware — checks Bearer <Firebase ID token> via firebase-admin
         │
         ├── POST /api/ask           — single question → Perplexity → save Firestore note
         ├── POST /api/notes/:id/followup — appends a turn, re-sends full history
         ├── GET  /api/notes         — list user's notes, newest first
         ├── GET  /api/me            — current user info
         ├── DELETE /api/notes/:id   — delete (owner only)
         │
         ├── Perplexity Sonar Pro (model: 'sonar-pro', max_tokens 4096)
         │      system prompt loaded from system_prompt.txt
         │
         └── Firebase Admin → Firestore collection `notes`
               { userId, question, answer, followUps[], createdAt }
```

**No framework, no bundler.** Express serves `public/` statically; the client is vanilla JS calling the backend with the user's Firebase ID token.

---

## Key files

- **`server.js`** — Express app (~293 lines). Firebase Admin init, `.env` loader, `verifyAuth` middleware, 5 API routes, Perplexity call wrapper. Loads `system_prompt.txt` at boot.
- **`system_prompt.txt`** — the solar-tech-flavored persona prompt. Tailored to the user's actual field context (RevoluSun Hawaii, Tesla/Enphase/SolarEdge/Franklin gear). Edit this file, not a string in `server.js`.
- **`firebase-service-account.json`** — local dev credential file (gitignored). On Render, `FIREBASE_SERVICE_ACCOUNT` env var holds the JSON instead.
- **`package.json`** — `express@4.21.0`, `firebase-admin@13.7.0`. Script: `node server.js`.
- **`render.yaml`** — Render free-tier service config. Env vars: `PERPLEXITY_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`.
- **`public/index.html`** — SPA shell. Loads Firebase compat SDKs (auth + firestore) from `gstatic.com`. Firebase config for project `solarnotes-9c059` is hardcoded here.
- **`public/app.js`** — auth state listener, sign-in with popup→redirect fallback, Q&A view, notes list, follow-up threading, markdown rendering.
- **`public/style.css`** — dark theme, amber accent (shared design language with SolarJournal).
- **`public/sw.js`** — service worker for offline app shell caching.
- **`public/manifest.json`** — PWA manifest.
- **`data/notes.json`** — legacy/seed file from before Firestore. Not used at runtime.

---

## Firestore schema

Single top-level collection:

```
notes/{docId}
  userId: string          // Firebase uid
  question: string        // the original question
  answer: string          // Perplexity's Sonar Pro response (markdown)
  followUps: [            // appended in order
    { question, answer, createdAt: ISO string }
  ]
  createdAt: Timestamp    // serverTimestamp on create
```

Ownership is enforced in Express (`doc.data().userId !== req.user.uid → 403`). Firestore security rules are NOT in this repo — they live in the Firebase console. If you ever see permission errors on direct client writes, check them there (but the client currently doesn't write to Firestore directly — all writes go through the Express backend with the Admin SDK).

---

## Perplexity call

`callPerplexity(messages)` in `server.js`:
- Endpoint: `https://api.perplexity.ai/chat/completions`
- Model: **`sonar-pro`** (the one with citations + web search)
- `max_tokens: 4096`
- Auth: `Bearer ${PERPLEXITY_API_KEY}`
- Messages: `system → user` for fresh questions, or full `system → user → assistant → ...` chain for follow-ups

Follow-ups reconstruct the entire prior conversation (original Q, answer, every prior follow-up) so Perplexity has full context. This grows linearly — if a note gets very long, token costs scale with turn count.

---

## Auth flow

Client (`public/app.js`):
1. `firebase.auth().onAuthStateChanged(...)` drives the UI.
2. Sign-in: `signInWithPopup(new GoogleAuthProvider())`. On `auth/popup-blocked`, `auth/popup-closed-by-user`, or `auth/cancelled-popup-request`, falls back to `signInWithRedirect`.
3. Every API call fetches the current `idToken` via `user.getIdToken()` and sends `Authorization: Bearer <token>`.

Server (`server.js > verifyAuth`):
- Rejects missing/malformed headers with 401.
- `admin.auth().verifyIdToken(token)` → `{uid, email, name}` on `req.user`.

---

## Build / deploy

**Local:**
```
npm install
# put firebase-service-account.json in project root
# put PERPLEXITY_API_KEY in .env
npm start
# → http://localhost:3000
```

**Render:**
- `render.yaml` defines a free-tier web service.
- Env vars to set in Render dashboard: `PERPLEXITY_API_KEY`, `FIREBASE_SERVICE_ACCOUNT` (paste the whole JSON as a single string).
- `PORT` is auto-injected by Render; server reads `process.env.PORT || 3000`.

No build step. No bundler. `public/` is served as-is.

---

## Gotchas / things to know

### 1. Shared Firebase project with SolarJournal
Both SolarNotes and SolarJournal use `solarnotes-9c059`. They share Auth (so a signed-in user on one app is also signed in on the other if the authDomain matches), but each writes to its own top-level collection (`notes` here, `journal_entries` in SolarJournal). **If you rotate service account credentials, update both apps.**

### 2. Firebase config is hardcoded in `public/index.html`
The web API key (`AIzaSyCbYeJxGHH1PjiB2bF_t4pZFa7UyFClMuA`) and authDomain (`solarnotes-9c059.firebaseapp.com`) are baked into the HTML. This is fine — web API keys are not secrets for Firebase — but be aware when you see it there.

### 3. Follow-up token cost grows with thread length
Every follow-up re-sends the entire conversation to Perplexity. A note with 20 follow-ups costs ~20x as much as the first question. No truncation logic exists. If this becomes an issue, add a rolling window like CalcReady's 50-message cap.

### 4. Service account loaded from env OR local file
`server.js` tries `FIREBASE_SERVICE_ACCOUNT` env var first, then falls back to `firebase-service-account.json` on disk. Keep the JSON file gitignored and NEVER commit it. On Render only the env var is used.

### 5. System prompt lives in a FILE, not a string
`system_prompt.txt` at project root. The user tunes this over time — don't inline it into `server.js` or you'll lose edit history and make it harder to update without redeploying code.

### 6. Popup-blocker redirect fallback
The client tries `signInWithPopup` first and falls back to `signInWithRedirect` only on specific errors. This is the same pattern Booktracker uses. SolarJournal had extra storage-partitioning problems that required a reverse-proxy fix — SolarNotes has NOT had those issues because it runs on the firebaseapp.com authDomain (or close enough) and hasn't triggered cross-site storage isolation. If you ever see sign-in silently fail on mobile Chrome, check SolarJournal's reverse-proxy fix for the pattern.

### 7. Citations come from Perplexity in the answer text
`sonar-pro` includes inline citation markers like `[1]`, `[2]` and a source list at the end. The frontend renders them as markdown. Don't strip them — they're the whole point of using Perplexity over a vanilla LLM.

### 8. `data/notes.json` is legacy
An older pre-Firestore seed/storage file. Not read or written at runtime. Safe to leave but don't rely on it.

---

## Coding conventions

- Plain Node + Express, no TypeScript, no bundler.
- Frontend is vanilla ES modules attached to `window` / global scope — same style as Booktracker.
- Dark theme, amber accent — matches SolarJournal visual language.
- All server writes go through Firebase Admin with user scoping enforced in middleware. No direct client→Firestore writes.
- Don't add a framework (React, Vue, etc.) unless there's a strong reason. Simplicity is the point.

---

## Pending / future ideas

- Rolling window for long follow-up threads to cap Perplexity token cost
- Firestore security rules checked into the repo
- Maybe shared "highlight → journal" bridge with SolarJournal so an interesting SolarNotes Q can become a SolarJournal highlight

---

**Last updated:** 2026-04-08 (initial creation)
