// Worker entry: /api/inquiry goes to the form handler, /admin and /api/admin/* to the private
// dashboard; everything else is a static asset.
import { onRequestPost, onRequest } from './functions/api/inquiry.js';
import { handleAdmin } from './admin-api.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/inquiry') {
      return request.method === 'POST' ? onRequestPost({ request, env }) : onRequest();
    }
    if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/')) {
      return handleAdmin(request, env);
    }
    if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
