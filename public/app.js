/* ═══════════════════════════════════════════════
   Rec Automation — Single-Page App
   ═══════════════════════════════════════════════ */

// ── Constants ──────────────────────────────────

const STAGE_LABELS = {
  1: 'Job Intake',
  2: 'Boolean Generator',
  3: 'Candidate Screener',
  4: 'Outreach Generator',
  5: 'Clarification Message',
  6: 'Candidate Writeup',
  7: 'Interview Prep Email',
};

const BOOLEAN_LABELS = [
  'Title Search 1',
  'Title Search 2',
  'Keyword Search 1',
  'Keyword Search 2',
  'Keyword Search 3',
];

// ── State ──────────────────────────────────────

let state = { roles: {}, currentRoleId: null, currentStage: 1 };
let streamAbort = null; // AbortController for active stream

function createRole(name = 'New Search') {
  const id = 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  return {
    id, name,
    jd: '', // raw JD stored after stage 1 input
    stages: {
      1: { jdInput: '', output: '', refineInput: '' },
      2: { outputs: ['', '', '', '', ''], refineInput: '' },
      3: { batches: [], totalCount: 0, candidateInput: '' },
      4: { output: '', refineInput: '' },
      5: { candidateInput: '', output: '', refineInput: '' },
      6: {
        inputs: { name: '', title: '', company: '', citizenship: '', comp: '', notes: '' },
        output: '', refineInput: '',
      },
      7: {
        inputs: {
          resume: '', jd: '', hmProfile: '', format: '',
          hmPrefs: '', priorIntel: '', aboutPage: '', comp: '', logistics: '',
        },
        output: '', refineInput: '',
      },
    },
  };
}

// ── Persistence ────────────────────────────────

function saveState() {
  try { localStorage.setItem('recAuto_v2', JSON.stringify(state)); } catch (_) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem('recAuto_v2');
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

// ── Helpers ────────────────────────────────────

function h(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getRole() { return state.roles[state.currentRoleId]; }
function getStage(n) { return getRole().stages[n]; }

function abortStream() {
  if (streamAbort) { streamAbort.abort(); streamAbort = null; }
}

function setBtn(id, loading, text) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.orig = btn.textContent;
    btn.textContent = text || 'Generating...';
    btn.classList.add('loading');
  } else {
    btn.textContent = btn.dataset.orig || btn.textContent;
    btn.classList.remove('loading');
  }
}

function copyBtn(btn, text) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }).finally(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
  });
}

// ── API key ────────────────────────────────────

function getApiKey() {
  return localStorage.getItem('recAuto_apiKey') || '';
}

function initApiKey() {
  const input = document.getElementById('apiKeyInput');
  const saveBtn = document.getElementById('apiKeySave');
  const status = document.getElementById('apiKeyStatus');

  const saved = getApiKey();
  if (input) {
    input.value = saved;
    if (saved) { status.textContent = 'Key saved'; status.className = 'api-key-status ok'; }
  }

  saveBtn?.addEventListener('click', () => saveApiKey());
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveApiKey(); });
}

function saveApiKey() {
  const input = document.getElementById('apiKeyInput');
  const status = document.getElementById('apiKeyStatus');
  const key = input?.value?.trim();
  if (!key) {
    status.textContent = 'Enter a key first';
    status.className = 'api-key-status err';
    return;
  }
  localStorage.setItem('recAuto_apiKey', key);
  status.textContent = 'Key saved';
  status.className = 'api-key-status ok';
}

// ── Streaming ──────────────────────────────────

async function streamText(prompt, onChunk, onDone, onError) {
  abortStream();
  streamAbort = new AbortController();
  const { signal } = streamAbort;

  const apiKey = getApiKey();

  let accumulated = '';
  try {
    const resp = await fetch('/api/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
      },
      body: JSON.stringify({ prompt, apiKey }),
      signal,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Request failed' }));
      onError?.(err.error || 'Request failed');
      return '';
    }

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { onDone?.(accumulated); return accumulated; }
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            const msg = parsed.error === 'NO_KEY'
              ? 'No API key set. Enter your Anthropic API key in the sidebar.'
              : parsed.error;
            onError?.(msg); return accumulated;
          }
          if (parsed.text) {
            accumulated += parsed.text;
            onChunk?.(parsed.text, accumulated);
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') onError?.(err.message);
  }
  onDone?.(accumulated);
  return accumulated;
}

// ── File upload ────────────────────────────────

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const resp = await fetch('/api/upload', { method: 'POST', body: fd });
  const json = await resp.json();
  if (!resp.ok || json.error) throw new Error(json.error || 'Upload failed');
  return json.text;
}

// ── Sidebar ────────────────────────────────────

function renderSidebar() {
  const list = document.getElementById('rolesList');
  list.innerHTML = '';
  Object.values(state.roles).forEach(role => {
    const li = document.createElement('li');
    li.className = 'role-item' + (role.id === state.currentRoleId ? ' active' : '');
    li.dataset.roleId = role.id;
    li.innerHTML = `
      <div class="role-dot"></div>
      <span class="role-name" title="${h(role.name)}">${h(role.name)}</span>
      <button class="role-delete" data-del="${h(role.id)}" title="Delete">×</button>
    `;
    // Click role name to rename (only if active)
    li.querySelector('.role-name').addEventListener('click', (e) => {
      if (role.id !== state.currentRoleId) {
        switchRole(role.id);
      } else {
        startRenaming(li, role);
      }
      e.stopPropagation();
    });
    li.querySelector('.role-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteRole(role.id);
    });
    li.addEventListener('click', () => {
      if (role.id !== state.currentRoleId) switchRole(role.id);
    });
    list.appendChild(li);
  });
}

function startRenaming(li, role) {
  const nameSpan = li.querySelector('.role-name');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'role-name-input';
  input.value = role.name;
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const newName = input.value.trim() || role.name;
    state.roles[role.id].name = newName;
    saveState();
    renderSidebar();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = role.name; input.blur(); }
  });
}

function switchRole(id) {
  abortStream();
  state.currentRoleId = id;
  saveState();
  renderSidebar();
  renderCurrentStage();
}

function addRole() {
  const role = createRole('New Search');
  state.roles[role.id] = role;
  state.currentRoleId = role.id;
  state.currentStage = 1;
  saveState();
  renderSidebar();
  renderStageNav();
  renderCurrentStage();
  // Auto-start renaming the new role
  const li = document.querySelector(`.role-item[data-role-id="${role.id}"]`);
  if (li) startRenaming(li, role);
}

