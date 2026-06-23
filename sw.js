/* NASON HOME — service worker (PR3: tự làm mới)
   - HTML / điều hướng: NETWORK-FIRST → luôn lấy bản mới nhất khi online; offline thì dùng cache.
   - Asset tĩnh (icon/manifest): CACHE-FIRST → tải nhanh.
   Nhờ network-first cho HTML, cập nhật index.html KHÔNG còn bị kẹt bản cũ — KHÔNG cần đổi version tay nữa.
   (Version chỉ để dọn cache asset cũ; vẫn nên đổi khi đổi danh sách icon/asset.) */
const CACHE = 'nason-home-v7';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS).catch(() => {}))   // 1 asset lỗi cũng không chặn cài đặt
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isHTML(req) {
  if (req.mode === 'navigate') return true;
  const a = req.headers.get('accept') || '';
  return a.indexOf('text/html') >= 0;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let sameOrigin = false;
  try { sameOrigin = new URL(req.url).origin === self.location.origin; } catch (_) {}

  // HTML / điều hướng → NETWORK-FIRST (luôn mới khi online; cache khi offline)
  if (sameOrigin && isHTML(req)) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // Asset tĩnh same-origin → CACHE-FIRST (nhanh; nền tự cập nhật cache)
  if (sameOrigin) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const net = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
    return;
  }
  // Khác origin (Firebase / SheetJS CDN…) → để trình duyệt xử lý mặc định
});
