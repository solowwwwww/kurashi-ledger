const scope = new URL(self.registration.scope)
const prefix = 'kurashi-ledger-shell-' + scope.pathname + ':'
const cacheName = prefix + '15'
const assets = [
  './index.html','./styles.css','./app.js','./ledger.mjs','./storage.mjs',
  './interchange.mjs','./salary.mjs','./salary-view.mjs','./expense-icons.mjs','./manifest.webmanifest','./icon-192.png','./icon-512.png'
]
const paths = new Set(assets.map(asset=>new URL(asset,scope).pathname))

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(
    assets.map(asset=>new Request(new URL(asset,scope),{cache:'reload'}))
  )))
})
self.addEventListener('activate',event=>{
  event.waitUntil((async ()=>{
    const keys=await caches.keys()
    await Promise.all(keys.filter(key=>key.startsWith(prefix)&&key!==cacheName).map(key=>caches.delete(key)))
    await self.clients.claim()
  })())
})
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return
  const url=new URL(event.request.url)
  if(url.origin!==scope.origin) return
  if(event.request.mode==='navigate'&&(url.pathname===scope.pathname||url.pathname===scope.pathname+'index.html')) {
    event.respondWith(caches.open(cacheName).then(async cache=>await cache.match(new URL('./index.html',scope))||fetch(event.request)))
  } else if(paths.has(url.pathname)) {
    event.respondWith(caches.open(cacheName).then(async cache=>await cache.match(event.request,{ignoreSearch:true})||fetch(event.request)))
  }
})
