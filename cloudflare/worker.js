// Worker entry: /api/inquiry goes to the form handler; everything else is a static asset.
import { onRequestPost, onRequest } from './functions/api/inquiry.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/inquiry') {
      return request.method === 'POST' ? onRequestPost({ request, env }) : onRequest();
    }
    if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
