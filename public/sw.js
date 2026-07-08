// Weather Ops 서비스워커 — PWA 오프라인 지원.
// 전략:
//   - 앱 셸(HTML/JS/CSS/아이콘): 설치 시 프리캐시, 이후 stale-while-revalidate
//   - /api/weather: network-first → 실패 시 마지막 성공 응답(오프라인에서 직전 날씨 표시)
//   - 그 외 /api/*: 네트워크 전용 (인증·팀 상태는 캐시하면 안 됨)
// 새 배포 반영: CACHE_VERSION 을 올리면 이전 캐시가 activate 때 정리된다.
const CACHE_VERSION = 'wxops-v34';
// 상대경로: 루트/서브패스(GitHub Pages) 어디에 배포돼도 SW 위치 기준으로 해석됨
const SHELL = [
  './', 'index.html', 'team.html',
  'app.js', 'team.js', 'presets.js', 'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // 날씨 API: 최신 우선, 오프라인이면 마지막 성공 응답
  if (url.pathname.endsWith('/api/weather')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
        .then((res) => res || Response.error())
    );
    return;
  }
  // 인증/팀 등 나머지 API는 절대 캐시하지 않음
  if (url.pathname.includes('/api/')) return;

  // 앱 셸(HTML/JS/CSS): 온라인이면 항상 최신 우선 → 재배포가 즉시 반영됨.
  //   (예전 stale-while-revalidate는 캐시를 먼저 줘서 배포 후에도 구버전이 한 번 더 보였음)
  //   네트워크 실패 시에만 캐시로 폴백 → 오프라인 지원 유지.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((c) => c || Response.error()))
  );
});
