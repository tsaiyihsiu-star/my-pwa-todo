// ============================================================
// 宜修待辦 Supabase 世代 Service Worker（正式版 index.html 用）
// v600.69: Stale-While-Revalidate（先舊後新）——解「長時間背景/導航後冷啟動變慢」。
//          開 App 立刻用快取殼層顯示(秒開),同時背景抓新版存快取,新版下次開啟生效。
//          兼顧:秒開 + 版本仍更新(延後一次) + iOS 不卡永久舊版(背景持續抓+前端 version.json 檢查會提示)。
//          取代 v600.62 的純網路優先(每次開啟等網路抓 index.html,行動網路冷啟動慢)。
// v600.117: ERP 內網 API(http 內網 IP)完全不經過 SW——原本掉進「其他靜態資源」處理,
//          在 SW 更新/啟動接管期會造成第一次 fetch 失敗,要多按幾次匯入才成功。改為直接放行走原生網路。
// v600.129: R17 安全性修正——supabase-js 改釘死確切版本(2.112.0)+ 確切檔案路徑,
//          搭配 index.html 加的 SRI 完整性驗證。這裡的快取網址要跟 index.html 引用的
//          網址完全一致，否則會快取到舊網址、離線時反而讀不到(取不到，不是壞掉，只是
//          白白浪費這格快取)。之後升級 supabase-js 版本時，這裡跟 index.html 要一起改。
// ============================================================
const CACHE_NAME = 'SUPAtodo-v600.129';   // 每次改版必同步 bump
// 程式殼層:SWR(先快取秒開,背景更新);首次無快取時走網路
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './version.json'
];
// 純靜態資源:快取優先即可(不常變)
const STATIC_ASSETS = [
  './icon.png'
];
// 外部資源:非致命
// v600 重要:supabase-js 必須快取——離線開 App 時認證閘才起得來(getSession 走本機)
const EXTRA_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.0/dist/umd/supabase.js'
];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 預快取殼層+靜態(離線後盾+SWR 首屏);外部非致命
    await cache.addAll(SHELL_ASSETS.concat(STATIC_ASSETS));
    await Promise.allSettled(EXTRA_ASSETS.map(u => cache.add(u)));
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});
// 判斷是否為「程式殼層」請求(走 SWR)
function isShellRequest(req) {
  if (req.mode === 'navigate') return true;               // 開 App 的導覽請求
  const u = req.url;
  return u.endsWith('/index.html') || u.endsWith('/')
      || u.includes('version.json') || u.endsWith('/manifest.json');
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Supabase/Google API 一律不快取(資料與認證必須即時)
  const u = req.url;
  if (u.includes('supabase.co') || u.includes('googleapis.com')
      || u.includes('script.google.com') || u.includes('generativelanguage')) return;
  // v600.117: ERP 內網 API 完全不經過 SW(http 內網 IP,SW 攔截會在更新/啟動接管期造成第一次失敗要多按)
  if (u.includes('192.168.') || u.includes('/api/health') || u.includes('/api/query')) return;
  // 程式殼層:Stale-While-Revalidate——有快取就秒回,同時背景抓新版更新快取(下次生效)
  if (isShellRequest(req)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await caches.match(req, { ignoreSearch: true });
      // 背景抓新版(不擋當前顯示):成功就更新快取,供「下次開啟」使用
      const fetchAndUpdate = fetch(req, { cache: 'no-store' }).then(fresh => {
        if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      }).catch(() => null);
      // 有快取 → 立刻回快取(秒開),背景更新自己跑
      if (cached) {
        fetchAndUpdate;   // 不 await,背景進行
        return cached;
      }
      // 無快取(首次/快取被清) → 等網路,拿到順手存
      const fresh = await fetchAndUpdate;
      if (fresh) return fresh;
      // 網路也失敗(離線且無快取):navigate 退 index.html/根
      if (req.mode === 'navigate') {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
      return Response.error();
    })());
    return;
  }
  // 其他靜態資源:快取優先、網路後備
  e.respondWith(
    caches.match(req).then(r => r || fetch(req).catch(() => r || Response.error()))
  );
});
