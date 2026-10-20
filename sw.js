/* 离线缓存：让读者第二次打开时零网络请求，断网/弱网也能读。
   策略：
     - 页面导航：网络优先，但只等 2.5 秒；超时或失败立刻用缓存，避免弱网干等
     - 文章正文 / 图片：缓存优先，后台静默更新（正文变化不频繁，先给内容更重要）
   版本号变了才会重新装，旧缓存自动清掉。 */
const VER = 'nb-v3';
const SHELL = ['/', '/index.html', '/posts.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VER)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VER).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req, timeoutMs) {
  const cache = await caches.open(VER);
  const net = fetch(req)
    .then((r) => {
      if (r && r.ok) cache.put(req, r.clone());
      return r;
    })
    .catch(() => null);

  const timedOut = await Promise.race([
    net,
    new Promise((res) => setTimeout(() => res('__timeout__'), timeoutMs))
  ]);

  if (timedOut && timedOut !== '__timeout__') return timedOut;

  const cached =
    (await cache.match(req)) ||
    (await cache.match('/index.html')) ||
    (await cache.match('/'));
  if (cached) return cached;

  return (await net) || Response.error();
}

async function cacheFirst(req) {
  const cache = await caches.open(VER);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then((r) => {
      if (r && r.ok) cache.put(req, r.clone());
      return r;
    })
    .catch(() => null);
  if (hit) {
    net.catch(() => {}); /* 后台静默更新，不阻塞返回 */
    return hit;
  }
  return (await net) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return; /* 只管本站，别碰 Supabase */

  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, 2500));
    return;
  }
  if (/\/articles\/[^/]+\.json$/.test(url.pathname) ||
      /\/posts\.json$/.test(url.pathname) ||
      /\/img\//.test(url.pathname)) {
    e.respondWith(cacheFirst(req));
  }
});
