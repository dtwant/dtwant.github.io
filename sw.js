/* dt's world Service Worker
*
* 役割は1つだけ: ページ（HTML）への移動は必ずネットから取り直す。
* GitHub Pages は max-age=600 で配信するため、デプロイ直後のページが
* 最大10分キャッシュに残り「直ってない」状態になる。これを防ぐ。
* JS/CSS/画像など他のリクエストには一切介入しない（ブラウザ標準動作）。
*
* オフライン時は最後に取得できたページのコピーを返す。
*
* このファイルの中身を以下に差し替えてデプロイすると、
* 全端末で Service Worker が自己解除され、ブラウザ標準動作に戻る:
*
* self.addEventListener('install', () => self.skipWaiting());
* self.addEventListener('activate', () => {
* self.registration.unregister();
* self.clients.matchAll().then(cs => cs.forEach(c => c.navigate(c.url)));
*});
*/
const CACHE_NAME = 'dt-pages-v1';

self.addEventListener('install', () => {
self.skipWaiting();
});

self.addEventListener('activate', (event) => {
event.waitUntil((async () => {
const keys = await caches.keys();
await Promise.all(keys.filter(k => k!== CACHE_NAME).map(k => caches.delete(k)));
await self.clients.claim();
})());
});

self.addEventListener('fetch', (event) => {
const { request} = event;
if (request.mode!== 'navigate') return; // ページ移動以外は介入しない
event.respondWith((async () => {
try {
// cache:'no-cache' が必須。素の fetch(request) だと、ブラウザの HTTP キャッシュ
// (max-age=600) が新鮮なうちは SW に古いコピーが渡り、ネット優先が無効化される。
const fresh = await fetch(request, { cache: 'no-cache' });
if (fresh && fresh.ok) {
const cache = await caches.open(CACHE_NAME);
cache.put(request, fresh.clone());
}
return fresh;
} catch (_) {
const cache = await caches.open(CACHE_NAME);
const cached = await cache.match(request);
if (cached) return cached;
throw _;
}
})());
});
