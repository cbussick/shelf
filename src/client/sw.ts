/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { stageShare } from './incoming-share';

// This module is the service-worker entry, not a Window script. Workbox replaces
// this exact self.__WB_MANIFEST expression with its generated manifest at build time.
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0] };
const worker = self;
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
  denylist: [/^\/api\//, /^\/share-target$/],
}));
registerRoute(
  ({ url, request }) => url.origin === worker.location.origin && url.pathname.startsWith('/api/images/') && !request.headers.has('range'),
  new CacheFirst({
    cacheName: 'shelf-images',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      // Videos share attachment URLs, but must not fill the image cache or serve
      // a cached full response to a native player's byte-range request.
      { cacheWillUpdate: async ({ response }) => response.status === 200 && response.headers.get('content-type')?.startsWith('image/') ? response : null },
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  }),
);

worker.addEventListener('message', event => {
  const data: unknown = event.data;
  if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'SKIP_WAITING') {void worker.skipWaiting();}
});

worker.addEventListener('fetch', event => {
  if (event.request.method !== 'POST' || new URL(event.request.url).pathname !== '/share-target') {return;}
  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const files = form.getAll('images');
      if (!files.length || files.length > 6 || !files.every((value): value is File =>
        value instanceof File &&
        ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(value.type) &&
        value.size <= 20 * 1024 * 1024 && value.size !== 0
      )) {return Response.redirect('/?shareError=invalid', 303);}
      const id = await stageShare(files);
      return Response.redirect(`/?share=${encodeURIComponent(id)}`, 303);
    } catch {
      return Response.redirect('/?shareError=storage', 303);
    }
  })());
});
