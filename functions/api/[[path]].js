const SESSION_COOKIE = 'lumisynth_session';
const SESSION_DAYS = 30;
const CHALLENGE_MINUTES = 10;
const MAX_PRESET_BYTES = 200_000;

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...jsonHeaders, ...headers },
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

function requireEnv(env, key) {
  const value = env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function futureIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function randomId() {
  return crypto.randomUUID();
}

function randomCode() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const n = new DataView(bytes.buffer).getUint32(0) % 1_000_000;
  return n.toString().padStart(6, '0');
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getCookie(request, name) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return '';
}

function cookieSecurity(request) {
  return new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
}

function sessionCookie(request, sessionId, expiresAt) {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly;${cookieSecurity(request)} SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`;
}

function clearSessionCookie(request) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly;${cookieSecurity(request)} SameSite=Lax; Max-Age=0`;
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch (_) {
    return {};
  }
}

async function sendLoginEmail(env, email, code) {
  if (env.AUTH_DEV_MODE === 'true') return { devCode: code };

  const apiKey = requireEnv(env, 'RESEND_API_KEY');
  const from = requireEnv(env, 'AUTH_FROM_EMAIL');
  const appOrigin = requireEnv(env, 'APP_ORIGIN');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: 'Your LumiSynth login code',
      text: `Your LumiSynth login code is ${code}. It expires in ${CHALLENGE_MINUTES} minutes.\n\nOpen ${appOrigin}`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Login email failed: ${res.status} ${body}`);
  }
  return {};
}

async function currentUser(env, request) {
  const sessionId = getCookie(request, SESSION_COOKIE);
  if (!sessionId) return null;
  const row = await env.DB.prepare(
    `SELECT users.id, users.email, sessions.expires_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ?`
  ).bind(sessionId).first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    return null;
  }
  return { id: row.id, email: row.email };
}

async function requireUser(env, request) {
  const user = await currentUser(env, request);
  if (!user) return { response: error('Login required', 401) };
  return { user };
}

async function handleAuthStart(request, env) {
  const body = await parseJson(request);
  const email = normalizeEmail(body.email);
  if (!validEmail(email)) return error('Valid email required');

  const code = randomCode();
  const codeHash = await sha256Hex(code);
  await env.DB.prepare(
    'INSERT INTO auth_challenges (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(randomId(), email, codeHash, futureIso(CHALLENGE_MINUTES * 60 * 1000)).run();

  const emailMeta = await sendLoginEmail(env, email, code);
  return json({
    ok: true,
    message: 'Login code sent',
    ...emailMeta,
  });
}

async function handleAuthVerify(request, env) {
  const body = await parseJson(request);
  const email = normalizeEmail(body.email);
  const code = String(body.code || '').trim();
  if (!validEmail(email) || !/^\d{6}$/.test(code)) return error('Valid email and 6-digit code required');

  const codeHash = await sha256Hex(code);
  const challenge = await env.DB.prepare(
    `SELECT id
     FROM auth_challenges
     WHERE email = ? AND code_hash = ? AND used_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(email, codeHash, nowIso()).first();
  if (!challenge) return error('Invalid or expired code', 401);

  await env.DB.prepare('UPDATE auth_challenges SET used_at = ? WHERE id = ?').bind(nowIso(), challenge.id).run();

  let user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).first();
  if (!user) {
    user = { id: randomId(), email };
    await env.DB.prepare('INSERT INTO users (id, email, created_at, last_login_at) VALUES (?, ?, ?, ?)')
      .bind(user.id, email, nowIso(), nowIso())
      .run();
  } else {
    await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowIso(), user.id).run();
  }

  const sessionId = randomId();
  const expiresAt = futureIso(SESSION_DAYS * 24 * 60 * 60 * 1000);
  await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(sessionId, user.id, expiresAt)
    .run();

  return json({ user }, 200, { 'Set-Cookie': sessionCookie(request, sessionId, expiresAt) });
}

async function handleLogout(request, env) {
  const sessionId = getCookie(request, SESSION_COOKIE);
  if (sessionId) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(request) });
}

async function handleListPresets(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const rows = await env.DB.prepare(
    `SELECT id, name, state_json, created_at, updated_at
     FROM presets
     WHERE user_id = ?
     ORDER BY updated_at DESC`
  ).bind(auth.user.id).all();
  const presets = (rows.results || []).map((p) => ({
    ...p,
    state: JSON.parse(p.state_json),
    state_json: undefined,
  }));
  return json({ presets });
}

async function handleCreatePreset(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const body = await parseJson(request);
  const name = String(body.name || 'Untitled preset').trim().slice(0, 80) || 'Untitled preset';
  const stateJson = JSON.stringify(body.state || {});
  if (stateJson.length > MAX_PRESET_BYTES) return error('Preset is too large', 413);

  const id = randomId();
  await env.DB.prepare(
    'INSERT INTO presets (id, user_id, name, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, auth.user.id, name, stateJson, nowIso(), nowIso()).run();
  return json({ preset: { id, name, state: JSON.parse(stateJson) } }, 201);
}

async function handleUpdatePreset(request, env, id) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const body = await parseJson(request);
  const name = String(body.name || 'Untitled preset').trim().slice(0, 80) || 'Untitled preset';
  const stateJson = JSON.stringify(body.state || {});
  if (stateJson.length > MAX_PRESET_BYTES) return error('Preset is too large', 413);

  const result = await env.DB.prepare(
    'UPDATE presets SET name = ?, state_json = ?, updated_at = ? WHERE id = ? AND user_id = ?'
  ).bind(name, stateJson, nowIso(), id, auth.user.id).run();
  if (!result.meta || result.meta.changes === 0) return error('Preset not found', 404);
  return json({ preset: { id, name, state: JSON.parse(stateJson) } });
}

async function handleDeletePreset(request, env, id) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  await env.DB.prepare('DELETE FROM presets WHERE id = ? AND user_id = ?').bind(id, auth.user.id).run();
  return json({ ok: true });
}

async function handleExportEvent(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const body = await parseJson(request);
  const type = body.type === 'recording' ? 'recording' : 'snapshot';
  await env.DB.prepare('INSERT INTO export_events (id, user_id, type, created_at) VALUES (?, ?, ?, ?)')
    .bind(randomId(), auth.user.id, type, nowIso())
    .run();
  return json({ ok: true });
}

async function route(request, env) {
  if (!env.DB) return error('Missing D1 binding: DB', 500);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '') || '/';

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method === 'POST' && path === '/auth/start') return handleAuthStart(request, env);
  if (request.method === 'POST' && path === '/auth/verify') return handleAuthVerify(request, env);
  if (request.method === 'POST' && path === '/auth/logout') return handleLogout(request, env);
  if (request.method === 'GET' && path === '/me') return json({ user: await currentUser(env, request) });
  if (request.method === 'GET' && path === '/presets') return handleListPresets(request, env);
  if (request.method === 'POST' && path === '/presets') return handleCreatePreset(request, env);
  if (request.method === 'PUT' && path.startsWith('/presets/')) return handleUpdatePreset(request, env, path.split('/')[2]);
  if (request.method === 'DELETE' && path.startsWith('/presets/')) return handleDeletePreset(request, env, path.split('/')[2]);
  if (request.method === 'POST' && path === '/export-events') return handleExportEvent(request, env);

  return error('Not found', 404);
}

export async function onRequest(context) {
  try {
    return await route(context.request, context.env);
  } catch (err) {
    return error(err.message || 'Internal error', 500);
  }
}
