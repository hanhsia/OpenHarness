const CONFIG = window.OPENHARNESS_WEB_CONFIG ?? {};
const root = document.documentElement;
const log = document.querySelector('#log');
const form = document.querySelector('#composer');
const prompt = document.querySelector('#prompt');
const connectionState = document.querySelector('#connectionState');
const statusList = document.querySelector('#statusList');
const commandList = document.querySelector('#commandList');
const modalBackdrop = document.querySelector('#modalBackdrop');
const modalKind = document.querySelector('#modalKind');
const modalTitle = document.querySelector('#modalTitle');
const modalBody = document.querySelector('#modalBody');
const modalAnswer = document.querySelector('#modalAnswer');
const modalActions = document.querySelector('#modalActions');

let socket;
let assistantBuffer = '';
let activeAssistantEntry = null;
let entryCount = 0;
let firstUser = true;
let busy = false;
let pendingSelect = null;

const SELECTOR_COMMANDS = new Set(['provider', 'resume', 'permissions', 'theme', 'output-style', 'effort', 'passes', 'turns', 'fast', 'vim', 'voice', 'model']);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
}

function nowLabel() {
  return new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

function wsUrl() {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const port = CONFIG.wsPort ?? Number(window.location.port || 8765) + 1;
  return `${scheme}//${window.location.hostname}:${port}${CONFIG.wsPath ?? '/ws'}`;
}

function setConnection(text, cls = '') {
  connectionState.textContent = text;
  connectionState.className = `connection ${cls}`.trim();
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    addTranscriptItem({role: 'system', text: 'WebSocket is not connected.'});
    return;
  }
  socket.send(JSON.stringify(payload));
}

function addEntry(role, text, options = {}) {
  entryCount += 1;
  const article = document.createElement('article');
  article.className = `entry ${role}`;
  if (role === 'user' && firstUser) {
    article.classList.add('first-user');
    firstUser = false;
  }
  const who = role === 'assistant' ? 'Harness' : role === 'user' ? 'You' : role === 'tool' ? 'Tool' : 'System';
  article.innerHTML = `
    <div class="sigil"><span class="num">§ ${String(entryCount).padStart(2, '0')}</span>${nowLabel()}</div>
    <p class="byline"><span class="who">${escapeHtml(who)}</span>${options.tool ? ` · <span class="mono">${escapeHtml(options.tool)}</span>` : ''}</p>
    <div class="prose"></div>`;
  const prose = article.querySelector('.prose');
  if (role === 'tool' || role === 'tool_result' || role === 'log') {
    const block = document.createElement('div');
    block.className = `ml ${options.is_error ? 'error' : ''}`;
    block.innerHTML = options.tool ? `<span class="tool">${escapeHtml(options.tool)}</span> ${escapeHtml(text)}` : escapeHtml(text);
    prose.append(block);
  } else {
    const p = document.createElement('p');
    p.textContent = text;
    prose.append(p);
  }
  log.append(article);
  article.scrollIntoView({block: 'end'});
  return article;
}

function addTranscriptItem(item) {
  if (!item) return;
  addEntry(item.role, item.text, {tool: item.tool_name, is_error: item.is_error});
}

function appendAssistantDelta(delta) {
  assistantBuffer += delta;
  if (!activeAssistantEntry) {
    activeAssistantEntry = addEntry('assistant', '');
  }
  const p = activeAssistantEntry.querySelector('.prose p');
  p.textContent = assistantBuffer;
  const caret = document.createElement('span');
  caret.className = 'caret-mark';
  caret.textContent = '▌';
  p.append(caret);
  activeAssistantEntry.scrollIntoView({block: 'end'});
}

function completeAssistant(text) {
  const finalText = text || assistantBuffer;
  if (!activeAssistantEntry) {
    activeAssistantEntry = addEntry('assistant', finalText);
  } else {
    activeAssistantEntry.querySelector('.prose p').textContent = finalText;
  }
  assistantBuffer = '';
  activeAssistantEntry = null;
}

function clearTranscript() {
  log.querySelectorAll('.entry').forEach((node) => node.remove());
  assistantBuffer = '';
  activeAssistantEntry = null;
  entryCount = 0;
  firstUser = true;
}

