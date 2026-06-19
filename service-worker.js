const APP_VERSION = "2026.06.19.03";
const APP_CACHE = `bladebase-app-${APP_VERSION}`;
const STATIC_CACHE = `bladebase-static-${APP_VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./firebase-config.js",
  "./manifest.json",
  "./version.json",
  "./data/products-fallback.json",
  "./data/parts-fallback.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("bladebase-") && ![APP_CACHE, STATIC_CACHE].includes(key))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/__/auth/")) return;

  if (request.mode === "navigate" || isNetworkFirst(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isCacheFirst(url, request)) {
    event.respondWith(cacheFirst(request));
  }
});

function isNetworkFirst(url) {
  const path = url.pathname.split("/").pop() || "index.html";
  return path === "index.html" ||
    path === "version.json" ||
    path === "products-fallback.json" ||
    path === "parts-fallback.json" ||
    path === "manifest.json" ||
    path.endsWith(".js") ||
    path.endsWith(".css");
}

function isCacheFirst(url, request) {
  return url.pathname.includes("/images/") ||
    url.pathname.includes("/icons/") ||
    request.destination === "image" ||
    /\.(png|jpe?g|webp|gif|svg|ico|woff2?)$/i.test(url.pathname);
}

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  const normalizedRequest = normalizedCacheRequest(request);
  try {
    const fresh = await fetch(new Request(request, { cache: "no-store" }));
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone());
      if (normalizedRequest.url !== request.url) {
        cache.put(normalizedRequest, fresh.clone());
      }
    }
    return fresh;
  } catch (error) {
    const cached = await cache.match(request) || await cache.match(normalizedRequest);
    if (cached) return cached;
    if (request.mode === "navigate") return cache.match("./index.html");
    throw error;
  }
}

function normalizedCacheRequest(request) {
  const url = new URL(request.url);
  url.search = "";
  return new Request(url.toString(), { method: "GET" });
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) cache.put(request, fresh.clone());
  return fresh;
}
