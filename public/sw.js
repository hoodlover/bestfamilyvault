// Bump alongside APP_VERSION in src/lib/branding.ts so the toolbar's version
// number matches what the SW is actually serving.
const CACHE_NAME = 'bestfamilyvault-v320'

// Pages that must be available without network — currently just /offline,
// the encrypted-IndexedDB read-only page family members can use during
// outages. Precaching at install time means the page works even on a fresh
// device that hasn't visited /offline yet.
const PRECACHE_URLS = ['/offline']

// Hard ceiling for any network fetch the SW kicks off. Without this,
// `fetch()` can hang indefinitely on a Vercel cold start, flaky carrier,
// or DNS hiccup — the catch handler never fires (it only triggers on
// rejected promises), the user sees a "still loading" page that never
// resolves, and only a manual refresh aborts it. Promise.race against
// a timer turns hangs into rejections so the SW can serve a fallback.
const FETCH_TIMEOUT_MS = 10_000

function fetchWithTimeout(request, ms = FETCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Object.assign(new Error('sw timeout'), { __swTimeout: true })),
      ms,
    )
    fetch(request).then(
      (r) => { clearTimeout(timer); resolve(r) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

// Tiny self-contained HTML page shown when an HTML navigation times out.
// Auto-reloads after 3s and offers a manual button. No external assets so
// it works even if the rest of the SW cache is empty. Black bg + stone
// text matches the app shell so it doesn't look like an error.
const RETRY_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#1c1917"><title>Still loading…</title><style>html,body{height:100%;margin:0;background:#0c0a09;color:#e7e5e4;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center}.s{width:36px;height:36px;border:3px solid #44403c;border-top-color:#10b981;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}h1{font-size:18px;font-weight:600;margin:0;color:#f5f5f4}p{font-size:13px;color:#a8a29e;margin:0;max-width:340px;line-height:1.5}button{appearance:none;border:1px solid #44403c;background:#1c1917;color:#e7e5e4;font:inherit;font-size:13px;padding:10px 18px;border-radius:8px;cursor:pointer}button:hover{background:#292524}</style></head><body><div class="s" aria-hidden="true"></div><h1>Still loading…</h1><p>The vault is taking a moment to wake up. Reloading automatically.</p><button onclick="location.reload()">Reload now</button><script>setTimeout(function(){location.reload()},3000)</script></body></html>`

function retryResponse() {
  return new Response(RETRY_HTML, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Failure to precache shouldn't block install — the page falls back to
      // network on first visit, then gets cached via the fetch handler below.
      Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)))
    )
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET, cross-origin, and API requests
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  ) {
    return
  }

  // Detect React Server Component requests. router.refresh() and Next.js
  // client-side navigations fetch RSC payloads from the same URL as the
  // HTML page, but with Accept: */* and an RSC: 1 header (older Next
  // versions also use ?_rsc= query params and Next-Router-State-Tree).
  // Without this check those requests fell through to stale-while-
  // revalidate as if they were static assets, which meant the user saw
  // STALE data after every save until a manual refresh forced a full
  // HTML navigation. Treat RSC as network-only, same as HTML.
  const isRscRequest =
    request.headers.get('rsc') === '1' ||
    request.headers.get('next-router-state-tree') !== null ||
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('accept')?.includes('text/x-component') ||
    url.searchParams.has('_rsc')

  // Network-only for HTML pages and RSC payloads. We don't cache authed
  // HTML — it would either leak another user's data or load with a
  // different build's JS hashes after a deploy. EXCEPT for /offline,
  // which is a static-shell page with no server data (vault content
  // lives in IndexedDB) and MUST work without the network. Cache-first
  // with background revalidation.
  if (request.headers.get('accept')?.includes('text/html') || isRscRequest) {
    if (url.pathname === '/offline' || url.pathname === '/offline/') {
      event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
          const cached = await cache.match('/offline')
          const networkPromise = fetchWithTimeout(request)
            .then((response) => {
              if (response.ok) cache.put('/offline', response.clone()).catch(() => {})
              return response
            })
            .catch(() => null)
          if (cached) {
            event.waitUntil(networkPromise)
            return cached
          }
          const fresh = await networkPromise
          return fresh ?? new Response('Offline cache not yet seeded — visit this page once while online.', { status: 503 })
        })
      )
      return
    }
    // Network-only with a hard 10s ceiling. Hangs (cold start, DNS) get
    // converted into a fast 503 + auto-retry HTML page so the user sees
    // forward motion instead of a stuck spinner.
    event.respondWith(fetchWithTimeout(request).catch(() => retryResponse()))
    return
  }

  // Stale-while-revalidate for static assets (JS/CSS/images/fonts).
  //
  // Why this pattern: the previous cache-first strategy meant any bad cache
  // entry stuck around forever, freezing the PWA on stale or partial JS.
  // Now we serve cached immediately for instant load, but ALWAYS fetch
  // fresh in the background and update the cache. Next visit gets the
  // update; the user's current load isn't blocked.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request)
      const networkPromise = fetchWithTimeout(request)
        .then((response) => {
          // Only cache successful responses to avoid poisoning with 404/500
          if (response.ok && response.status === 200) {
            cache.put(request, response.clone()).catch(() => {})
          }
          return response
        })
        .catch(() => null)

      if (cached) {
        // Kick off the revalidation in the background and return cached now
        event.waitUntil(networkPromise)
        return cached
      }

      // No cache — wait for network
      const fresh = await networkPromise
      if (fresh) return fresh
      return new Response('Offline', { status: 503 })
    })
  )
})

