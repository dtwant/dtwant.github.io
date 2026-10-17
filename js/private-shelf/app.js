import { addOpenEvent, filterBooks, mergeBackup, normalizeBook, rankBooks, recentBooks } from './core.js';
import { exportState, loadState, saveState } from './store.js';

const root = document.querySelector('[data-private-shelf]');
const $ = selector => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  shelf: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><path d="m17 5 4-1 3 15-4 1z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  ranking: '<path d="M5 20V13M12 20V4M19 20V9"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.shelf}</svg>`;

// Isolate the app from article typography and the hidden site's focus order.
document.body.append(root);
document.body.classList.add('ps-page');
for (const child of document.body.children) if (child !== root && !['SCRIPT', 'LINK', 'STYLE'].includes(child.tagName)) child.inert = true;
root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
$('#ps-settings').innerHTML = icon('more');
$('#ps-search-icon').innerHTML = icon('search');

let state = await loadState();
let view = 'shelf', query = '', tag = '', sort = 'new', period = 'all';
let busy = false, openLock = false, toastTimer, returnFocus;
const titles = { shelf: '本棚', search: '作品を探す', favorites: 'お気に入り', ranking: 'よく読む作品' };
const liveBooks = () => state.books.filter(b => !b.deletedAt);
function toast(message) {
  clearTimeout(toastTimer);
  $('.ps-toast').textContent = message;
  $('.ps-toast').hidden = false;
  toastTimer = setTimeout(() => { $('.ps-toast').hidden = true; }, 3500);
}
async function commit(next) {
  await saveState(next);
  state = next;
}
function tone(book) { return [...book.id].reduce((sum, c) => sum + c.codePointAt(0), 0) % 5; }
function card(book) {
  return `<article class="ps-card">
    <button class="ps-card-open" data-open="${esc(book.id)}" aria-label="${esc(book.title)}を読む">
      <span class="ps-cover ps-tone-${tone(book)}"><span class="ps-cover-rule"></span><span class="ps-cover-title">${esc(book.title)}</span><span class="ps-cover-bottom">${esc(book.authors.join(' / '))}</span></span>
      <span class="ps-book-title">${esc(book.title)}</span><span class="ps-author">${esc(book.authors.join(' / '))}</span>
    </button>
    <div class="ps-card-actions"><span class="ps-card-tag">${esc(book.tags[0] || 'タグなし')}</span><button class="ps-icon-button ps-fav${book.favorite ? ' is-favorite' : ''}" data-fav="${esc(book.id)}" aria-label="${esc(book.title)}のお気に入り" aria-pressed="${book.favorite}">${icon('heart')}</button><button class="ps-icon-button" data-edit="${esc(book.id)}" aria-label="${esc(book.title)}を編集">${icon('more')}</button></div>
  </article>`;
}
function empty(title, description, action = '') {
  return `<div class="ps-empty"><span class="ps-empty-icon">${icon(view === 'favorites' ? 'heart' : 'shelf')}</span><h2>${title}</h2><p>${description}</p>${action}</div>`;
}
function render() {
  $('.ps-content').setAttribute('aria-label', titles[view]);
  root.querySelectorAll('[data-view]').forEach(el => { el.classList.toggle('is-active', el.dataset.view === view); el.setAttribute('aria-current', el.dataset.view === view ? 'page' : 'false'); });
  $('.ps-search-wrap').hidden = view === 'ranking';
  $('#ps-clear').hidden = !query;
  let books = filterBooks(liveBooks().filter(b => view !== 'favorites' || b.favorite), query);
  if (tag) books = books.filter(b => b.tags.includes(tag));
  books.sort(sort === 'title' ? (a, b) => a.title.localeCompare(b.title, 'ja') : (a, b) => b.createdAt.localeCompare(a.createdAt));
  if (view === 'ranking') {
    const now = new Date();
    const since = period === 'week' ? now.getTime() - 7 * 86400000 : period === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1).getTime() : null;
    const rows = rankBooks(state, { since });
    let rank = 0;
    $('#ps-results').innerHTML = `<p class="ps-intro">つい開いてしまう、あなたの定番。</p><div class="ps-period" aria-label="集計期間">${[['all', 'すべて'], ['month', '今月'], ['week', '7日間']].map(([key, label]) => `<button data-period="${key}" aria-pressed="${period === key}">${label}</button>`).join('')}</div><p class="ps-ranking-note">作品を開いた回数で集計</p>${rows.length ? `<div class="ps-ranking">${rows.map((row, i) => { if (!i || row.count !== rows[i - 1].count) rank = i + 1; return `<button class="ps-rank-row" data-open="${esc(row.book.id)}"><b class="ps-rank-number">${String(rank).padStart(2, '0')}</b><span class="ps-rank-book ps-tone-${tone(row.book)}" aria-hidden="true">${icon('shelf')}</span><span class="ps-rank-info"><strong>${esc(row.book.title)}</strong><small>${esc(row.book.authors.join(' / '))}</small></span><span class="ps-rank-count">${row.count}<small>回</small></span></button>`; }).join('')}</div>` : empty('まだ記録はありません', '本棚から作品を開くと、ここに並びます。')}`;
    return;
  }
  if (!liveBooks().length) {
    $('#ps-results').innerHTML = empty('読みたい作品を、ここに。', '作品のURLを登録して、\n自分だけの本棚を育てよう。', '<button class="ps-primary" data-add>最初の作品を追加</button>');
    return;
  }
  const recent = view === 'shelf' && !query && !tag ? recentBooks(state).slice(0, 6) : [];
  const tags = [...new Set(liveBooks().flatMap(b => b.tags))].sort((a, b) => a.localeCompare(b, 'ja'));
  $('#ps-results').innerHTML = `${recent.length ? `<section class="ps-recent-section"><div class="ps-section-head"><h2>最近読んだ作品</h2><span>最新${recent.length}件</span></div><div class="ps-recent">${recent.map((b, i) => `<button class="ps-recent-item" data-open="${esc(b.id)}"><span class="ps-recent-cover ps-tone-${tone(b)}">${String(i + 1).padStart(2, '0')}</span><span><strong>${esc(b.title)}</strong><small>${esc(b.authors.join(' / '))}</small></span></button>`).join('')}</div></section>` : ''}
    ${tags.length ? `<div class="ps-tags" aria-label="タグで絞り込み"><button data-tag="" aria-pressed="${!tag}">すべて</button>${tags.map(t => `<button data-tag="${esc(t)}" aria-pressed="${tag === t}">${esc(t)}</button>`).join('')}</div>` : ''}
    <div class="ps-section-head ps-library-head"><h2>${query || tag ? '検索結果' : view === 'favorites' ? 'お気に入り' : 'すべての作品'}<span class="ps-total">${books.length}</span></h2><select id="ps-sort" aria-label="並び順"><option value="new" ${sort === 'new' ? 'selected' : ''}>追加した順</option><option value="title" ${sort === 'title' ? 'selected' : ''}>タイトル順</option></select></div>
    ${books.length ? `<div class="ps-grid">${books.map(card).join('')}</div>` : empty(view === 'favorites' && !query && !tag ? '好きな作品を、すぐ手元に。' : '作品が見つかりません', view === 'favorites' && !query && !tag ? '作品のハートを押すと、ここに集まります。' : '別の言葉やタグで探してみてください。')}`;
}
function closeSheet() {
  $('#ps-dialog').close();
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  else $('#ps-add').focus({ preventScroll: true });
}
function showSheet(html) {
  returnFocus = document.activeElement;
  const dialog = $('#ps-dialog');
  dialog.innerHTML = html;
  dialog.showModal();
  dialog.scrollTop = 0;
}
function openForm(book = null) {
  const split = value => value.split(/[,、\n]/).map(v => v.trim()).filter(Boolean);
  showSheet(`<form id="ps-form" class="ps-sheet"><header class="ps-sheet-head"><div><p class="ps-eyebrow">${book ? 'EDIT BOOK' : 'ADD TO SHELF'}</p><h2 id="ps-sheet-title">${book ? '作品を編集' : '本棚に追加'}</h2></div><button type="button" class="ps-icon-button" data-cancel aria-label="閉じる">${icon('close')}</button></header><div class="ps-sheet-body">
    <label for="ps-url">作品のURL <small>必須</small></label><div class="ps-url-row"><input id="ps-url" name="url" type="url" required placeholder="https://…" value="${esc(book?.url || '')}" autocomplete="off"><button type="button" id="ps-paste">貼付け</button></div>
    <label for="ps-title">タイトル <small>必須</small></label><input id="ps-title" name="title" required maxlength="200" value="${esc(book?.title || '')}" placeholder="作品名を入力">
    <label for="ps-authors">著者 <small>必須</small></label><input id="ps-authors" name="authors" required value="${esc(book?.authors.join(', ') || '')}" placeholder="名前を入力すると候補が出ます" autocomplete="off"><div class="ps-suggestions" id="ps-authors-suggestions"></div>
    <label for="ps-tags">タグ <small>任意</small></label><input id="ps-tags" name="tags" value="${esc(book?.tags.join(', ') || '')}" placeholder="恋愛、あとで読む…" autocomplete="off"><div class="ps-suggestions" id="ps-tags-suggestions"></div><p class="ps-field-hint">著者・タグは「、」か「,」で複数追加できます。</p>
    <p class="ps-error" role="alert" hidden></p>${book ? '<button type="button" class="ps-danger" id="ps-delete">この作品を削除</button>' : ''}</div><footer class="ps-sheet-footer"><button type="button" class="ps-secondary" data-cancel>キャンセル</button><button type="submit" class="ps-primary" data-save>${book ? '変更を保存' : '本棚に追加'}</button></footer></form>`);
  const form = $('#ps-form');
  const initial = JSON.stringify([...new FormData(form)]);
  const cancel = () => { if (busy) return; if (JSON.stringify([...new FormData(form)]) !== initial && !confirm('入力中の内容を破棄しますか？')) return; closeSheet(); };
  form.querySelectorAll('[data-cancel]').forEach(b => b.onclick = cancel);
  $('#ps-dialog').oncancel = e => { e.preventDefault(); cancel(); };
  form.querySelector('[data-cancel]').focus();
  for (const field of ['authors', 'tags']) {
    const input = form.elements[field];
    const suggestions = () => {
      const terms = input.value.split(/[,、\n]/);
      const prefix = terms.pop().trim().normalize('NFKC').toLocaleLowerCase();
      const kind = field === 'authors' ? 'author' : 'tag';
      const values = [...new Set([...state.books.flatMap(b => b[field] || []), ...(state.vocabulary || []).filter(v => v.kind === kind).map(v => v.label)])];
      $(`#ps-${field}-suggestions`).innerHTML = prefix ? values.filter(v => v.normalize('NFKC').toLocaleLowerCase().includes(prefix) && !terms.map(t => t.trim()).includes(v)).slice(0, 6).map(v => `<button type="button" data-suggest="${field}" data-value="${esc(v)}">${esc(v)}</button>`).join('') : '';
    };
    input.oninput = suggestions;
    $(`#ps-${field}-suggestions`).onclick = e => {
      const button = e.target.closest('[data-suggest]');
      if (!button) return;
      const terms = input.value.split(/[,、\n]/); terms.pop(); terms.push(button.dataset.value);
      input.value = terms.map(t => t.trim()).filter(Boolean).join(', ') + ', ';
      suggestions(); input.focus();
    };
  }
  $('#ps-paste').onclick = async () => { try { form.elements.url.value = await navigator.clipboard.readText(); } catch { toast('URL欄を長押しして貼り付けてください'); form.elements.url.focus(); } };
  if (book) $('#ps-delete').onclick = async () => {
    if (busy || !confirm(`「${book.title}」を本棚から削除しますか？`)) return;
    busy = true;
    try {
      const now = new Date().toISOString();
      await commit({ ...state, books: state.books.map(b => b.id === book.id ? { ...b, deletedAt: now, updatedAt: now } : b) });
      render(); closeSheet(); toast('本棚から削除しました');
    } catch { toast('保存できませんでした。もう一度お試しください'); } finally { busy = false; }
  };
  form.onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    const data = new FormData(form);
    const error = $('.ps-error'); error.hidden = true;
    busy = true; form.querySelector('[data-save]').disabled = true;
    try {
      const next = normalizeBook({ ...book, url: data.get('url'), title: data.get('title'), authors: split(data.get('authors')), tags: split(data.get('tags')) });
      if (state.books.some(b => !b.deletedAt && b.id !== next.id && b.urlKey === next.urlKey)) throw new Error('このURLはすでに本棚にあります。');
      const vocabulary = [...(state.vocabulary || [])];
      for (const [kind, labels] of [['author', [...(book?.authors || []), ...next.authors]], ['tag', [...(book?.tags || []), ...next.tags]]]) {
        for (const label of labels) {
          const normalized = label.trim().normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ');
          if (!vocabulary.some(v => v.kind === kind && v.normalized === normalized)) vocabulary.push({ id: crypto.randomUUID(), kind, label, normalized, createdAt: next.updatedAt });
        }
      }
      await commit({ ...state, books: [...state.books.filter(b => b.id !== next.id), next], vocabulary });
      if (!book) { view = 'shelf'; query = ''; tag = ''; sort = 'new'; $('#ps-search').value = ''; $('.ps-content').scrollTop = 0; }
      render(); closeSheet(); toast(book ? '変更を保存しました' : '本棚に追加しました');
    } catch (err) {
      error.textContent = err.message.includes('URL') ? 'URLを確認してください。同じURLの重複登録はできません。' : '保存できませんでした。タイトル・著者と端末の空き容量を確認してください。';
      error.hidden = false; error.scrollIntoView({ block: 'nearest' });
    } finally { busy = false; form.querySelector('[data-save]').disabled = false; }
  };
}
function settings() {
  showSheet(`<section class="ps-sheet"><header class="ps-sheet-head"><h2 id="ps-sheet-title">本棚の設定</h2><button class="ps-icon-button" data-cancel aria-label="閉じる">${icon('close')}</button></header><div class="ps-sheet-body"><h3>バックアップ</h3><p class="ps-field-hint">作品はこの端末に保存されます。</p><button class="ps-settings-action" id="ps-export">JSONバックアップを書き出す ${icon('arrow')}</button><button class="ps-settings-action" id="ps-import">バックアップを読み込む ${icon('arrow')}</button><input type="file" id="ps-import-file" accept="application/json,.json" hidden><p class="ps-field-hint" id="ps-import-status" role="status"></p><button class="ps-primary" id="ps-import-confirm" hidden>この内容を本棚に取り込む</button><a class="ps-settings-action" href="/0723/">本棚を閉じる ${icon('arrow')}</a></div></section>`);
  $('[data-cancel]').onclick = () => { if (!busy) closeSheet(); };
  $('#ps-dialog').oncancel = e => { if (busy) e.preventDefault(); };
  $('#ps-export').onclick = () => exportState(state);
  $('#ps-import').onclick = () => $('#ps-import-file').click();
  let incoming;
  $('#ps-import-file').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    incoming = null; $('#ps-import-confirm').hidden = true;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('20MB以下のファイルを選んでください。');
      const parsed = JSON.parse(await file.text());
      mergeBackup(state, parsed);
      incoming = parsed;
      $('#ps-import-status').textContent = `${parsed.books.filter(b => !b.deletedAt).length}冊のバックアップです。現在の本棚に統合し、同じ作品は新しい更新を優先します。取り込み前のバックアップも自動で書き出します。`;
      $('#ps-import-confirm').hidden = false;
    } catch (err) { $('#ps-import-status').textContent = err instanceof SyntaxError ? 'JSONファイルを読み取れませんでした。' : err.message; }
  };
  $('#ps-import-confirm').onclick = async () => {
    if (busy || !incoming) return;
    busy = true;
    try {
      const next = mergeBackup(state, incoming);
      await exportState(state);
      await commit(next);
      render(); closeSheet(); toast('バックアップを取り込みました');
    } catch { $('#ps-import-status').textContent = '保存できませんでした。現在の本棚は保持されています。'; }
    finally { busy = false; }
  };
}
async function openBook(id) {
  if (openLock || busy) return;
  const book = liveBooks().find(b => b.id === id); if (!book) return;
  openLock = true;
  try {
    await commit(addOpenEvent(state, id));
    try { sessionStorage.setItem('dt_private_shelf_view_v1', JSON.stringify({ view, query, tag, sort, period, scroll: $('.ps-content').scrollTop })); } catch {}
    location.assign(book.url);
  } catch { openLock = false; toast('履歴を保存できませんでした。もう一度お試しください'); }
}
root.addEventListener('click', async e => {
  const button = e.target.closest('button'); if (!button) return;
  if (button.dataset.open) return openBook(button.dataset.open);
  if (button.dataset.view) {
    view = button.dataset.view; query = ''; tag = ''; $('#ps-search').value = ''; render(); $('.ps-content').scrollTop = 0;
    if (view === 'search') $('#ps-search').focus(); return;
  }
  if ('tag' in button.dataset) { tag = button.dataset.tag; render(); return; }
  if (button.dataset.period) { period = button.dataset.period; render(); return; }
  if (button.dataset.edit) return openForm(liveBooks().find(b => b.id === button.dataset.edit));
  if ('add' in button.dataset) return openForm();
  if (button.dataset.fav && !busy) {
    busy = true;
    try {
      await commit({ ...state, books: state.books.map(b => b.id === button.dataset.fav ? { ...b, favorite: !b.favorite, updatedAt: new Date().toISOString() } : b) });
      render();
      const replacement = root.querySelector(`[data-fav="${CSS.escape(button.dataset.fav)}"]`);
      (replacement || root.querySelector('[data-view="favorites"]')).focus({ preventScroll: true });
    } catch { toast('変更を保存できませんでした'); } finally { busy = false; }
  }
});
root.addEventListener('change', e => { if (e.target.id === 'ps-sort') { sort = e.target.value; render(); } });
$('#ps-search').addEventListener('input', e => { query = e.target.value; render(); });
$('#ps-clear').onclick = () => { query = ''; $('#ps-search').value = ''; render(); $('#ps-search').focus(); };
$('#ps-add').onclick = () => openForm();
$('#ps-settings').onclick = settings;
window.addEventListener('pageshow', e => { openLock = false; if (e.persisted) render(); });
try {
  const saved = JSON.parse(sessionStorage.getItem('dt_private_shelf_view_v1'));
  if (saved && titles[saved.view]) { ({ view, query, tag, sort, period } = saved); $('#ps-search').value = query; render(); $('.ps-content').scrollTop = saved.scroll; }
  else render();
} catch { render(); }