function deleteRole(id) {
  const role = state.roles[id];
  if (!role) return;
  if (!confirm(`Delete "${role.name}" and all its data?`)) return;
  delete state.roles[id];

  const remaining = Object.keys(state.roles);
  if (remaining.length === 0) {
    const fresh = createRole('First Search');
    state.roles[fresh.id] = fresh;
    state.currentRoleId = fresh.id;
  } else if (state.currentRoleId === id) {
    state.currentRoleId = remaining[0];
  }
  saveState();
  renderSidebar();
  renderCurrentStage();
}

// ── Stage nav ──────────────────────────────────

function renderStageNav() {
  document.querySelectorAll('.stage-tab').forEach(tab => {
    const n = parseInt(tab.dataset.stage, 10);
    tab.classList.toggle('active', n === state.currentStage);
  });
}

function switchStage(n) {
  abortStream();
  state.currentStage = n;
  saveState();
  renderStageNav();
  renderCurrentStage();
}

// ── Stage render dispatcher ────────────────────

function renderCurrentStage() {
  const el = document.getElementById('stageContent');
  const renderers = { 1: s1html, 2: s2html, 3: s3html, 4: s4html, 5: s5html, 6: s6html, 7: s7html };
  el.innerHTML = (renderers[state.currentStage] || (() => ''))();
  const listeners = { 1: s1listen, 2: s2listen, 3: s3listen, 4: s4listen, 5: s5listen, 6: s6listen, 7: s7listen };
  (listeners[state.currentStage] || (() => {}))();
}

// ─────────────────────────────────────────────────────────
// STAGE 1 — Job Intake
// ─────────────────────────────────────────────────────────

function s1html() {
  const s = getStage(1);
  const hasOut = !!s.output;
  return `
    <div class="stage-wrapper">
      <div class="stage-header">
        <h2>Job Intake</h2>
        <p class="stage-desc">Paste or upload a job description and/or brief notes. Claude will auto-populate the confirmation email template.</p>
      </div>

      <div class="field-group">
        <div class="label-row">
          <label for="s1-jd">Job Description / Brief Notes</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn-upload" id="s1-upload-btn">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload PDF or Word
            </button>
            <input type="file" id="s1-file" accept=".pdf,.doc,.docx" hidden />
          </div>
        </div>
        <textarea id="s1-jd" rows="10" placeholder="Paste the job description or brief notes here...">${h(s.jdInput)}</textarea>
      </div>

      <div class="action-row">
        <button class="btn-primary" id="s1-gen">Generate Confirmation Email</button>
      </div>

      ${hasOut ? `
        <div class="output-section">
          <div class="output-header">
            <label>Confirmation Email</label>
            <button class="btn-copy" id="s1-copy">Copy</button>
          </div>
          <textarea id="s1-out" class="output-area" rows="22">${h(s.output)}</textarea>
        </div>
        <div class="refinement-section">
          <span class="refinement-label">Refinement</span>
          <div class="refinement-row">
            <textarea id="s1-refine" rows="3" placeholder="Describe what's off and hit Refine (or Cmd+Enter)...">${h(s.refineInput)}</textarea>
            <button class="btn-secondary" id="s1-refine-btn">Refine</button>
          </div>
          <p class="refinement-hint">Cmd+Enter to refine</p>
        </div>
      ` : ''}
    </div>`;
}

function s1listen() {
  const s = getStage(1);

  // JD input autosave
  const jdEl = document.getElementById('s1-jd');
  if (jdEl) jdEl.addEventListener('input', () => {
    s.jdInput = jdEl.value;
    getRole().jd = jdEl.value;
    saveState();
  });

  // File upload
  const fileInput = document.getElementById('s1-file');
  const uploadBtn = document.getElementById('s1-upload-btn');
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      uploadBtn.textContent = 'Parsing...';
      uploadBtn.disabled = true;
      try {
        const text = await uploadFile(file);
        jdEl.value = text;
        s.jdInput = text;
        getRole().jd = text;
        saveState();
      } catch (err) {
        alert('File parse error: ' + err.message);
      } finally {
        uploadBtn.textContent = 'Upload PDF or Word';
        uploadBtn.disabled = false;
        fileInput.value = '';
      }
    });
  }

  // Generate
  const genBtn = document.getElementById('s1-gen');
  if (genBtn) genBtn.addEventListener('click', () => doS1Generate());

  // Output autosave
  const outEl = document.getElementById('s1-out');
  if (outEl) outEl.addEventListener('input', () => { s.output = outEl.value; saveState(); });

  // Copy
  const copyEl = document.getElementById('s1-copy');
  if (copyEl) copyEl.addEventListener('click', () => {
    copyBtn(copyEl, document.getElementById('s1-out')?.value || '');
  });

  // Refine
  const refineEl = document.getElementById('s1-refine');
  const refineBtnEl = document.getElementById('s1-refine-btn');
  if (refineEl) {
    refineEl.addEventListener('input', () => { s.refineInput = refineEl.value; saveState(); });
    refineEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doS1Refine(); }
    });
  }
  if (refineBtnEl) refineBtnEl.addEventListener('click', () => doS1Refine());
}

async function doS1Generate() {
  const s = getStage(1);
  const jd = s.jdInput.trim();
  if (!jd) { alert('Please paste or upload a job description first.'); return; }

  setBtn('s1-gen', true);
  const prompt = promptS1(jd);
  let result = '';

  await streamText(
    prompt,
    (_, acc) => {
      result = acc;
      // Re-render output section if not yet visible
      if (!document.getElementById('s1-out')) {
        s.output = acc;
        renderCurrentStage();
      } else {
        document.getElementById('s1-out').value = acc;
      }
    },
    (acc) => {
      s.output = acc;
      s.refineInput = '';
      saveState();
      if (!document.getElementById('s1-out')) renderCurrentStage();
      setBtn('s1-gen', false);
    },
    (err) => {
      alert('Error: ' + err);
      setBtn('s1-gen', false);
    }
  );
}

async function doS1Refine() {
  const s = getStage(1);
  const feedback = document.getElementById('s1-refine')?.value?.trim();
  if (!feedback) return;
  if (!s.output) return;

  setBtn('s1-refine-btn', true, 'Refining...');
  const prompt = promptRefine('confirmation email', s.output, feedback, getRole().jd);

  await streamText(
    prompt,
    (_, acc) => { const el = document.getElementById('s1-out'); if (el) el.value = acc; },
    (acc) => {
      s.output = acc;
      document.getElementById('s1-refine').value = '';
      s.refineInput = '';
      saveState();
      setBtn('s1-refine-btn', false);
    },
    (err) => { alert('Error: ' + err); setBtn('s1-refine-btn', false); }
  );
}

