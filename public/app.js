// Firebase Auth
const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// DOM elements
const authScreen = document.getElementById('auth-screen');
const appContent = document.getElementById('app-content');
const userInfo = document.getElementById('user-info');
const userName = document.getElementById('user-name');
const signOutBtn = document.getElementById('sign-out-btn');
const googleSignInBtn = document.getElementById('google-sign-in-btn');

const form = document.getElementById('ask-form');
const questionInput = document.getElementById('question-input');
const askBtn = document.getElementById('ask-btn');
const btnText = askBtn.querySelector('.btn-text');
const btnLoading = askBtn.querySelector('.btn-loading');
const notesList = document.getElementById('notes-list');
const emptyState = document.getElementById('empty-state');
const noteCount = document.getElementById('note-count');
const searchInput = document.getElementById('search-input');

let notes = [];
let currentUser = null;

// Get Firebase ID token for API calls
async function getAuthHeaders() {
  if (!currentUser) return {};
  const token = await currentUser.getIdToken();
  return { 'Authorization': `Bearer ${token}` };
}

// Auth state listener
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    userName.textContent = user.displayName || user.email;
    userInfo.classList.remove('hidden');
    authScreen.classList.add('hidden');
    appContent.classList.remove('hidden');
    loadNotes();
  } else {
    currentUser = null;
    notes = [];
    userInfo.classList.add('hidden');
    appContent.classList.add('hidden');
    authScreen.classList.remove('hidden');
  }
});

// Sign in with Google
googleSignInBtn.addEventListener('click', async () => {
  try {
    await auth.signInWithPopup(googleProvider);
  } catch (err) {
    // If popup blocked, try redirect
    if (err.code === 'auth/popup-blocked') {
      await auth.signInWithRedirect(googleProvider);
    } else {
      console.error('Sign-in error:', err);
      alert('Sign-in failed: ' + err.message);
    }
  }
});

// Sign out
signOutBtn.addEventListener('click', async () => {
  await auth.signOut();
});

