// 一度開いたら電波がなくても使えるように、アプリ本体を端末に保存する。
// 避難場所データ・地図・住所検索は保存しない（古い情報を出さないため。自宅の周りの結果は app.js が端末に保存する）。
const CACHE = 'bousai-v3';
const APP_FILES = ['./', 'index.html', 'style.css', 'data.js', 'app.js', 'manifest.json', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 保存した物をすぐ返し、裏で新しい物に入れ替える（電波が弱くても待たされない）。
// 保存した物がないときだけ通信を待つ。
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const update = fetch(e.request)
    .then(async (res) => {
      if (res.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(e.request, res.clone());
      }
      return res;
    });
  e.waitUntil(update.catch(() => {}));
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true })
      .then((cached) => cached || update),
  );
});
