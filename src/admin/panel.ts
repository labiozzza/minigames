// §14 admin panel. Real, clickable UI over the admin API: login, edit draft,
// preview (server-certified sample levels), publish, rollback, history/audit.
// Non-admin sessions get 403 from every /admin route and see the refusal here.
import { apiBase, el } from './dom';

const API = apiBase();
const GAME = 'plumber';
const KEY = 'mg.admin.token';

type Json = Record<string, unknown>;
interface PreviewLevel {
  seed: number;
  ok: boolean;
  family: string;
  gridW: number;
  gridH: number;
  par: number;
  certLevel: string;
  reason?: string;
}

let token = localStorage.getItem(KEY) ?? '';

function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function call(path: string, method = 'GET', body?: unknown): Promise<{ status: number; data: Json }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: Json = {};
  try {
    data = (await res.json()) as Json;
  } catch {
    data = {};
  }
  return { status: res.status, data };
}

const root = document.getElementById('admin-root')!;
root.append(el('h1', 'admin-title', 'MiniGames · админка'));

const loginCard = el('section', 'card');
const emailInput = el('input', 'input') as HTMLInputElement;
emailInput.type = 'email';
emailInput.id = 'admin-email';
emailInput.placeholder = 'admin@example.com';
const codeInput = el('input', 'input') as HTMLInputElement;
codeInput.id = 'admin-code';
codeInput.placeholder = 'код из письма';
const loginMsg = el('div', 'msg');
const requestBtn = el('button', 'btn', 'Запросить код') as HTMLButtonElement;
const verifyBtn = el('button', 'btn primary', 'Войти') as HTMLButtonElement;
loginCard.append(el('h2', '', 'Вход'), emailInput, requestBtn, codeInput, verifyBtn, loginMsg);
root.append(loginCard);

const panel = el('section', 'panel');
panel.hidden = true;
root.append(panel);

const status = el('div', 'msg');
const draftBox = el('pre', 'json');
const draftEditor = el('textarea', 'editor') as HTMLTextAreaElement;
draftEditor.spellcheck = false;
const previewBox = el('div', 'preview');
const errorsBox = el('div', 'msg errors');
const historyBox = el('div', 'table');
const auditBox = el('div', 'table');

const seedsInput = el('input', 'input') as HTMLInputElement;
seedsInput.value = '11,22,33,44';
const minSeedsInput = el('input', 'input') as HTMLInputElement;
minSeedsInput.type = 'number';
minSeedsInput.value = '4';

const saveBtn = el('button', 'btn', 'Сохранить черновик') as HTMLButtonElement;
const previewBtn = el('button', 'btn', 'Preview (сертификация)') as HTMLButtonElement;
const publishBtn = el('button', 'btn primary', 'Publish') as HTMLButtonElement;
const rollbackBtn = el('button', 'btn warn', 'Rollback') as HTMLButtonElement;
const refreshBtn = el('button', 'btn', 'Обновить историю/аудит') as HTMLButtonElement;

previewBox.id = 'admin-preview';
errorsBox.id = 'admin-errors';
historyBox.id = 'admin-history';
auditBox.id = 'admin-audit';
draftEditor.id = 'admin-draft';

panel.append(
  el('h2', '', 'Параметры / черновик'),
  draftBox,
  draftEditor,
  saveBtn,
  el('h2', '', 'Preview и publish'),
  el('label', 'lbl', 'seeds (через запятую)'),
  seedsInput,
  el('label', 'lbl', 'min seeds при publish'),
  minSeedsInput,
  previewBtn,
  publishBtn,
  rollbackBtn,
  errorsBox,
  previewBox,
  el('h2', '', 'История и аудит'),
  refreshBtn,
  historyBox,
  auditBox,
  status,
);