// ─────────────────────────────────────────────────────────
// STAGE 2 — Boolean Generator
// ─────────────────────────────────────────────────────────

function s2html() {
  const s = getStage(2);
  const hasOut = s.outputs.some(o => !!o);
  return `
    <div class="stage-wrapper">
      <div class="stage-header">
        <h2>Boolean Generator</h2>
        <p class="stage-desc">Generates 5 LinkedIn Recruiter Boolean strings from the stored job description. No inputs needed.</p>
      </div>

      <div class="action-row">
        <button class="btn-primary" id="s2-gen">Generate Boolean Strings</button>
        ${!getRole().jd ? '<span style="font-size:12.5px;color:#d97706;">⚠ No JD stored — complete Stage 1 first.</span>' : ''}
      </div>

      ${hasOut ? `
        <div class="boolean-outputs" id="s2-outputs">
          ${BOOLEAN_LABELS.map((label, i) => `
            <div class="boolean-item">
              <div class="boolean-item-header">
                <span class="boolean-item-label">${h(label)}</span>
                <button class="btn-copy" id="s2-copy-${i}">Copy</button>
              </div>
              <textarea id="s2-out-${i}" rows="3">${h(s.outputs[i] || '')}</textarea>
            </div>
          `).join('')}
        </div>

        <div class="refinement-section">
          <span class="refinement-label">Refinement — rewrites all 5 strings</span>
          <div class="refinement-row">
            <textarea id="s2-refine" rows="3" placeholder="Describe what needs adjusting across all strings (Cmd+Enter to refine)...">${h(s.refineInput)}</textarea>
            <button class="btn-secondary" id="s2-refine-btn">Refine All</button>
          </div>
          <p class="refinement-hint">Cmd+Enter to refine</p>
        </div>
      ` : ''}
    </div>`;
}

function s2listen() {
  const s = getStage(2);

  document.getElementById('s2-gen')?.addEventListener('click', () => doS2Generate());

  // Output autosave for each string
  BOOLEAN_LABELS.forEach((_, i) => {
    const el = document.getElementById(`s2-out-${i}`);
    if (el) el.addEventListener('input', () => { s.outputs[i] = el.value; saveState(); });

    const copyEl = document.getElementById(`s2-copy-${i}`);
    if (copyEl) copyEl.addEventListener('click', () => {
      copyBtn(copyEl, document.getElementById(`s2-out-${i}`)?.value || '');
    });
  });

  const refineEl = document.getElementById('s2-refine');
  const refineBtnEl = document.getElementById('s2-refine-btn');
  if (refineEl) {
    refineEl.addEventListener('input', () => { s.refineInput = refineEl.value; saveState(); });
    refineEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doS2Refine(); }
    });
  }
  if (refineBtnEl) refineBtnEl.addEventListener('click', () => doS2Refine());
}

function parseBooleans(text) {
  const results = ['', '', '', '', ''];
  const labels = BOOLEAN_LABELS;
  for (let i = 0; i < labels.length; i++) {
    const marker = labels[i] + ':';
    const start = text.indexOf(marker);
    if (start === -1) continue;
    let end = text.length;
    for (let j = i + 1; j < labels.length; j++) {
      const next = text.indexOf(labels[j] + ':', start + marker.length);
      if (next !== -1 && next < end) end = next;
    }
    results[i] = text.slice(start + marker.length, end).trim();
  }
  return results;
}

async function doS2Generate() {
  const jd = getRole().jd;
  if (!jd) { alert('No JD stored. Complete Stage 1 first.'); return; }

  setBtn('s2-gen', true);
  const s = getStage(2);
  let accumulated = '';

  await streamText(
    promptS2(jd),
    (_, acc) => { accumulated = acc; },
    (acc) => {
      s.outputs = parseBooleans(acc);
      s.refineInput = '';
      saveState();
      renderCurrentStage();
      setBtn('s2-gen', false);
    },
    (err) => { alert('Error: ' + err); setBtn('s2-gen', false); }
  );
}

async function doS2Refine() {
  const s = getStage(2);
  const feedback = document.getElementById('s2-refine')?.value?.trim();
  if (!feedback) return;

  setBtn('s2-refine-btn', true, 'Refining...');
  let accumulated = '';

  await streamText(
    promptS2Refine(getRole().jd, s.outputs, feedback),
    (_, acc) => { accumulated = acc; },
    (acc) => {
      s.outputs = parseBooleans(acc);
      document.getElementById('s2-refine').value = '';
      s.refineInput = '';
      saveState();
      renderCurrentStage();
      setBtn('s2-refine-btn', false);
    },
    (err) => { alert('Error: ' + err); setBtn('s2-refine-btn', false); }
  );
}

// ─────────────────────────────────────────────────────────
// STAGE 3 — Candidate Screener
// ─────────────────────────────────────────────────────────

function s3html() {
  const s = getStage(3);
  const batchesHtml = s.batches.map((batch, bi) => `
    <div class="batch-block">
      <div class="batch-label">${h(batch.label)} &mdash; ${batch.candidates.length} candidate${batch.candidates.length !== 1 ? 's' : ''}</div>
      ${batch.candidates.map((c, ci) => `
        <div class="candidate-row">
          <span class="rating-badge badge-${c.rating.toLowerCase()}">${h(c.rating)}</span>
          <span class="candidate-name">${h(c.name)}</span>
          <span class="candidate-reason">${h(c.reason)}</span>
        </div>
      `).join('')}
    </div>
  `).join('');

  return `
    <div class="stage-wrapper">
      <div class="stage-header">
        <h2>Candidate Screener</h2>
        <p class="stage-desc">Paste raw LinkedIn results (up to 25 profiles per batch). Results accumulate across batches.</p>
      </div>

      <div class="screener-topbar">
        <span class="screener-counter">Total screened: <span id="s3-count">${s.totalCount}</span></span>
        <button class="btn-danger" id="s3-clear">Clear all batches</button>
      </div>

      ${s.batches.length > 0 ? `<div class="screener-results" id="s3-results">${batchesHtml}</div>` : ''}

      <div class="screener-input-section">
        <div class="field-group">
          <label for="s3-input">Paste LinkedIn profiles</label>
          <textarea id="s3-input" rows="12" placeholder="Paste raw LinkedIn search results here (up to 25 profiles per batch)...">${h(s.candidateInput)}</textarea>
        </div>
        <div class="action-row">
          <button class="btn-primary" id="s3-screen">
            Screen Candidates
          </button>
          ${!getRole().jd ? '<span style="font-size:12.5px;color:#d97706;">⚠ No JD stored — complete Stage 1 first.</span>' : ''}
        </div>
        <div id="s3-streaming" style="display:none;font-size:12.5px;color:var(--text-2);margin-top:-8px;margin-bottom:12px;">Screening candidates...</div>
      </div>
    </div>`;
}