// Simple markdown to HTML
function renderMarkdown(md) {
  let html = md
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Paragraphs: wrap lines that aren't already wrapped in tags
  html = html.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<li') || trimmed.startsWith('<pre') || trimmed.startsWith('<code')) {
      return trimmed;
    }
    return `<p>${trimmed}</p>`;
  }).join('\n');

  return html;
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function renderNotes(filter = '') {
  const filtered = filter
    ? notes.filter(n =>
        n.question.toLowerCase().includes(filter) ||
        n.answer.toLowerCase().includes(filter)
      )
    : notes;

  if (filtered.length === 0) {
    notesList.innerHTML = '';
    emptyState.classList.remove('hidden');
    emptyState.querySelector('p').textContent = filter
      ? 'No notes match your search.'
      : 'No notes yet. Ask your first question above!';
  } else {
    emptyState.classList.add('hidden');
    notesList.innerHTML = filtered.map(note => `
      <div class="note-card" data-id="${note.id}">
        <div class="note-header" onclick="toggleNote('${note.id}')">
          <div class="note-question">${escapeHtml(note.question)}</div>
          <div class="note-meta">
            <span class="note-date">${formatDate(note.createdAt)}</span>
            <button class="delete-btn" onclick="event.stopPropagation(); deleteNote('${note.id}')" title="Delete note">&times;</button>
            <span class="note-toggle">&#9660;</span>
          </div>
        </div>
        <div class="note-answer">
          ${renderMarkdown(note.answer)}
          ${(note.followUps || []).map(fu => `
            <div class="follow-up-thread">
              <div class="follow-up-question"><strong>Follow-up:</strong> ${escapeHtml(fu.question)}</div>
              <div class="follow-up-answer">${renderMarkdown(fu.answer)}</div>
            </div>
          `).join('')}
          <div class="follow-up-section">
            <button class="follow-up-btn" onclick="event.stopPropagation(); showFollowUp('${note.id}')">Ask Follow-up</button>
            <div class="follow-up-form hidden" id="followup-form-${note.id}">
              <textarea class="follow-up-input" id="followup-input-${note.id}" placeholder="Ask a follow-up question..." rows="2"></textarea>
              <div class="follow-up-actions">
                <button class="follow-up-submit" onclick="submitFollowUp('${note.id}')">
                  <span class="fu-btn-text">Send</span>
                  <span class="fu-btn-loading hidden"><span class="spinner"></span> Thinking...</span>
                </button>
                <button class="follow-up-cancel" onclick="hideFollowUp('${note.id}')">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `).join('');
  }

  noteCount.textContent = notes.length > 0 ? `(${notes.length})` : '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

window.toggleNote = function(id) {
  const card = document.querySelector(`.note-card[data-id="${id}"]`);
  if (card) card.classList.toggle('expanded');
};

window.deleteNote = async function(id) {
  if (!confirm('Delete this note?')) return;

  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/notes/${id}`, { method: 'DELETE', headers });
    if (res.ok) {
      notes = notes.filter(n => n.id !== id);
      renderNotes(searchInput.value.toLowerCase().trim());
    }
  } catch (err) {
    console.error('Delete failed:', err);
  }
};

// Follow-up functions
window.showFollowUp = function(id) {
  const form = document.getElementById(`followup-form-${id}`);
  const btn = form?.previousElementSibling;
  if (form) {
    form.classList.remove('hidden');
    if (btn) btn.classList.add('hidden');
    document.getElementById(`followup-input-${id}`)?.focus();
  }
};

window.hideFollowUp = function(id) {
  const form = document.getElementById(`followup-form-${id}`);
  const btn = form?.previousElementSibling;
  if (form) {
    form.classList.add('hidden');
    if (btn) btn.classList.remove('hidden');
  }
};

window.submitFollowUp = async function(id) {
  const input = document.getElementById(`followup-input-${id}`);
  const question = input?.value.trim();
  if (!question) return;

  const form = document.getElementById(`followup-form-${id}`);
  const submitBtn = form.querySelector('.follow-up-submit');
  const btnText = submitBtn.querySelector('.fu-btn-text');
  const btnLoading = submitBtn.querySelector('.fu-btn-loading');

  submitBtn.disabled = true;
  btnText.classList.add('hidden');
  btnLoading.classList.remove('hidden');

  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/notes/${id}/followup`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Follow-up failed');
    }

    const followUp = await res.json();
    const note = notes.find(n => n.id === id);
    if (note) {
      if (!note.followUps) note.followUps = [];
      note.followUps.push(followUp);
    }
    renderNotes(searchInput.value.toLowerCase().trim());

    // Re-expand the note
    setTimeout(() => {
      const card = document.querySelector(`.note-card[data-id="${id}"]`);
      if (card) card.classList.add('expanded');
    }, 50);
  } catch (err) {
    alert(err.message);
  } finally {
    submitBtn.disabled = false;
    btnText.classList.remove('hidden');
    btnLoading.classList.add('hidden');
  }
};

// Load notes on startup
async function loadNotes() {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/notes', { headers });
    if (res.ok) {
      notes = await res.json();
      renderNotes();
    }
  } catch (err) {
    console.error('Failed to load notes:', err);
  }
}

// Submit a question
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = questionInput.value.trim();
  if (!question) return;

  askBtn.disabled = true;
  btnText.classList.add('hidden');
  btnLoading.classList.remove('hidden');

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Request failed');
    }

    const note = await res.json();
    notes.unshift(note);
    questionInput.value = '';
    renderNotes(searchInput.value.toLowerCase().trim());

    // Auto-expand the new note
    setTimeout(() => {
      const card = document.querySelector(`.note-card[data-id="${note.id}"]`);
      if (card) card.classList.add('expanded');
    }, 50);
  } catch (err) {
    alert(err.message);
  } finally {
    askBtn.disabled = false;
    btnText.classList.remove('hidden');
    btnLoading.classList.add('hidden');
  }
});

// Search
searchInput.addEventListener('input', () => {
  renderNotes(searchInput.value.toLowerCase().trim());
});

// Ctrl+Enter to submit
questionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    form.dispatchEvent(new Event('submit'));
  }
});