function setStatus(state = {}) {
  const fields = [
    ['model', state.model],
    ['provider', state.provider],
    ['permissions', state.permission_mode],
    ['cwd', state.cwd],
  ];
  statusList.innerHTML = fields.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value ?? '—')}</dd></div>`).join('');
  document.querySelector('#cwdLabel').textContent = state.cwd ?? CONFIG.cwd ?? 'cwd';
  document.querySelector('#whereCwd').textContent = state.cwd ?? CONFIG.cwd ?? 'cwd';
  document.querySelector('#modelLabel').textContent = state.model ?? 'model';
  document.querySelector('#permissionLabel').textContent = state.permission_mode ?? 'permissions';
}

function setCommands(commands = []) {
  commandList.innerHTML = '';
  commands.slice(0, 28).forEach((command) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'command-chip';
    button.textContent = command;
    button.addEventListener('click', () => {
      const name = command.replace(/^\//, '');
      if (SELECTOR_COMMANDS.has(name)) {
        send({type: 'select_command', command});
      } else {
        prompt.value = `${command} `;
        prompt.focus();
      }
    });
    commandList.append(button);
  });
}

function showModal(modal, options = []) {
  if (!modal) {
    modalBackdrop.hidden = true;
    return;
  }
  modalBackdrop.hidden = false;
  modalAnswer.hidden = true;
  modalAnswer.value = '';
  modalActions.innerHTML = '';

  if (modal.kind === 'permission') {
    modalKind.textContent = 'Permission required';
    modalTitle.textContent = `Allow ${modal.tool_name}?`;
    modalBody.textContent = modal.reason ?? '';
    addAction('Decline', () => sendModalResponse({type: 'permission_response', request_id: modal.request_id, allowed: false}));
    addAction('Allow once', () => sendModalResponse({type: 'permission_response', request_id: modal.request_id, allowed: true, permission_reply: 'once'}));
    addAction('Allow session', () => sendModalResponse({type: 'permission_response', request_id: modal.request_id, allowed: true, permission_reply: 'always'}));
  } else if (modal.kind === 'edit_diff') {
    modalKind.textContent = 'Edit approval';
    modalTitle.textContent = modal.path ?? 'Approve edit';
    modalBody.textContent = modal.diff ?? '';
    addAction('Reject', () => sendModalResponse({type: 'permission_response', request_id: modal.request_id, allowed: false, permission_reply: 'reject'}));
    addAction('Allow once', () => sendModalResponse({type: 'permission_response', request_id: modal.request_id, allowed: true, permission_reply: 'once'}));
    addAction('Always allow edits', () => sendModalResponse({type: 'permission_response', request_id: modal.request_id, allowed: true, permission_reply: 'always'}));
  } else if (modal.kind === 'question') {
    modalKind.textContent = 'Question';
    modalTitle.textContent = 'OpenHarness asks';
    modalBody.textContent = modal.question ?? '';
    modalAnswer.hidden = false;
    modalAnswer.focus();
    addAction('Send answer', () => sendModalResponse({type: 'question_response', request_id: modal.request_id, answer: modalAnswer.value}));
  } else if (modal.kind === 'select' || pendingSelect) {
    showSelectModal(modal, options);
  }
}

function showSelectModal(modal, options = []) {
  pendingSelect = modal;
  modalKind.textContent = 'Select';
  modalTitle.textContent = modal.title ?? 'Select';
  modalBody.textContent = '';
  modalActions.innerHTML = '';
  options.forEach((option) => {
    addAction(`${option.label ?? option.value}${option.active ? ' ✓' : ''}`, () => {
      sendModalResponse({type: 'apply_select_command', command: modal.command, value: option.value});
    });
  });
  addAction('Cancel', () => { modalBackdrop.hidden = true; pendingSelect = null; });
  modalBackdrop.hidden = false;
}

function addAction(label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', handler);
  modalActions.append(button);
}

function sendModalResponse(payload) {
  send(payload);
  modalBackdrop.hidden = true;
  pendingSelect = null;
}

function handleEvent(event) {
  if (event.type === 'ready') {
    setConnection('ready', 'ready');
    setStatus(event.state ?? {});
    setCommands(event.commands ?? []);
    return;
  }
  if (event.type === 'state_snapshot') {
    setStatus(event.state ?? {});
    return;
  }
  if (event.type === 'transcript_item') return addTranscriptItem(event.item);
  if (event.type === 'assistant_delta') return appendAssistantDelta(event.message ?? '');
  if (event.type === 'assistant_complete') return completeAssistant(event.message ?? '');
  if (event.type === 'tool_started') return addTranscriptItem(event.item ?? {role: 'tool', text: JSON.stringify(event.tool_input ?? {}), tool_name: event.tool_name});
  if (event.type === 'tool_completed') return addTranscriptItem(event.item ?? {role: 'tool_result', text: event.output ?? '', tool_name: event.tool_name, is_error: event.is_error});
  if (event.type === 'clear_transcript') return clearTranscript();
  if (event.type === 'modal_request') return showModal(event.modal);
  if (event.type === 'select_request') return showSelectModal(event.modal ?? {}, event.select_options ?? []);
  if (event.type === 'error') {
    busy = false;
    addTranscriptItem({role: 'system', text: `error: ${event.message ?? 'unknown error'}`});
    return;
  }
  if (event.type === 'line_complete') {
    busy = false;
    prompt.disabled = false;
    prompt.focus();
  }
}

function connect() {
  setConnection('connecting');
  socket = new WebSocket(wsUrl());
  socket.addEventListener('open', () => setConnection('connected', 'ready'));
  socket.addEventListener('message', (message) => handleEvent(JSON.parse(message.data)));
  socket.addEventListener('close', () => {
    setConnection('closed', 'error');
    prompt.disabled = true;
  });
  socket.addEventListener('error', () => setConnection('error', 'error'));
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const line = prompt.value.trim();
  if (!line || busy) return;
  busy = true;
  prompt.value = '';
  prompt.style.height = 'auto';
  send({type: 'submit_line', line});
});

prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
prompt.addEventListener('input', () => {
  prompt.style.height = 'auto';
  prompt.style.height = `${Math.min(prompt.scrollHeight, 180)}px`;
});

document.querySelector('#clearButton').addEventListener('click', () => clearTranscript());
document.querySelector('#themeButton').addEventListener('click', () => {
  const next = root.getAttribute('data-theme') === 'ink' ? 'paper' : 'ink';
  root.setAttribute('data-theme', next);
  localStorage.setItem('oh.web.theme', next);
});

const savedTheme = localStorage.getItem('oh.web.theme');
if (savedTheme === 'paper' || savedTheme === 'ink') root.setAttribute('data-theme', savedTheme);
setStatus({cwd: CONFIG.cwd});
connect();