function s3listen() {
  const s = getStage(3);

  document.getElementById('s3-input')?.addEventListener('input', (e) => {
    s.candidateInput = e.target.value; saveState();
  });

  document.getElementById('s3-clear')?.addEventListener('click', () => {
    if (!confirm('Clear all batches?')) return;
    s.batches = []; s.totalCount = 0; s.candidateInput = '';
    saveState(); renderCurrentStage();
  });

  document.getElementById('s3-screen')?.addEventListener('click', () => doS3Screen());
}

function parseScreenerOutput(text) {
  const candidates = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^(.+?)\s*::\s*(YES|MAYBE|NO)\s*::\s*(.+)$/i);
    if (m) {
      candidates.push({ name: m[1].trim(), rating: m[2].toUpperCase(), reason: m[3].trim() });
    }
  }
  return candidates;
}

async function doS3Screen() {
  const s = getStage(3);
  const input = s.candidateInput.trim();
  if (!input) { alert('Please paste candidate profiles first.'); return; }
  const jd = getRole().jd;
  if (!jd) { alert('No JD stored. Complete Stage 1 first.'); return; }

  setBtn('s3-screen', true);
  const streamEl = document.getElementById('s3-streaming');
  if (streamEl) streamEl.style.display = 'block';

  let accumulated = '';
  await streamText(
    promptS3(jd, input),
    (_, acc) => { accumulated = acc; },
    (acc) => {
      const candidates = parseScreenerOutput(acc);
      if (candidates.length > 0) {
        const batchNum = s.batches.length + 1;
        s.batches.push({
          id: batchNum,
          label: `Batch ${batchNum}`,
          candidates,
        });
        s.totalCount += candidates.length;
        s.candidateInput = '';
        saveState();
      } else {
        alert('Could not parse any candidates from the output. Try again or check the format of your paste.');
      }
      if (streamEl) streamEl.style.display = 'none';
      setBtn('s3-screen', false);
      renderCurrentStage();
    },
    (err) => {
      alert('Error: ' + err);
      if (streamEl) streamEl.style.display = 'none';
      setBtn('s3-screen', false);
    }
  );
}

// ─────────────────────────────────────────────────────────
// STAGE 4 — Outreach Generator
// ─────────────────────────────────────────────────────────

function s4html() {
  const s = getStage(4);
  const hasOut = !!s.output;
  return `
    <div class="stage-wrapper">
      <div class="stage-header">
        <h2>Outreach Generator</h2>
        <p class="stage-desc">Generates a cold outreach message from the stored JD. No inputs needed.</p>
      </div>

      <div class="action-row">
        <button class="btn-primary" id="s4-gen">Generate Outreach</button>
        ${!getRole().jd ? '<span style="font-size:12.5px;color:#d97706;">⚠ No JD stored — complete Stage 1 first.</span>' : ''}
      </div>

      ${hasOut ? `
        <div class="output-section">
          <div class="output-header">
            <label>Outreach Message</label>
            <button class="btn-copy" id="s4-copy">Copy</button>
          </div>
          <textarea id="s4-out" class="output-area" rows="20">${h(s.output)}</textarea>
        </div>
        <div class="refinement-section">
          <span class="refinement-label">Refinement</span>
          <div class="refinement-row">
            <textarea id="s4-refine" rows="3" placeholder="Describe what's off (Cmd+Enter to refine)...">${h(s.refineInput)}</textarea>
            <button class="btn-secondary" id="s4-refine-btn">Refine</button>
          </div>
          <p class="refinement-hint">Cmd+Enter to refine</p>
        </div>
      ` : ''}
    </div>`;
}

function s4listen() {
  const s = getStage(4);
  document.getElementById('s4-gen')?.addEventListener('click', () => doS4Generate());

  const outEl = document.getElementById('s4-out');
  if (outEl) outEl.addEventListener('input', () => { s.output = outEl.value; saveState(); });

  document.getElementById('s4-copy')?.addEventListener('click', (e) => {
    copyBtn(e.currentTarget, document.getElementById('s4-out')?.value || '');
  });

  const refineEl = document.getElementById('s4-refine');
  const refineBtnEl = document.getElementById('s4-refine-btn');
  if (refineEl) {
    refineEl.addEventListener('input', () => { s.refineInput = refineEl.value; saveState(); });
    refineEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doS4Refine(); }
    });
  }
  if (refineBtnEl) refineBtnEl.addEventListener('click', () => doS4Refine());
}

async function doS4Generate() {
  const jd = getRole().jd;
  if (!jd) { alert('No JD stored. Complete Stage 1 first.'); return; }
  setBtn('s4-gen', true);
  const s = getStage(4);

  await streamText(
    promptS4(jd),
    (_, acc) => {
      if (!document.getElementById('s4-out')) { s.output = acc; renderCurrentStage(); }
      else document.getElementById('s4-out').value = acc;
    },
    (acc) => {
      s.output = acc; s.refineInput = '';
      saveState();
      if (!document.getElementById('s4-out')) renderCurrentStage();
      setBtn('s4-gen', false);
    },
    (err) => { alert('Error: ' + err); setBtn('s4-gen', false); }
  );
}

async function doS4Refine() {
  const s = getStage(4);
  const feedback = document.getElementById('s4-refine')?.value?.trim();
  if (!feedback || !s.output) return;
  setBtn('s4-refine-btn', true, 'Refining...');

  await streamText(
    promptRefine('outreach message', s.output, feedback, getRole().jd),
    (_, acc) => { const el = document.getElementById('s4-out'); if (el) el.value = acc; },
    (acc) => {
      s.output = acc;
      document.getElementById('s4-refine').value = ''; s.refineInput = '';
      saveState(); setBtn('s4-refine-btn', false);
    },
    (err) => { alert('Error: ' + err); setBtn('s4-refine-btn', false); }
  );
}

// ─────────────────────────────────────────────────────────
// STAGE 5 — Clarification Message
// ─────────────────────────────────────────────────────────