self.addEventListener('push', (event) => {
  // Chrome enforces userVisibleOnly:true on every push — if this handler
  // returns without calling showNotification, Chrome substitutes its
  // generic "This site has been updated in the background. Click here
  // for Chrome." notification. So NEVER bail early: always end up calling
  // showNotification, even when event.data is missing or unparseable.
  let data = { title: '', body: '', tag: undefined, url: undefined }
  if (event.data) {
    try {
      const parsed = event.data.json()
      if (parsed && typeof parsed === 'object') data = { ...data, ...parsed }
    } catch {
      // Non-JSON payload — fall back to the raw text as the body.
      try { data.body = event.data.text() } catch { /* keep defaults */ }
    }
  }
  const title = (typeof data.title === 'string' && data.title.trim()) || 'Best Family Vault'
  const body = (typeof data.body === 'string' && data.body.trim()) || 'Tap to open the vault.'
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/cobb/cfv-pwa.png',
      badge: '/icons/cobb/cfv-pwa.png',
      vibrate: [100, 50, 100],
      // tag lets repeat reminders REPLACE the previous one instead of
      // stacking (e.g. yesterday's "Netflix in 3 days" → today's "Netflix
      // in 2 days" on the same surface).
      tag: data.tag,
      // requireInteraction keeps time-sensitive reminders in the shade
      // until the user dismisses them, instead of letting them fade
      // out after a few seconds. Only set when the server flagged it,
      // so routine digests still auto-fade.
      requireInteraction: !!data.requireInteraction,
      // url piggybacks via the notification data so notificationclick
      // can open the right page (defaults to /dashboard).
      data: { url: data.url || '/dashboard' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/dashboard'
  event.waitUntil(
    // If the app is already open in a tab, focus it and navigate.
    // Otherwise open a new window. matchAll keeps push UX coherent
    // with the rest of the SW's window handling.
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const win of wins) {
        if ('focus' in win) {
          win.focus()
          if ('navigate' in win) win.navigate(url)
          return
        }
      }
      return clients.openWindow(url)
    })
  )
})

// Allow the page to ask the SW to skip waiting / take over after an update.
// Useful for the in-app "new version available" prompt if we add one later.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})
