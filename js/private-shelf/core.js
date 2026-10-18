const MAX_URL = 8192;

export function thumbnailUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.href.length > MAX_URL || url.hostname === 'localhost' || url.hostname.endsWith('.local') || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) return '';
    return url.href;
  } catch { return ''; }
}

export function creatorLabel(book) {
  return [...new Set([...(book.authors || []), ...(book.circles || [])])].join(' / ');
}

export function validateBook(input) {
  try {
    const url = new URL(String(input?.url || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, error: 'URL must use HTTP(S)' };
    if (url.username || url.password) return { ok: false, error: 'URL credentials are not allowed' };
    if (url.href.length > MAX_URL) return { ok: false, error: 'URL is too long' };
    if (!String(input?.title || '').trim()) return { ok: false, error: 'title is required' };
    const authors = Array.isArray(input?.authors) ? input.authors.map((v) => String(v).trim()).filter(Boolean) : [];
    const circles = Array.isArray(input?.circles) ? input.circles.map(v => String(v).trim()).filter(Boolean) : [];
    if (!authors.length) return { ok: false, error: 'author is required' };
    if (input.thumbnailUrl && !thumbnailUrl(input.thumbnailUrl)) return { ok: false, error: 'thumbnail URL is invalid' };
    return { ok: true };
  } catch (_) {
    return { ok: false, error: 'URL is invalid' };
  }
}

export function normalizeBook(input, now = new Date().toISOString()) {
  const check = validateBook(input);
  if (!check.ok) throw new Error(check.error);
  const parsed = new URL(String(input.url).trim());
  const authors = [...new Set((input.authors || []).map((v) => String(v).trim()).filter(Boolean))];
  const circles = [...new Set((input.circles || []).map(v => String(v).trim()).filter(Boolean))];
  const tags = [...new Set((input.tags || []).map((v) => String(v).trim()).filter(Boolean))];
  return {
    ...input,
    id: input.id || crypto.randomUUID(), url: parsed.href, urlKey: parsed.href,
    title: String(input.title).trim(), authors, circles, thumbnailUrl: thumbnailUrl(input.thumbnailUrl), tags, favorite: Boolean(input.favorite),
    createdAt: input.createdAt || now, updatedAt: now, deletedAt: input.deletedAt || null,
  };
}

function cloneState(state) {
  return { ...state, books: [...(state.books || [])], openEvents: [...(state.openEvents || [])], recent: [...(state.recent || [])] };
}

export function addOpenEvent(state, bookId, openedAt = new Date().toISOString()) {
  const book = (state.books || []).find((item) => item.id === bookId && !item.deletedAt);
  if (!book) return state;
  const next = cloneState(state);
  next.openEvents.push({ id: crypto.randomUUID(), bookId, openedAt, updatedAt: openedAt, deletedAt: null });
  next.recent = [{ bookId, openedAt }, ...next.recent.filter((item) => item.bookId !== bookId)].slice(0, 6);
  return next;
}

export function recentBooks(state) {
  const byId = new Map((state.books || []).map((book) => [book.id, book]));
  return (state.recent || []).map((item) => byId.get(item.bookId)).filter(Boolean).filter((book) => !book.deletedAt);
}

export function rankBooks(state, { since = null, until = null } = {}) {
  const books = new Map((state.books || []).filter((book) => !book.deletedAt).map((book) => [book.id, book]));
  const rows = new Map();
  for (const event of state.openEvents || []) {
    if (event.deletedAt || !books.has(event.bookId)) continue;
    const time = Date.parse(event.openedAt);
    if (since !== null && time < since) continue;
    if (until !== null && time >= until) continue;
    const row = rows.get(event.bookId) || { book: books.get(event.bookId), count: 0, lastOpenedAt: event.openedAt };
    row.count += 1;
    if (event.openedAt > row.lastOpenedAt) row.lastOpenedAt = event.openedAt;
    rows.set(event.bookId, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || b.lastOpenedAt.localeCompare(a.lastOpenedAt) || a.book.title.localeCompare(b.book.title, 'ja') || a.book.id.localeCompare(b.book.id));
}

export function filterBooks(books, query) {
  const fold = value => String(value).normalize('NFKC').toLocaleLowerCase();
  const terms = fold(query || '').trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...books];
  return books.filter((book) => terms.every((term) => fold([book.title, ...(book.authors || []), ...(book.circles || []), ...(book.tags || [])].join('\u0000')).includes(term)));
}

export function filterBooksByTag(books, tag) {
  const target = String(tag || '').trim();
  return target ? books.filter(book => (book.tags || []).includes(target)) : [...books];
}

export function groupBooksByAuthor(books) {
  const groups = new Map();
  for (const book of books) {
    const author = String(book.authors?.[0] || '').trim() || '作者未設定';
    if (!groups.has(author)) groups.set(author, []);
    groups.get(author).push(book);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a === '作者未設定' ? -1 : b === '作者未設定' ? 1 : a.localeCompare(b, 'ja'))
    .map(([author, groupedBooks]) => ({ author, books: groupedBooks }));
}

// Validate the complete backup before returning a new state. Never replace the current shelf.
export function mergeBackup(current, incoming) {
  const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  if (incoming?.schema !== 'dt-private-shelf' || incoming.version !== 1 || !Array.isArray(incoming.books)) throw new Error('本棚のバックアップではありません。');
  for (const book of incoming.books) {
    if (book?.circles !== undefined && (!Array.isArray(book.circles) || !book.circles.every(v => typeof v === 'string'))) throw new Error('サークルデータが正しくありません。');
    if (!book || typeof book.id !== 'string' || !book.id || !Array.isArray(book.authors) || !Array.isArray(book.tags) || ![...book.authors, ...book.tags].every(v => typeof v === 'string') || !validateBook(book).ok || !validDate(book.createdAt) || !validDate(book.updatedAt) || (book.deletedAt !== null && !validDate(book.deletedAt))) throw new Error('作品データが正しくありません。');
  }
  for (const key of ['openEvents', 'recent', 'vocabulary']) if (incoming[key] !== undefined && !Array.isArray(incoming[key])) throw new Error('バックアップの形式が正しくありません。');
  for (const event of incoming.openEvents || []) if (!event || typeof event.id !== 'string' || typeof event.bookId !== 'string' || !validDate(event.openedAt) || !validDate(event.updatedAt) || (event.deletedAt !== null && !validDate(event.deletedAt))) throw new Error('閲覧記録が正しくありません。');
  for (const item of incoming.recent || []) if (!item || typeof item.bookId !== 'string' || !validDate(item.openedAt)) throw new Error('履歴が正しくありません。');
  for (const item of incoming.vocabulary || []) if (!item || !['author', 'circle', 'tag'].includes(item.kind) || typeof item.label !== 'string' || typeof item.id !== 'string') throw new Error('候補データが正しくありません。');
  const merge = (first, second) => {
    const byId = new Map(first.map(item => [item.id, item]));
    for (const item of second) {
      const existing = byId.get(item.id);
      if (!existing || Date.parse(item.updatedAt || item.createdAt) > Date.parse(existing.updatedAt || existing.createdAt)) byId.set(item.id, item);
    }
    return [...byId.values()];
  };
  const books = merge(current.books, incoming.books.map(b => ({ ...b, urlKey: new URL(b.url).href })));
  const recent = new Map();
  for (const item of [...(current.recent || []), ...(incoming.recent || [])]) {
    if (!recent.has(item.bookId) || Date.parse(item.openedAt) > Date.parse(recent.get(item.bookId).openedAt)) recent.set(item.bookId, item);
  }
  return { ...current, books, openEvents: merge(current.openEvents || [], incoming.openEvents || []), vocabulary: merge(current.vocabulary || [], incoming.vocabulary || []), recent: [...recent.values()].filter(r => books.some(b => b.id === r.bookId && !b.deletedAt)).sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt)).slice(0, 6) };
}

export function emptyState() {
  return { schema: 'dt-private-shelf', version: 1, books: [], vocabulary: [], recent: [], openEvents: [] };
}