function s5html() {
  const s = getStage(5);
  const hasOut = !!s.output;
  return `
    <div class="stage-wrapper">
      <div class="stage-header">
        <h2>Clarification Message</h2>
        <p class="stage-desc">For MAYBE candidates. Paste their LinkedIn profile or background. Claude identifies what was relevant, names the gap precisely, and writes a pre-call message.</p>
      </div>

      <div class="field-group">
        <label for="s5-input">Candidate Profile / Background</label>
        <textarea id="s5-input" rows="10" placeholder="Paste the candidate's LinkedIn profile or background info...">${h(s.candidateInput)}</textarea>
      </div>

      <div class="action-row">
        <button class="btn-primary" id="s5-gen">Generate Clarification Message</button>
        ${!getRole().jd ? '<span style="font-size:12.5px;color:#d97706;">⚠ No JD stored — complete Stage 1 first.</span>' : ''}
      </div>

      ${hasOut ? `
        <div class="output-section">
          <div class="output-header">
            <label>Pre-Call Message</label>
            <button class="btn-copy" id="s5-copy">Copy</button>
          </div>
          <textarea id="s5-out" class="output-area" rows="12">${h(s.output)}</textarea>
        </div>
        <div class="refinement-section">
          <span class="refinement-label">Refinement</span>
          <div class="refinement-row">
            <textarea id="s5-refine" rows="3" placeholder="Describe what's off (Cmd+Enter to refine)...">${h(s.refineInput)}</textarea>
            <button class="btn-secondary" id="s5-refine-btn">Refine</button>
          </div>
          <p class="refinement-hint">Cmd+Enter to refine</p>
        </div>
      ` : ''}
    </div>`;
}

function s5listen() {
  const s = getStage(5);

  document.getElementById('s5-input')?.addEventListener('input', (e) => { s.candidateInput = e.target.value; saveState(); });
  document.getElementById('s5-gen')?.addEventListener('click', () => doS5Generate());

  const outEl = document.getElementById('s5-out');
  if (outEl) outEl.addEventListener('input', () => { s.output = outEl.value; saveState(); });

  document.getElementById('s5-copy')?.addEventListener('click', (e) => {
    copyBtn(e.currentTarget, document.getElementById('s5-out')?.value || '');
  });

  const refineEl = document.getElementById('s5-refine');
  const refineBtnEl = document.getElementById('s5-refine-btn');
  if (refineEl) {
    refineEl.addEventListener('input', () => { s.refineInput = refineEl.value; saveState(); });
    refineEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doS5Refine(); }
    });
  }
  if (refineBtnEl) refineBtnEl.addEventListener('click', () => doS5Refine());
}

async function doS5Generate() {
  const s = getStage(5);
  const profile = s.candidateInput.trim();
  if (!profile) { alert('Please paste the candidate profile first.'); return; }
  const jd = getRole().jd;
  if (!jd) { alert('No JD stored. Complete Stage 1 first.'); return; }

  setBtn('s5-gen', true);
  await streamText(
    promptS5(jd, profile),
    (_, acc) => {
      if (!document.getElementById('s5-out')) { s.output = acc; renderCurrentStage(); }
      else document.getElementById('s5-out').value = acc;
    },
    (acc) => {
      s.output = acc; s.refineInput = '';
      saveState();
      if (!document.getElementById('s5-out')) renderCurrentStage();
      setBtn('s5-gen', false);
    },
    (err) => { alert('Error: ' + err); setBtn('s5-gen', false); }
  );
}

async function doS5Refine() {
  const s = getStage(5);
  const feedback = document.getElementById('s5-refine')?.value?.trim();
  if (!feedback || !s.output) return;
  setBtn('s5-refine-btn', true, 'Refining...');

  await streamText(
    promptRefine('clarification message', s.output, feedback, getRole().jd),
    (_, acc) => { const el = document.getElementById('s5-out'); if (el) el.value = acc; },
    (acc) => {
      s.output = acc;
      document.getElementById('s5-refine').value = ''; s.refineInput = '';
      saveState(); setBtn('s5-refine-btn', false);
    },
    (err) => { alert('Error: ' + err); setBtn('s5-refine-btn', false); }
  );
}

// ─────────────────────────────────────────────────────────
// STAGE 6 — Candidate Writeup
// ─────────────────────────────────────────────────────────

function s6html() {
  const s = getStage(6);
  const inp = s.inputs;
  const hasOut = !!s.output;
  return `
    <div class="stage-wrapper">
      <div class="stage-header">
        <h2>Candidate Writeup</h2>
        <p class="stage-desc">Fill in the candidate details. Claude generates a structured 6-bullet writeup mapping their background to the role.</p>
      </div>

      <div class="input-grid">
        <div class="field-group">
          <label for="s6-name">Full Name</label>
          <input type="text" id="s6-name" placeholder="Jane Smith" value="${h(inp.name)}" />
        </div>
        <div class="field-group">
          <label for="s6-title">Current Title</label>
          <input type="text" id="s6-title" placeholder="Senior Product Manager" value="${h(inp.title)}" />
        </div>
        <div class="field-group">
          <label for="s6-company">Current Company</label>
          <input type="text" id="s6-company" placeholder="Acme Corp" value="${h(inp.company)}" />
        </div>
        <div class="field-group">
          <label for="s6-citizenship">Citizenship Status</label>
          <input type="text" id="s6-citizenship" placeholder="US Citizen / GC / H-1B..." value="${h(inp.citizenship)}" />
        </div>
        <div class="field-group field-full">
          <label for="s6-comp">Compensation Expectation</label>
          <input type="text" id="s6-comp" placeholder="$180k base + equity" value="${h(inp.comp)}" />
        </div>
        <div class="field-group field-full">
          <label for="s6-notes">Raw Call Notes</label>
          <textarea id="s6-notes" rows="8" placeholder="Paste your raw notes from the screening call...">${h(inp.notes)}</textarea>
        </div>
      </div>

      <div class="action-row">
        <button class="btn-primary" id="s6-gen">Generate Writeup</button>
        ${!getRole().jd ? '<span style="font-size:12.5px;color:#d97706;">⚠ No JD stored — complete Stage 1 first.</span>' : ''}
      </div>

      ${hasOut ? `
        <div class="output-section">
          <div class="output-header">
            <label>Candidate Writeup</label>
            <button class="btn-copy" id="s6-copy">Copy</button>
          </div>
          <textarea id="s6-out" class="output-area" rows="16">${h(s.output)}</textarea>
        </div>
        <div class="refinement-section">
          <span class="refinement-label">Refinement</span>
          <div class="refinement-row">
            <textarea id="s6-refine" rows="3" placeholder="Describe what's off (Cmd+Enter to refine)...">${h(s.refineInput)}</textarea>
            <button class="btn-secondary" id="s6-refine-btn">Refine</button>
          </div>
          <p class="refinement-hint">Cmd+Enter to refine</p>
        </div>
      ` : ''}
    </div>`;
}

