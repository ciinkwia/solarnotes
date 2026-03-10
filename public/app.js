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
        <div class="note-answer">${renderMarkdown(note.answer)}</div>
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
    const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    if (res.ok) {
      notes = notes.filter(n => n.id !== id);
      renderNotes(searchInput.value.toLowerCase().trim());
    }
  } catch (err) {
    console.error('Delete failed:', err);
  }
};

// Load notes on startup
async function loadNotes() {
  try {
    const res = await fetch('/api/notes');
    notes = await res.json();
    renderNotes();
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
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

loadNotes();
