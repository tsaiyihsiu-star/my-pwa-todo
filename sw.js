// v600.342: 照片安全補傳；更新正式站殼層快取。
// v600.341: 完整同步尾段保持互斥；更新正式站殼層快取。
// v600.340: 手動同步補掃與連續訊息視窗修正；更新正式站殼層快取。
// v600.338: 週期衝突處理正式版候選；僅更新正式站殼層快取。
// v600.337: 同步狀態包含週期待傳操作。
// v600.336: 更新正式站殼層快取及更新紀錄文字。
// v600.335: 啟用時只清理正式站舊版快取，保留測試站及其他同源快取。
// v600.334: 首次接管不重載，更新至多重載一次；更新正式版殼層快取。
// v600.333: 同步中網路恢復保留強制補同步，更新正式版殼層快取。
// v600.332: 新任務與客戶 op 即時持久化；更新正式版殼層快取。
// v600.331: 背景恢復網路時保留待補完整同步；更新正式版殼層快取。
// v600.330: 更新正式版殼層快取；客戶 ID 離線關聯與分批同步。
// v600.329: 更新殼層快取版本；主頁週期狀態更新限前景且不執行雲端紀元查詢。
// v600.328: SWR 背景更新交由 fetch event.waitUntil() 承接，避免快取回應後 Worker 提前終止。
// v600.327: 完整同步加入中央背景守門，旁路延後到回前景並閒置後補做。
// v600.326: 背景狀態停止完整同步與閒置計時；回前景後再重新排程。
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
const CACHE_NAME = 'SUPAtodo-v600.342';   // 每次改版必同步 bump
// 程式殼層:SWR(先快取秒開,背景更新);首次無快取時走網路
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './version.json',
  './changelog.html'
];
// 純靜態資源:快取優先即可(不常變)
const STATIC_ASSETS = [
  './icon.png'
];
// 外部關鍵資源：supabase-js 必須和程式殼一起成功預快取。
// v600.296：若 CDN 失敗，新的 Worker 不啟用，也不刪除仍可離線使用的舊快取。
const EXTRA_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.0/dist/umd/supabase.js'
];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 預快取殼層、靜態與登入函式庫；全部成功才允許新版 Worker 安裝完成。
    await cache.addAll(SHELL_ASSETS.concat(STATIC_ASSETS,EXTRA_ASSETS));
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k.startsWith('SUPAtodo-v') && k !== CACHE_NAME ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});
// 判斷是否為「程式殼層」請求(走 SWR)
function isChangelogRequest(req) {
  try { return new URL(req.url).pathname.endsWith('/changelog.html'); } catch (_) { return false; }
}
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
  // v600.266：更新紀錄線上採網路優先；失敗才回退最後成功快取。
  // ignoreSearch 讓 changelog.html?v=版本號 可共用同一份離線後盾，但線上永遠先抓新檔。
  if (isChangelogRequest(req)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok) {
          await cache.put('./changelog.html', fresh.clone());
          return fresh;
        }
      } catch (_) {}
      return (await caches.match('./changelog.html', { ignoreSearch: true }))
        || (await caches.match(req, { ignoreSearch: true }))
        || new Response('目前離線，且尚未下載更新紀錄。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })());
    return;
  }
  // 程式殼層:Stale-While-Revalidate——有快取就秒回,同時背景抓新版更新快取(下次生效)
  if (isShellRequest(req)) {
    // v600.328：在 fetch 事件仍處於 dispatch 期間立即登錄 waitUntil。
    // 即使 respondWith 很快回傳快取，Worker 仍會等待背景抓取與 cache.put 完成。
    const fetchAndUpdate = (async () => {
      const cache = await caches.open(CACHE_NAME);
      let fresh = null;
      try {
        fresh = await fetch(req, { cache: 'no-store' });
      } catch (_) {
        return null;
      }
      if (fresh && fresh.ok) {
        try { await cache.put(req, fresh.clone()); } catch (_) {}
      }
      return fresh;
    })();
    e.waitUntil(fetchAndUpdate.then(() => undefined));
    e.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      // 有快取 → 立刻回快取(秒開)，背景更新由 waitUntil 保持 Worker 存活
      if (cached) {
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