function s6listen() {
  const s = getStage(6);
  const fields = ['name', 'title', 'company', 'citizenship', 'comp', 'notes'];
  fields.forEach(f => {
    document.getElementById(`s6-${f}`)?.addEventListener('input', (e) => {
      s.inputs[f] = e.target.value; saveState();
    });
  });

  document.getElementById('s6-gen')?.addEventListener('click', () => doS6Generate());

  const outEl = document.getElementById('s6-out');
  if (outEl) outEl.addEventListener('input', () => { s.output = outEl.value; saveState(); });

  document.getElementById('s6-copy')?.addEventListener('click', (e) => {
    copyBtn(e.currentTarget, document.getElementById('s6-out')?.value || '');
  });

  const refineEl = document.getElementById('s6-refine');
  const refineBtnEl = document.getElementById('s6-refine-btn');
  if (refineEl) {
    refineEl.addEventListener('input', () => { s.refineInput = refineEl.value; saveState(); });
    refineEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doS6Refine(); }
    });
  }
  if (refineBtnEl) refineBtnEl.addEventListener('click', () => doS6Refine());
}

async function doS6Generate() {
  const s = getStage(6);
  const jd = getRole().jd;
  if (!jd) { alert('No JD stored. Complete Stage 1 first.'); return; }
  if (!s.inputs.name && !s.inputs.notes) { alert('Please fill in at least the candidate name and call notes.'); return; }

  setBtn('s6-gen', true);
  await streamText(
    promptS6(jd, s.inputs),
    (_, acc) => {
      if (!document.getElementById('s6-out')) { s.output = acc; renderCurrentStage(); }
      else document.getElementById('s6-out').value = acc;
    },
    (acc) => {
      s.output = acc; s.refineInput = '';
      saveState();
      if (!document.getElementById('s6-out')) renderCurrentStage();
      setBtn('s6-gen', false);
    },
    (err) => { alert('Error: ' + err); setBtn('s6-gen', false); }
  );
}

async function doS6Refine() {
  const s = getStage(6);
  const feedback = document.getElementById('s6-refine')?.value?.trim();
  if (!feedback || !s.output) return;
  setBtn('s6-refine-btn', true, 'Refining...');

  await streamText(
    promptRefine('candidate writeup', s.output, feedback, getRole().jd),
    (_, acc) => { const el = document.getElementById('s6-out'); if (el) el.value = acc; },
    (acc) => {
      s.output = acc;
      document.getElementById('s6-refine').value = ''; s.refineInput = '';
      saveState(); setBtn('s6-refine-btn', false);
    },
    (err) => { alert('Error: ' + err); setBtn('s6-refine-btn', false); }
  );
}

// ─────────────────────────────────────────────────────────
// STAGE 7 — Interview Prep Email
// ─────────────────────────────────────────────────────────

function s7html() {
  const s = getStage(7);
  const inp = s.inputs;
  // Auto-populate JD from role if empty
  if (!inp.jd && getRole().jd) { inp.jd = getRole().jd; saveState(); }
  const hasOut = !!s.output;
  return `
    <div class="stage-wrapper">
      <div class="stage-header">
        <h2>Interview Prep Email</h2>
        <p class="stage-desc">Generates a long-form, structured prep email covering the company, interviewer, likely questions, how to pitch experience, candidate questions, and logistics.</p>
      </div>

      <div class="field-group">
        <label for="s7-resume">Candidate Resume <span class="optional-label">(paste text)</span></label>
        <textarea id="s7-resume" rows="8" placeholder="Paste candidate's resume text...">${h(inp.resume)}</textarea>
      </div>

      <div class="field-group">
        <label for="s7-jd">Job Description <span class="optional-label">(auto-populated from Stage 1)</span></label>
        <textarea id="s7-jd" rows="6" placeholder="JD auto-populates from Stage 1, or paste here...">${h(inp.jd)}</textarea>
      </div>

      <div class="field-group">
        <label for="s7-hm">Hiring Manager LinkedIn Profile <span class="optional-label">(paste text)</span></label>
        <textarea id="s7-hm" rows="6" placeholder="Paste the interviewer's LinkedIn profile text...">${h(inp.hmProfile)}</textarea>
      </div>

      <div class="input-grid">
        <div class="field-group">
          <label for="s7-format">Interview Format</label>
          <input type="text" id="s7-format" placeholder="e.g. 45 min video, case study + competency" value="${h(inp.format)}" />
        </div>
        <div class="field-group">
          <label for="s7-comp">Candidate's Locked Comp Expectation</label>
          <input type="text" id="s7-comp" placeholder="e.g. $185k base, no flex" value="${h(inp.comp)}" />
        </div>
      </div>

      <div class="field-group">
        <label for="s7-hmprefs">HM Preferences / Feedback from Rejected Candidates <span class="optional-label">(optional)</span></label>
        <textarea id="s7-hmprefs" rows="4" placeholder="Any patterns in what this HM likes or has rejected past candidates for...">${h(inp.hmPrefs)}</textarea>
      </div>

      <div class="field-group">
        <label for="s7-intel">Intel from Prior Rounds <span class="optional-label">(optional)</span></label>
        <textarea id="s7-intel" rows="4" placeholder="What happened in earlier rounds? Any specific feedback or signals?">${h(inp.priorIntel)}</textarea>
      </div>

      <div class="field-group">
        <label for="s7-about">Company About Page <span class="optional-label">(optional)</span></label>
        <textarea id="s7-about" rows="4" placeholder="Paste company about page or description...">${h(inp.aboutPage)}</textarea>
      </div>

      <div class="field-group">
        <label for="s7-logistics">Logistics to Reinforce</label>
        <textarea id="s7-logistics" rows="4" placeholder="On-site days, start date, visa requirements, anything flagged as slippery...">${h(inp.logistics)}</textarea>
      </div>

      <div class="action-row">
        <button class="btn-primary" id="s7-gen">Generate Prep Email</button>
      </div>

      ${hasOut ? `
        <div class="output-section">
          <div class="output-header">
            <label>Interview Prep Email</label>
            <button class="btn-copy" id="s7-copy">Copy</button>
          </div>
          <textarea id="s7-out" class="output-area" rows="40">${h(s.output)}</textarea>
        </div>
        <div class="refinement-section">
          <span class="refinement-label">Refinement</span>
          <div class="refinement-row">
            <textarea id="s7-refine" rows="3" placeholder="Describe what's off (Cmd+Enter to refine)...">${h(s.refineInput)}</textarea>
            <button class="btn-secondary" id="s7-refine-btn">Refine</button>
          </div>
          <p class="refinement-hint">Cmd+Enter to refine</p>
        </div>
      ` : ''}
    </div>`;
}