function parseSeeds(): number[] {
  return seedsInput.value
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

function showErrors(errors: unknown): void {
  errorsBox.innerHTML = '';
  if (!Array.isArray(errors) || errors.length === 0) {
    errorsBox.hidden = true;
    return;
  }
  errorsBox.hidden = false;
  errorsBox.append(el('strong', '', 'Ошибки схемы:'));
  const ul = el('ul', '');
  for (const e of errors) ul.append(el('li', '', String(e)));
  errorsBox.append(ul);
}

function renderPreview(levels: PreviewLevel[], report: { ok: boolean; passed: number; total: number }): void {
  previewBox.innerHTML = '';
  const table = el('table', 'grid');
  const head = el('tr', '');
  for (const h of ['seed', 'cert', 'family', 'grid', 'par', 'reason']) head.append(el('th', '', h));
  table.append(head);
  for (const l of levels) {
    const tr = el('tr', l.ok ? 'ok' : 'bad');
    tr.append(
      el('td', '', String(l.seed)),
      el('td', '', l.certLevel),
      el('td', '', l.family),
      el('td', '', `${l.gridW}x${l.gridH}`),
      el('td', '', String(l.par)),
      el('td', '', l.reason ?? '—'),
    );
    table.append(tr);
  }
  previewBox.append(el('div', 'report', `certified ${report.passed}/${report.total} → ${report.ok ? 'OK' : 'FAIL'}`), table);
}

async function refresh(): Promise<void> {
  const who = await call('/admin/whoami');
  if (!who.data.isAdmin) {
    panel.hidden = true;
    loginMsg.textContent = who.status === 401 ? 'Войдите как администратор.' : 'Доступ только для администратора (403).';
    return;
  }
  panel.hidden = false;
  loginCard.hidden = true;
  const draftRes = await call(`/admin/config/draft?game=${GAME}`);
  const draft = draftRes.data.draft as { draft?: Json; updatedBy?: string } | null;
  const published = draftRes.data.published as { version?: number; checksum?: string; config?: Json } | undefined;
  draftBox.textContent = `published v${published?.version ?? '?'} · ${published?.checksum ?? '—'}`;
  const editable = (draft?.draft ?? published?.config) as Json | undefined;
  draftEditor.value = JSON.stringify(editable ?? {}, null, 2);
  const hist = await call(`/admin/config/history?game=${GAME}`);
  const history = (hist.data.history as Array<{ version: number; checksum: string; by: string; changes: string[] }>) ?? [];
  historyBox.innerHTML = '';
  historyBox.append(el('strong', '', `История (${history.length})`));
  for (const h of history) historyBox.append(el('div', 'row', `v${h.version} · ${h.checksum || '—'} · ${h.by} · ${h.changes.join(', ')}`));
  const audit = await call('/admin/audit');
  const rows = (audit.data.audit as Array<Record<string, unknown>>) ?? [];
  auditBox.innerHTML = '';
  auditBox.append(el('strong', '', `Аудит (${rows.length})`));
  for (const a of rows) auditBox.append(el('div', 'row', `${a.action} · v${a.version ?? '—'} · ${a.checksum ?? '—'} · ${a.by ?? '—'}`));
}

function loginBtnMsg(code: unknown): void {
  loginMsg.textContent = typeof code === 'string' ? `Тестовый код: ${code}` : 'Код отправлен (проверьте почту).';
}
requestBtn.id = 'admin-request';
verifyBtn.id = 'admin-verify';
seedsInput.id = 'admin-seeds';
minSeedsInput.id = 'admin-minseeds';
requestBtn.addEventListener('click', async () => {
  loginMsg.textContent = '';
  const r = await call('/auth/otp/request', 'POST', { email: emailInput.value.trim() });
  loginBtnMsg(r.data.code);
});

verifyBtn.addEventListener('click', async () => {
  const r = await call('/auth/otp/verify', 'POST', { email: emailInput.value.trim(), code: codeInput.value.trim() });
  if (r.status !== 200) {
    loginMsg.textContent = 'Неверный код.';
    return;
  }
  token = String(r.data.token ?? '');
  localStorage.setItem(KEY, token);
  await refresh();
});

saveBtn.addEventListener('click', async () => {
  status.textContent = '';
  let draft: unknown;
  try {
    draft = JSON.parse(draftEditor.value);
  } catch {
    showErrors(['draft: invalid JSON']);
    return;
  }
  const r = await call('/admin/config/draft', 'PUT', { game: GAME, draft });
  if (r.status !== 200) {
    showErrors(r.data.errors ?? [r.data.error ?? 'draft rejected']);
    status.textContent = `Черновик не сохранён (${r.status})`;
    return;
  }
  showErrors([]);
  status.textContent = `Черновик сохранён · ${String(r.data.checksum ?? '')}`;
  await refresh();
});

previewBtn.addEventListener('click', async () => {
  status.textContent = '';
  const r = await call('/admin/config/preview', 'POST', { game: GAME, seeds: parseSeeds() });
  if (r.status !== 200) {
    showErrors(r.data.errors ?? [r.data.error ?? 'preview failed']);
    previewBox.innerHTML = '';
    return;
  }
  showErrors([]);
  const preview = r.data.preview as { levels: PreviewLevel[]; report: { ok: boolean; passed: number; total: number } };
  renderPreview(preview.levels, preview.report);
  publishBtn.disabled = !preview.report.ok;
  status.textContent = preview.report.ok ? 'Preview прошёл: можно публиковать.' : 'Preview содержит отбраковку — publish запрещён.';
});

publishBtn.addEventListener('click', async () => {
  status.textContent = '';
  const r = await call('/admin/config/publish', 'POST', { game: GAME, seeds: parseSeeds(), minSeeds: Number(minSeedsInput.value) || 4 });
  if (r.status !== 200) {
    showErrors(r.data.errors ?? [r.data.error ?? 'publish failed']);
    const report = r.data.report as { results?: PreviewLevel[]; total?: number; passed?: number; ok?: boolean } | undefined;
    if (report?.results) renderPreview(report.results, { ok: !!report.ok, passed: report.passed ?? 0, total: report.total ?? report.results.length });
    status.textContent = `Publish заблокирован (${r.status})`;
    return;
  }
  showErrors([]);
  const version = r.data.version as { version: number; checksum: string; changes: string[] };
  status.textContent = `Опубликовано v${version.version} · ${version.checksum} · изменения: ${version.changes.join(', ') || '—'}`;
  await refresh();
});

rollbackBtn.addEventListener('click', async () => {
  const r = await call('/admin/config/rollback', 'POST', { game: GAME });
  if (r.status !== 200) {
    status.textContent = `Rollback недоступен (${r.status})`;
    return;
  }
  const version = r.data.version as { version: number; checksum: string };
  status.textContent = `Откат: v${version.version} · ${version.checksum}`;
  await refresh();
});

refreshBtn.addEventListener('click', refresh);

void refresh();
