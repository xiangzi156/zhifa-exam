/* 执法业务学习助手 —— Service Worker（只做「平台访问码自愈」，不缓存任何文件）
 *
 * 背景：平台网关要求 cookie __wb_rsc（有效期 30 天）。到期后，即使是最短的裸域名
 *       https://zhifa-exam.app.workbuddy.host/ 也会被网关直接回 403「链接不完整」——
 *       响应根本到不了我们的页面，页面里的 JS 一行都不会执行，所以「自动补 sharecode」
 *       那种前端写法救不了它。SW 是唯一能在页面之前插手的一层：
 *       收到网关这个 403 → 把 sharecode 参数补进 URL 重试一次 → 网关重新下发 cookie →
 *       队员看到的还是原来的短链接地址，内容正常，一个月后还能接着用。
 *
 * 刻意不做缓存（不 precache、不 cache-first、不 cache.put）：
 *   发新版后手机必须立即拿到新页面，考试系统绝不能出现「缓存里是旧卷子」。
 */
var SHARECODE = 'RGLXCB2RLZ';

/* 只认网关门禁页：HTML + 403。后端自己的 401/403 是 JSON，绝不能重试（会重复提交） */
function isGateResponse(res) {
  if (!res || res.status !== 403) return false;
  var ct = String(res.headers.get('content-type') || '').toLowerCase();
  return ct.indexOf('text/html') !== -1;
}

/* 返回「补了 sharecode 的 URL」；不适用时返回 null */
function retryUrlOf(raw) {
  try {
    var u = new URL(raw, self.location.href);
    if (u.origin !== self.location.origin) return null;      /* 跨域不插手 */
    if (!SHARECODE) return null;
    if (u.searchParams.get('sharecode') === SHARECODE) return null;  /* 已经带过了，不绕圈 */
    u.searchParams.set('sharecode', SHARECODE);
    return u.toString();
  } catch (e) { return null; }
}

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET' && req.method !== 'POST') return;

  var retryUrl = retryUrlOf(req.url);
  if (!retryUrl) return;

  /* POST 要先 clone：请求体只能读一次，且 navigation 请求不能作为 Request 构造参数复用 */
  var copy = null;
  if (req.method === 'POST') {
    try { copy = req.clone(); } catch (e) { return; }   /* 克隆不了就完全放行，保持原行为 */
  }

  ev.respondWith(
    fetch(req).then(function (res) {
      if (!isGateResponse(res)) return res;
      var next = copy
        ? new Request(retryUrl, copy)
        : new Request(retryUrl, { method: 'GET', credentials: 'include' });
      return fetch(next).catch(function () { return res; });
    }).catch(function () {
      /* 断网等网络层错误：保持原样报错，交给页面自己的重试/补传机制 */
      return Response.error();
    })
  );
});