function s7listen() {
  const s = getStage(7);
  const textFields = [
    ['s7-resume', 'resume'], ['s7-jd', 'jd'], ['s7-hm', 'hmProfile'],
    ['s7-format', 'format'], ['s7-comp', 'comp'], ['s7-hmprefs', 'hmPrefs'],
    ['s7-intel', 'priorIntel'], ['s7-about', 'aboutPage'], ['s7-logistics', 'logistics'],
  ];
  textFields.forEach(([id, key]) => {
    document.getElementById(id)?.addEventListener('input', (e) => { s.inputs[key] = e.target.value; saveState(); });
  });

  document.getElementById('s7-gen')?.addEventListener('click', () => doS7Generate());

  const outEl = document.getElementById('s7-out');
  if (outEl) outEl.addEventListener('input', () => { s.output = outEl.value; saveState(); });

  document.getElementById('s7-copy')?.addEventListener('click', (e) => {
    copyBtn(e.currentTarget, document.getElementById('s7-out')?.value || '');
  });

  const refineEl = document.getElementById('s7-refine');
  const refineBtnEl = document.getElementById('s7-refine-btn');
  if (refineEl) {
    refineEl.addEventListener('input', () => { s.refineInput = refineEl.value; saveState(); });
    refineEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doS7Refine(); }
    });
  }
  if (refineBtnEl) refineBtnEl.addEventListener('click', () => doS7Refine());
}

async function doS7Generate() {
  const s = getStage(7);
  const inp = s.inputs;
  if (!inp.jd && !getRole().jd) { alert('No JD available. Complete Stage 1 or paste a JD in the field above.'); return; }
  if (!inp.resume) { alert('Please paste the candidate resume.'); return; }

  setBtn('s7-gen', true);
  await streamText(
    promptS7(inp),
    (_, acc) => {
      if (!document.getElementById('s7-out')) { s.output = acc; renderCurrentStage(); }
      else document.getElementById('s7-out').value = acc;
    },
    (acc) => {
      s.output = acc; s.refineInput = '';
      saveState();
      if (!document.getElementById('s7-out')) renderCurrentStage();
      setBtn('s7-gen', false);
    },
    (err) => { alert('Error: ' + err); setBtn('s7-gen', false); }
  );
}

async function doS7Refine() {
  const s = getStage(7);
  const feedback = document.getElementById('s7-refine')?.value?.trim();
  if (!feedback || !s.output) return;
  setBtn('s7-refine-btn', true, 'Refining...');

  await streamText(
    promptRefine('interview prep email', s.output, feedback, s.inputs.jd || getRole().jd),
    (_, acc) => { const el = document.getElementById('s7-out'); if (el) el.value = acc; },
    (acc) => {
      s.output = acc;
      document.getElementById('s7-refine').value = ''; s.refineInput = '';
      saveState(); setBtn('s7-refine-btn', false);
    },
    (err) => { alert('Error: ' + err); setBtn('s7-refine-btn', false); }
  );
}

// ═════════════════════════════════════════════════════════
// PROMPTS
// ═════════════════════════════════════════════════════════

function promptS1(jd) {
  return `You are a recruiting assistant at a search firm. Based on the job description or brief notes below, populate the confirmation email template. Extract as much as you can. Leave fields blank (just the field name and colon) if you cannot determine them. Return ONLY the populated email — no explanation, no preamble.

JD / Brief:
${jd}

Return this template populated:

Hi,

Thank you for your time today. As discussed, if you can confirm the details below this will form the basis of the search that we conduct. Feel free to add/edit anything as you see fit.

Title:
Reporting to:
Business need for the hire:
Wider team and where this role sits:
Essential skills required to interview a candidate:
Questions to screen candidates:
Interview Process:
Selling points of the role/company:
Location:
Salary:
Benefits:
Bonus:
Visa Sponsorship/Relocation package etc:
Ideal Start Date:
CV Feedback & Interview Feedback agreed SLAs:

As soon as you respond confirming the above, we will begin the search.

Best,`;
}

function promptS2(jd) {
  return `You are an expert LinkedIn Recruiter Boolean search specialist. Based on the job description below, create exactly 5 LinkedIn Recruiter Boolean search strings using proper Boolean operators (AND, OR, NOT, parentheses, quotes).

Return ONLY the 5 labeled strings in this exact format — no other text:

Title Search 1: [string]
Title Search 2: [string]
Keyword Search 1: [string]
Keyword Search 2: [string]
Keyword Search 3: [string]

Definitions:
- Title Search 1: Primary job title with closest synonyms and seniority variants
- Title Search 2: Alternative or adjacent titles, broader angle
- Keyword Search 1: Core technical skills and tools explicitly named in the JD
- Keyword Search 2: Domain knowledge, industry-specific terms, methodologies
- Keyword Search 3: Seniority signals, leadership indicators, cross-functional scope

JD:
${jd}`;
}

function promptS2Refine(jd, outputs, feedback) {
  return `You are an expert LinkedIn Recruiter Boolean search specialist. Refine these 5 search strings based on the feedback. Keep what works, fix what's off.

Current strings:
Title Search 1: ${outputs[0]}
Title Search 2: ${outputs[1]}
Keyword Search 1: ${outputs[2]}
Keyword Search 2: ${outputs[3]}
Keyword Search 3: ${outputs[4]}

JD:
${jd}

Feedback: ${feedback}

Return all 5 strings in the same exact labeled format. Return ONLY the strings, no other text.`;
}

function promptS3(jd, candidates) {
  return `You are an expert recruiter. Screen the following candidate profiles against the job description. Rate each candidate YES, MAYBE, or NO.

Rating guidelines:
- YES: Strong match, experience and skills clearly align with requirements
- MAYBE: Default when tenure or fit is ambiguous; some relevant experience but gaps or unclear points exist
- NO: Clear mismatch, missing essential skills or experience

For EACH candidate you can identify in the pasted text, output exactly one line in this format:
[Candidate name or identifier] :: YES :: [one factual sentence explaining why]
[Candidate name or identifier] :: MAYBE :: [one factual sentence explaining why]
[Candidate name or identifier] :: NO :: [one factual sentence explaining why]

Output ONLY these lines. No headers, no preamble, no numbering.

JD:
${jd}

Candidate profiles:
${candidates}`;
}

