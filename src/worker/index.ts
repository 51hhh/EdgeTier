export { RelayRoom } from '../durable-objects/relay-room';
export { Directory } from '../durable-objects/directory';

import { handleApi, json, roomStub, validRoom } from '../observer/api';
import { authConfigured, clearSessionCookie, createSessionCookie, credentialsValid, verifyRelayToken, verifySessionRequest } from './auth';
import type { Env } from './env';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/login') return loginPage(env, url, request.headers.get('Accept-Language') ?? '');
    if (url.pathname === '/api/auth/login') return handleLogin(request, env);
    if (url.pathname === '/api/auth/logout') return handleLogout();
    if (url.pathname === '/') return Response.redirect(`${url.origin}/dashboard/`, 302);

    if (!authConfigured(env)) return json({ error: 'auth is not configured' }, 503);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 });
      const roomId = url.searchParams.get('room');
      if (!validRoom(roomId)) return json({ error: 'invalid or missing room name' }, 400);
      const relayToken = await verifyRelayToken(env, url.searchParams.get('token'), roomId);
      if (!relayToken.ok) return json({ error: 'invalid or missing websocket token' }, 401);
      return roomStub(env, roomId).fetch(`https://room/connect?room=${encodeURIComponent(roomId)}`, request);
    }

    const session = await verifySessionRequest(request, env);
    if (!session) return unauthorizedResponse(request, url);

    const api = await handleApi(request, env, session);
    if (api) return api;
    if (url.pathname === '/dashboard') return Response.redirect(`${url.origin}/dashboard/`, 302);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};

async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (!authConfigured(env)) return json({ error: 'auth is not configured' }, 503);
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let username = '';
  let password = '';
  const contentType = request.headers.get('Content-Type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      const body = await request.json() as { username?: unknown; password?: unknown };
      username = typeof body.username === 'string' ? body.username : '';
      password = typeof body.password === 'string' ? body.password : '';
    } else {
      const form = await request.formData();
      username = String(form.get('username') ?? '');
      password = String(form.get('password') ?? '');
    }
  } catch {
    return json({ error: 'invalid login payload' }, 400);
  }

  if (!await credentialsValid(env, username, password)) return json({ error: 'invalid credentials' }, 401);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', await createSessionCookie(env, username));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

function handleLogout(): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', clearSessionCookie());
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

function unauthorizedResponse(request: Request, url: URL): Response {
  if (url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/')) return Response.redirect(`${url.origin}/login`, 302);
  if (request.headers.get('Accept')?.includes('text/html')) return Response.redirect(`${url.origin}/login`, 302);
  return json({ error: 'authentication required' }, 401);
}

type LoginLocale = 'en' | 'zh';

const LOGIN_TEXT: Record<LoginLocale, Record<string, string>> = {
  en: {
    title: 'EdgeTier Login',
    eyebrow: 'Private EdgeTier deployment',
    heading: 'Sign in',
    intro: 'Use the administrator credentials configured with Wrangler secrets.',
    warning: 'Authentication secrets are not configured. Add ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET, and RELAY_TOKEN_SECRET before deployment.',
    username: 'Username',
    password: 'Password',
    submit: 'Sign in',
    badCredentials: 'Invalid username or password.',
    failed: 'Sign in failed.',
  },
  zh: {
    title: 'EdgeTier 登录',
    eyebrow: '私有 EdgeTier 部署',
    heading: '登录',
    intro: '使用 Wrangler secrets 中配置的管理员凭据。',
    warning: '认证 secrets 尚未配置。部署前请添加 ADMIN_USERNAME、ADMIN_PASSWORD、SESSION_SECRET 和 RELAY_TOKEN_SECRET。',
    username: '用户名',
    password: '密码',
    submit: '登录',
    badCredentials: '用户名或密码无效。',
    failed: '登录失败。',
  },
};

function loginLocale(acceptLanguage: string): LoginLocale {
  return acceptLanguage.toLowerCase().includes('zh') ? 'zh' : 'en';
}

function loginPage(env: Env, url: URL, acceptLanguage: string): Response {
  const configured = authConfigured(env);
  const rawNext = url.searchParams.get('next');
  const next = rawNext && /^\/[A-Za-z0-9/_.\-]*$/.test(rawNext) && !rawNext.startsWith('//') ? rawNext : '/dashboard/';
  const locale = loginLocale(acceptLanguage);
  const text = LOGIN_TEXT[locale];
  return new Response(`<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${text.title}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #07111f; color: #f8fafc; }
    main { width: min(420px, calc(100vw - 32px)); border: 1px solid #263449; border-radius: 18px; padding: 28px; background: #0d1726; box-shadow: 0 24px 80px rgb(0 0 0 / 35%); }
    h1 { margin: 0 0 8px; font-size: 1.75rem; }
    p { color: #bac7d8; line-height: 1.5; }
    form { display: grid; gap: 14px; margin-top: 22px; }
    label { display: grid; gap: 6px; color: #dbeafe; font-size: 0.95rem; }
    input { border: 1px solid #334155; border-radius: 10px; padding: 12px; background: #111c2d; color: #f8fafc; font: inherit; }
    button { border: 0; border-radius: 10px; padding: 12px 14px; background: #60a5fa; color: #07111f; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .error { min-height: 1.5em; color: #fca5a5; }
    .warning { border: 1px solid #fbbf24; border-radius: 10px; padding: 10px 12px; color: #fde68a; background: #451a03; }
  </style>
</head>
<body>
  <main>
    <p>${text.eyebrow}</p>
    <h1>${text.heading}</h1>
    <p>${text.intro}</p>
    ${configured ? '' : `<p class="warning">${text.warning}</p>`}
    <form id="login-form">
      <label>${text.username} <input name="username" autocomplete="username" required /></label>
      <label>${text.password} <input name="password" type="password" autocomplete="current-password" required /></label>
      <button type="submit" ${configured ? '' : 'disabled'}>${text.submit}</button>
      <div class="error" id="login-error" role="alert"></div>
    </form>
  </main>
  <script>
    const form = document.getElementById('login-form');
    const error = document.getElementById('login-error');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      const data = new FormData(form);
      const response = await fetch('/api/auth/login', { method: 'POST', body: data });
      if (response.ok) window.location.href = ${JSON.stringify(next)};
      else error.textContent = response.status === 401 ? ${JSON.stringify(text.badCredentials)} : ${JSON.stringify(text.failed)};
    });
  </script>
</body>
</html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