function promptS4(jd) {
  return `You are an expert recruiting consultant. Write a cold LinkedIn outreach message based on the job description below.

Rules — follow all exactly:
- Write a punchy subject line referencing the role, not the hiring company
- Never name the hiring company — use "a leading [industry] firm" or "a major [industry] company" or similar
- Open with the candidate's first name only — no greeting word (no Hi, Hello, Dear, etc.) before the name — use [First Name] as placeholder
- Briefly describe the role, mandate, and what makes it compelling
- Include a bullet list of the ideal profile pulled from the JD
- Include comp, location, and visa status from the JD if available
- Close with exactly this sentence (do not alter it): "If this is relevant, feel free to send over a resume and/or a good number to reach you. Best,"
- No em dashes anywhere in the output
- No bold formatting (no ** or __ markdown)

Format:
Subject: [subject line]

[email body]

JD:
${jd}`;
}

function promptS5(jd, profile) {
  return `You are a recruiting consultant. Based on the job description and the candidate profile below, write a pre-call clarification message.

Rules:
- Under 200 words total
- No em dashes
- No bold formatting
- Use [Name] as placeholder for the candidate's first name
- Identify what was genuinely relevant on their profile — the specific reason you reached out
- Identify the specific gap or mismatch — name it precisely, no hedging
- Use this exact structure and wording (fill in the bracketed parts):

Hi [Name] - really appreciate you responding and I want to be respectful of your time before we jump on a call, especially since I came to you. The reason I reached out was [specific relevance from their profile]. That said I want to be upfront. Looking more closely at your experience, [specific gap named clearly]. Before I put time on the calendar I just want to gut-check - [one direct question about the gap].

- End with exactly one direct question, not a list
- Return ONLY this message, nothing else

JD:
${jd}

Candidate profile:
${profile}`;
}

function promptS6(jd, inputs) {
  return `You are a recruiting consultant. Write a structured candidate presentation writeup.

Return the writeup in this exact format:
${inputs.name || '[Full Name]'}
${inputs.title || '[Current Title]'} / ${inputs.company || '[Current Company]'}
Citizenship: ${inputs.citizenship || '[status]'}
Compensation Expectation: ${inputs.comp || '[comp]'}

- [bullet 1]
- [bullet 2]
- [bullet 3]
- [bullet 4]
- [bullet 5]
- [bullet 6]

Rules:
- Exactly 6 bullets
- Each bullet maps a specific aspect of their background to a role requirement
- Factual and specific — no overselling, no vague claims
- No em dashes
- No bold formatting
- Return ONLY the writeup, nothing else

JD:
${jd}

Candidate details:
Name: ${inputs.name}
Current Title: ${inputs.title}
Current Company: ${inputs.company}
Citizenship: ${inputs.citizenship}
Compensation Expectation: ${inputs.comp}
Call notes:
${inputs.notes}`;
}

function promptS7(inp) {
  return `You are an experienced recruiting consultant who has placed hundreds of candidates and knows both the hiring company and the candidate well. Write a comprehensive interview prep email for the candidate.

This should be a thorough, long-form document — several paragraphs per section — that genuinely prepares them. Write as if you are a recruiter who cares about both parties and has inside knowledge.

Include these sections in this exact order, with the section name on its own line as a plain text header:

About the company
About the interviewer
What to expect and likely questions
How to tie your experience into the role
Questions to ask
Core logistics

Rules:
- Tone: professional but warm, like a mentor who knows both sides
- No em dashes anywhere in the output
- No bold formatting (no ** or __ markdown)
- Long-form — this is a thorough prep document, not a summary
- Write directly to the candidate (use "you")
- For the logistics section, address all the details provided and explicitly flag anything that may need reinforcing

Information:

Job Description:
${inp.jd}

Candidate Resume:
${inp.resume}

Interviewer LinkedIn Profile:
${inp.hmProfile || '(not provided)'}

Interview Format: ${inp.format || '(not specified)'}

HM Preferences / Feedback from rejected candidates:
${inp.hmPrefs || '(not provided)'}

Intel from prior rounds:
${inp.priorIntel || '(not provided)'}

Company about page:
${inp.aboutPage || '(not provided)'}

Candidate comp expectation: ${inp.comp || '(not specified)'}

Logistics to reinforce:
${inp.logistics || '(not provided)'}`;
}

function promptRefine(outputType, currentOutput, feedback, jd) {
  return `You are an expert recruiting consultant. Refine this ${outputType} based on the feedback below. Keep what is working, fix what's off.

Current output:
${currentOutput}

Feedback: ${feedback}

${jd ? `JD context:\n${jd}` : ''}

Rules: no em dashes, no bold formatting. Return the refined output only — no preamble or explanation.`;
}

// ═════════════════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════════════════

function init() {
  const saved = loadState();
  if (saved && saved.roles && Object.keys(saved.roles).length > 0) {
    state = saved;
    // Ensure all role stages have all required keys (migration guard)
    Object.values(state.roles).forEach(role => {
      const fresh = createRole();
      for (let n = 1; n <= 7; n++) {
        if (!role.stages[n]) role.stages[n] = fresh.stages[n];
        else {
          // Merge missing keys
          Object.keys(fresh.stages[n]).forEach(k => {
            if (!(k in role.stages[n])) role.stages[n][k] = fresh.stages[n][k];
          });
          if (n === 6 || n === 7) {
            Object.keys(fresh.stages[n].inputs).forEach(k => {
              if (!(k in role.stages[n].inputs)) role.stages[n].inputs[k] = '';
            });
          }
        }
      }
    });
  } else {
    const r = createRole('First Search');
    state.roles[r.id] = r;
    state.currentRoleId = r.id;
    state.currentStage = 1;
    saveState();
  }

  // API key
  initApiKey();

  // Sidebar add button
  document.getElementById('addRoleBtn')?.addEventListener('click', addRole);

  // Stage tabs
  document.querySelectorAll('.stage-tab').forEach(tab => {
    tab.addEventListener('click', () => switchStage(parseInt(tab.dataset.stage, 10)));
  });

  renderSidebar();
  renderStageNav();
  renderCurrentStage();
}

window.addEventListener('DOMContentLoaded', init);
