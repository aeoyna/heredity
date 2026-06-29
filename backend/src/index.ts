import { D1Database, ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';
import { evolveThread, mutateLineDNA, mutateMosaicDNA } from './ga';
import Stripe from 'stripe';
import { 
  generateRandomLineDNA, 
  generateRandomMosaicDNA, 
  generateHoneypotLineDNA, 
  generateHoneypotMosaicDNA,
  LineDNA,
  MosaicDNA
} from './shared-types';
import { parseCookies, signJWT, verifyJWT, base64UrlToJson } from './auth';
import { verifyGoogleIdToken } from './google-auth';
import { mergeGameStates, GameState } from './sync-logic';

export interface Env {
  DB: D1Database;
  TURNSTILE_SECRET?: string;
  ADMIN_SECRET?: string;
  JWT_SECRET?: string;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

// CORS Headers Helper
function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('Origin') || '*';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin === 'null' ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, cf-turnstile-response, x-session-id, Cookie',
    'Access-Control-Max-Age': '86400',
  };
  if (origin !== '*' && origin !== 'null') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

interface SpecimenCardRow {
  id: string;
  generation: number;
  dna: string;
  assigned_session_id: string | null;
  assigned_at: string | null;
}

function buildNotInClause(ids: string[], column = 'id'): { clause: string; params: string[] } {
  if (ids.length === 0) {
    return { clause: '', params: [] };
  }

  return {
    clause: ` AND ${column} NOT IN (${ids.map(() => '?').join(',')})`,
    params: ids
  };
}

let threadsHasLineCountColumn: boolean | null = null;

async function hasThreadsLineCountColumn(db: D1Database): Promise<boolean> {
  if (threadsHasLineCountColumn !== null) {
    return threadsHasLineCountColumn;
  }

  const { results } = await db.prepare("PRAGMA table_info(threads)").all<{ name: string }>();
  threadsHasLineCountColumn = (results ?? []).some(row => row.name === 'line_count');
  return threadsHasLineCountColumn;
}

const SOUL_GRANT_EXPIRY_MS = 180 * 24 * 60 * 60 * 1000;

async function ensureUserSessionRow(db: D1Database, sessionId: string, now: number): Promise<void> {
  await db.prepare(
    "INSERT OR IGNORE INTO user_sessions (session_id, stamina, max_stamina, last_recovery_time, souls, souls_version) VALUES (?, 80, 80, ?, 0, 0)"
  ).bind(sessionId, now).run();
}

async function expireSoulGrants(db: D1Database, sessionId: string, now: number): Promise<number> {
  const expiredRows = await db.prepare(
    `SELECT id, remaining_amount
     FROM soul_grants
     WHERE session_id = ? AND status = 'active' AND remaining_amount > 0 AND expires_at <= ?
     ORDER BY expires_at ASC, issued_at ASC, id ASC`
  ).bind(sessionId, now).all<{ id: string; remaining_amount: number }>();

  const rows = expiredRows.results ?? [];
  const expiredAmount = rows.reduce((sum, row) => sum + (row.remaining_amount ?? 0), 0);
  if (rows.length > 0) {
    const nowIso = new Date(now).toISOString();
    for (const row of rows) {
      await db.prepare(
        `UPDATE soul_grants
         SET status = 'expired',
             remaining_amount = 0,
             updated_at = ?
         WHERE id = ?`
      ).bind(nowIso, row.id).run();
    }
  }

  return expiredAmount;
}

async function spendPurchasedSoulGrants(db: D1Database, sessionId: string, amount: number, now: number): Promise<number> {
  if (amount <= 0) {
    return 0;
  }

  const activeRows = await db.prepare(
    `SELECT id, remaining_amount
     FROM soul_grants
     WHERE session_id = ? AND status = 'active' AND remaining_amount > 0 AND expires_at > ?
     ORDER BY expires_at ASC, issued_at ASC, id ASC`
  ).bind(sessionId, now).all<{ id: string; remaining_amount: number }>();

  let remainingToSpend = amount;
  const nowIso = new Date(now).toISOString();

  for (const row of activeRows.results ?? []) {
    if (remainingToSpend <= 0) {
      break;
    }

    const spend = Math.min(row.remaining_amount ?? 0, remainingToSpend);
    const nextRemaining = Math.max(0, (row.remaining_amount ?? 0) - spend);
    const nextStatus = nextRemaining === 0 ? 'consumed' : 'active';

    await db.prepare(
      `UPDATE soul_grants
       SET remaining_amount = ?,
           status = ?,
           updated_at = ?
       WHERE id = ?`
    ).bind(nextRemaining, nextStatus, nowIso, row.id).run();

    remainingToSpend -= spend;
  }

  return amount - remainingToSpend;
}

async function reconcileSoulBalance(
  db: D1Database,
  sessionId: string,
  targetSouls: number,
  clientSoulsVersion: number,
  now = Date.now()
): Promise<{ souls: number; soulsVersion: number }> {
  await ensureUserSessionRow(db, sessionId, now);

  const row = await db.prepare(
    "SELECT souls, souls_version FROM user_sessions WHERE session_id = ?"
  ).bind(sessionId).first<{ souls: number; souls_version: number }>();

  const rowSouls = Math.max(0, row?.souls ?? 0);
  const rowVersion = Math.max(0, row?.souls_version ?? 0);
  let currentSouls = rowSouls;
  const currentVersion = rowVersion;
  const expiredAmount = await expireSoulGrants(db, sessionId, now);
  currentSouls = Math.max(0, currentSouls - expiredAmount);

  const target = Math.max(0, targetSouls);
  const canSpendDown = clientSoulsVersion >= currentVersion;

  if (target < currentSouls && canSpendDown) {
    const delta = currentSouls - target;
    await spendPurchasedSoulGrants(db, sessionId, delta, now);
    currentSouls = target;
  } else if (target >= currentSouls) {
    currentSouls = target;
  }

  const nextVersion = Math.max(currentVersion, clientSoulsVersion);
  if (currentSouls !== rowSouls || nextVersion !== rowVersion) {
    await db.prepare(
      "UPDATE user_sessions SET souls = ?, souls_version = MAX(COALESCE(souls_version, 0), ?) WHERE session_id = ?"
    ).bind(currentSouls, nextVersion, sessionId).run();
  }

  return {
    souls: currentSouls,
    soulsVersion: nextVersion
  };
}

async function fetchAssignedCardsForSession(
  db: D1Database,
  threadId: string,
  generation: number,
  sessionId: string,
  excludeIds: string[]
): Promise<{ id: string; generation: number; dna: string; is_honeypot: number }[]> {
  const { clause, params } = buildNotInClause(excludeIds);
  const query = `
    SELECT id, generation, dna, is_honeypot
    FROM specimens
    WHERE thread_id = ? AND generation = ? AND status = 'active' AND assigned_session_id = ?
    ${clause}
    ORDER BY assigned_at ASC, id ASC
    LIMIT 20
  `;

  const { results } = await db.prepare(query).bind(threadId, generation, sessionId, ...params).all<{ id: string; generation: number; dna: string; is_honeypot: number }>();
  return results;
}

async function claimCardsForSession(
  db: D1Database,
  threadId: string,
  generation: number,
  sessionId: string,
  count: number,
  excludeIds: string[] = []
): Promise<number> {
  if (count <= 0) {
    return 0;
  }

  const nowStr = new Date().toISOString();
  const { clause, params } = buildNotInClause(excludeIds);
  const selectQuery = `
    SELECT id
    FROM specimens
    WHERE thread_id = ? AND generation = ? AND status = 'active' AND assigned_session_id IS NULL
    ${clause}
    ORDER BY RANDOM()
    LIMIT ?
  `;

  const { results } = await db.prepare(selectQuery).bind(threadId, generation, ...params, count).all<{ id: string }>();
  const ids = results.map(row => row.id);

  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    await db.prepare(
      `UPDATE specimens
       SET assigned_session_id = ?, assigned_at = ?
       WHERE thread_id = ? AND generation = ? AND status = 'active' AND assigned_session_id IS NULL AND id IN (${placeholders})`
    ).bind(sessionId, nowStr, threadId, generation, ...ids).run();
  }

  return ids.length;
}

async function authenticateSession(request: Request, env: Env): Promise<{ session_id: string; type: string } | Response> {
  const cookies = parseCookies(request);
  let token = cookies['auth_token'];

  if (!token) {
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }

  if (!token) {
    const sessionHeader = request.headers.get('x-session-id');
    if (sessionHeader) {
      token = sessionHeader;
    }
  }

  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Missing authentication token.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  const jwtSecret = env.JWT_SECRET || 'dev-secret-key';
  const payload = await verifyJWT(token, jwtSecret);
  if (!payload || !payload.session_id) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Invalid or expired token.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // Check if session exists and is not banned
  const session = await env.DB.prepare(
    "SELECT banned FROM user_sessions WHERE session_id = ?"
  ).bind(payload.session_id).first<{ banned: number }>();

  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Session has expired or been replaced.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  if (session.banned === 1) {
    return new Response(JSON.stringify({ error: 'Forbidden. Your account has been permanently suspended.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  return { session_id: payload.session_id, type: payload.type || 'anonymous' };
}

// POST /api/auth/anonymous
async function handlePostAnonymousAuth(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ turnstile_token?: string }>().catch(() => ({ turnstile_token: undefined }));
  const turnstileToken = body.turnstile_token;
  const turnstileSecret = env.TURNSTILE_SECRET;
  
  if (turnstileSecret && turnstileToken) {
    const clientIP = request.headers.get('CF-Connecting-IP') || '';
    const formData = new FormData();
    formData.append('secret', turnstileSecret);
    formData.append('response', turnstileToken);
    formData.append('remoteip', clientIP);

    const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData
    });

    const verifyResult = await verifyResponse.json() as { success: boolean };
    if (!verifyResult.success) {
      return new Response(JSON.stringify({ error: 'Turnstile verification failed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
      });
    }
  }

  const sessionId = `session_${crypto.randomUUID()}`;
  const nowStr = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO user_sessions (session_id, clerk_user_id, daily_swipes, bot_flag, banned, last_swipe_at) VALUES (?, NULL, 0, 0, 0, ?)"
  ).bind(sessionId, nowStr).run();

  const jwtSecret = env.JWT_SECRET || 'dev-secret-key';
  const exp = Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 365);
  const jwt = await signJWT({ session_id: sessionId, type: 'anonymous', exp }, jwtSecret);

  const cookie = `auth_token=${jwt}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;

  return new Response(JSON.stringify({ success: true, session_id: sessionId, type: 'anonymous', token: jwt }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
      ...corsHeaders(request)
    }
  });
}

// POST /api/auth/upgrade
async function handlePostUpgradeAuth(request: Request, env: Env): Promise<Response> {
  const currentSessionOrResponse = await authenticateSession(request, env);
  if (currentSessionOrResponse instanceof Response) {
    return currentSessionOrResponse;
  }
  
  const body = await request.json<{ clerk_token?: string }>().catch(() => ({ clerk_token: undefined }));
  const clerkToken = body.clerk_token;
  if (!clerkToken || clerkToken !== 'mock_developer_token') {
    return new Response(JSON.stringify({ error: 'Unauthorized token upgrade' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  const clerkUserId = `mock_user_${crypto.randomUUID().slice(0, 8)}`;
  const sessionId = currentSessionOrResponse.session_id;

  await env.DB.prepare(
    "UPDATE user_sessions SET clerk_user_id = ? WHERE session_id = ?"
  ).bind(clerkUserId, sessionId).run();

  const jwtSecret = env.JWT_SECRET || 'dev-secret-key';
  const exp = Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 365);
  const jwt = await signJWT({ session_id: sessionId, clerk_user_id: clerkUserId, type: 'authenticated', exp }, jwtSecret);

  const cookie = `auth_token=${jwt}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;

  return new Response(JSON.stringify({ success: true, session_id: sessionId, clerk_user_id: clerkUserId, type: 'authenticated', token: jwt }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
      ...corsHeaders(request)
    }
  });
}

// GET /api/auth/google/login
async function handleGetGoogleLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const redirectBack = url.searchParams.get('redirect_back') || '';

  if (!env.GOOGLE_CLIENT_ID) {
    return new Response(JSON.stringify({ error: 'Google OAuth is not configured on this server.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // Construct our callback URL dynamically from the current request's origin
  const redirectUri = `${url.origin}/api/auth/callback/google`;
  
  // Package sessionId and redirectBack into the state parameter
  const stateParam = `${state}:${redirectBack}`;

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + 
    `client_id=${env.GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent('openid email profile')}` +
    `&state=${encodeURIComponent(stateParam)}`;

  return Response.redirect(googleAuthUrl, 302);
}

// GET /api/auth/callback/google
async function handleGetGoogleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return new Response(JSON.stringify({ error: 'Missing code or state from Google' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // Split state to recover session ID and original redirect URI (robust to colons in redirect URI)
  const firstColonIndex = state.indexOf(':');
  const sessionId = firstColonIndex === -1 ? state : state.substring(0, firstColonIndex);
  const redirectBack = firstColonIndex === -1 ? '' : state.substring(firstColonIndex + 1);
  const fallbackUrl = redirectBack || url.origin;

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return Response.redirect(`${fallbackUrl}?error=google_credentials_missing`, 302);
  }

  const redirectUri = `${url.origin}/api/auth/callback/google`;

  try {
    // Exchange auth code for access & ID token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error('Google token exchange failed:', errText);
      return Response.redirect(`${fallbackUrl}?error=google_token_exchange_failed`, 302);
    }

    const tokenData = await tokenResponse.json() as { id_token?: string };
    const idToken = tokenData.id_token;
    if (!idToken) {
      console.error('Google token response missing id_token');
      return Response.redirect(`${fallbackUrl}?error=google_missing_id_token`, 302);
    }

    // Cryptographically verify Google ID Token
    const payload = await verifyGoogleIdToken(idToken, env.GOOGLE_CLIENT_ID || '');
    if (!payload || !payload.sub) {
      console.error('Google ID Token verification failed (invalid signature or claims)');
      return Response.redirect(`${fallbackUrl}?error=google_verification_failed`, 302);
    }

    const googleUserId = payload.sub;

    // Helper to parse database row to GameState structure safely
    const parseState = (row: any): GameState => ({
      stamina: row?.stamina ?? 80,
      maxStamina: row?.max_stamina ?? 80,
      lifetimeSwipes: row?.lifetime_swipes ?? 0,
      lastRecoveryTime: row?.last_recovery_time ?? Date.now(),
      souls: row?.souls ?? 0,
      isAdFree: (row?.is_ad_free ?? 0) === 1,
      outs: row?.outs ?? 0,
      lastOutRecoveryTime: row?.last_out_recovery_time ?? 0,
      swipesSinceLastOutRecovery: row?.swipes_since_last_out_recovery ?? 0
    });

    // 1. Fetch current anonymous session S_anon
    const sAnon = await env.DB.prepare(
      "SELECT * FROM user_sessions WHERE session_id = ?"
    ).bind(sessionId).first<any>();

    // 2. Fetch existing session linked to this Google User S_old
    const sOld = await env.DB.prepare(
      "SELECT * FROM user_sessions WHERE clerk_user_id = ?"
    ).bind(googleUserId).first<any>();

    if (sOld && sOld.session_id !== sessionId) {
      // 3. Merge S_anon and S_old
      const merged = mergeGameStates(parseState(sAnon), parseState(sOld));
      const mergedSoulsVersion = Math.max(sAnon?.souls_version ?? 0, sOld.souls_version ?? 0);

      // 4. Update the current upgraded session with the merged values and clerk_user_id
      await env.DB.prepare(
        `UPDATE user_sessions
         SET clerk_user_id = ?,
             stamina = ?,
             max_stamina = ?,
             lifetime_swipes = ?,
             last_recovery_time = ?,
             souls = ?,
             souls_version = ?,
             is_ad_free = ?,
             outs = ?,
             last_out_recovery_time = ?,
             swipes_since_last_out_recovery = ?
         WHERE session_id = ?`
      ).bind(
        googleUserId,
        merged.stamina,
        merged.maxStamina,
        merged.lifetimeSwipes,
        merged.lastRecoveryTime,
        merged.souls,
        mergedSoulsVersion,
        merged.isAdFree ? 1 : 0,
        merged.outs ?? 0,
        merged.lastOutRecoveryTime ?? 0,
        merged.swipesSinceLastOutRecovery ?? 0,
        sessionId
      ).run();

      // 5. Transfer all database assets (assigned cards, threads, reports) from S_old to current sessionId
      await env.DB.prepare(
        "UPDATE specimens SET assigned_session_id = ? WHERE assigned_session_id = ?"
      ).bind(sessionId, sOld.session_id).run();

      await env.DB.prepare(
        "UPDATE threads SET creator_session_id = ? WHERE creator_session_id = ?"
      ).bind(sessionId, sOld.session_id).run();

      await env.DB.prepare(
        "UPDATE reports SET session_id = ? WHERE session_id = ?"
      ).bind(sessionId, sOld.session_id).run();

      await env.DB.prepare(
        "UPDATE soul_grants SET session_id = ? WHERE session_id = ?"
      ).bind(sessionId, sOld.session_id).run();

      // 6. Delete S_old row
      await env.DB.prepare(
        "DELETE FROM user_sessions WHERE session_id = ?"
      ).bind(sOld.session_id).run();
    } else {
      // 7. First time authentication: just upgrade session record to authenticated
      if (!sAnon) {
        await env.DB.prepare(
          "INSERT INTO user_sessions (session_id, clerk_user_id, stamina, max_stamina, last_recovery_time) VALUES (?, ?, 80, 80, ?)"
        ).bind(sessionId, googleUserId, Date.now()).run();
      } else {
        await env.DB.prepare(
          "UPDATE user_sessions SET clerk_user_id = ? WHERE session_id = ?"
        ).bind(googleUserId, sessionId).run();
      }
    }

    // Issue upgraded JWT cookie
    const jwtSecret = env.JWT_SECRET || 'dev-secret-key';
    const exp = Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 365);
    const jwt = await signJWT({ session_id: sessionId, clerk_user_id: googleUserId, type: 'authenticated', exp }, jwtSecret);

    const cookie = `auth_token=${jwt}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;

    const redirectTarget = new URL(fallbackUrl);
    redirectTarget.searchParams.set('token', jwt);

    return new Response(null, {
      status: 302,
      headers: {
        'Location': redirectTarget.toString(),
        'Set-Cookie': cookie
      }
    });
  } catch (err: any) {
    console.error('Google OAuth callback error:', err);
    return Response.redirect(`${fallbackUrl}?error=${encodeURIComponent(err.message || 'unknown_callback_error')}`, 302);
  }
}

// POST /api/auth/logout
async function handlePostLogout(request: Request): Promise<Response> {
  const cookie = `auth_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  return new Response(JSON.stringify({ success: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
      ...corsHeaders(request)
    }
  });
}

// GET /api/auth/me
async function handleGetAuthMe(request: Request, env: Env): Promise<Response> {
  const currentSessionOrResponse = await authenticateSession(request, env);
  if (currentSessionOrResponse instanceof Response) {
    return currentSessionOrResponse;
  }
  
  return new Response(JSON.stringify({
    success: true,
    session_id: currentSessionOrResponse.session_id,
    type: currentSessionOrResponse.type
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(request)
      });
    }

    try {
      // Public Auth endpoints
      if (url.pathname === '/api/auth/anonymous' && request.method === 'POST') {
        return await handlePostAnonymousAuth(request, env);
      }
      if (url.pathname === '/api/auth/upgrade' && request.method === 'POST') {
        return await handlePostUpgradeAuth(request, env);
      }
      if (url.pathname === '/api/auth/me' && request.method === 'GET') {
        return await handleGetAuthMe(request, env);
      }
      if (url.pathname === '/api/auth/google/login' && request.method === 'GET') {
        return await handleGetGoogleLogin(request, env);
      }
      if (url.pathname === '/api/auth/callback/google' && request.method === 'GET') {
        return await handleGetGoogleCallback(request, env);
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        return await handlePostLogout(request);
      }

      // Public GET endpoints for threads list, likes, and history
      if (url.pathname === '/api/threads' && request.method === 'GET') {
        return await handleGetThreads(request, env);
      }
      if (url.pathname === '/api/geo' && request.method === 'GET') {
        return await handleGetGeo(request, env);
      }
      if (url.pathname === '/api/threads/likes' && request.method === 'GET') {
        return await handleGetThreadLikes(request, env);
      }
      if (url.pathname === '/api/threads/history' && request.method === 'GET') {
        return await handleGetThreadHistory(request, env);
      }

      // Admin endpoints
      if (url.pathname === '/api/stripe/webhook' && request.method === 'POST') {
        return await handlePostStripeWebhook(request, env);
      }
      if (url.pathname === '/api/admin/run-ga' && request.method === 'POST') {
        return await handleAdminRunGA(request, env);
      }

      // Authenticated endpoints
      if (url.pathname.startsWith('/api/')) {
        const sessionOrResponse = await authenticateSession(request, env);
        if (sessionOrResponse instanceof Response) {
          return sessionOrResponse;
        }

        if (url.pathname === '/api/stripe/create-checkout-session' && request.method === 'POST') {
          return await handlePostCreateCheckoutSession(request, env, sessionOrResponse);
        }
        if (url.pathname === '/api/threads' && request.method === 'POST') {
          return await handlePostThread(request, env, sessionOrResponse, ctx);
        }
        if (url.pathname === '/api/threads/delete' && request.method === 'POST') {
          return await handlePostDeleteThread(request, env, sessionOrResponse);
        }
        if (url.pathname === '/api/threads/rename' && request.method === 'POST') {
          return await handlePostRenameThread(request, env, sessionOrResponse);
        }
        if (url.pathname === '/api/cards' && request.method === 'GET') {
          return await handleGetCards(request, env, sessionOrResponse, ctx);
        }
        if (url.pathname === '/api/swipe' && request.method === 'POST') {
          return await handlePostSwipe(request, env, sessionOrResponse);
        }
        if (url.pathname === '/api/swipe/bulk' && request.method === 'POST') {
          return await handlePostSwipeBulk(request, env, sessionOrResponse);
        }
        if (url.pathname === '/api/report' && request.method === 'POST') {
          return await handlePostReport(request, env, sessionOrResponse);
        }
        if (url.pathname === '/api/stamina/sync' && request.method === 'POST') {
          return await handlePostStaminaSync(request, env, sessionOrResponse);
        }

        return new Response(JSON.stringify({ error: 'Not Found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
        });
      }

      let response = await env.ASSETS.fetch(request);
      
      // SPA routing fallback: if the asset is not found and it's a client-side route, serve index.html
      if (response.status === 404 && !url.pathname.startsWith('/api/')) {
        const indexRequest = new Request(new URL('/index.html', request.url), request);
        response = await env.ASSETS.fetch(indexRequest);
      }
      
      return response;
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
      });
    }
  }
};

// GET /api/geo
async function handleGetGeo(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const testCountry = url.searchParams.get('test_country');
  const country = testCountry || request.headers.get('CF-IPCountry') || (request as any).cf?.country || 'JP';
  return new Response(JSON.stringify({ country }), {
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(request)
    }
  });
}

// GET /api/threads
// Ranking: Hacker News-style hybrid score = (total_swipes + 1) / (age_hours + 2)^1.5
// New projects appear near top by default; active ones stay visible; all decay over time.
// Uses denormalized total_swipes/current_generation on threads table to avoid expensive JOIN with specimens.
async function handleGetThreads(request: Request, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT
       id, name, type, creator_session_id, created_at,
       current_generation AS generation, total_swipes
     FROM threads
     ORDER BY
       (total_swipes + 1.0)
       / exp(1.5 * log(
           (CAST(strftime('%s', 'now') AS REAL) - CAST(strftime('%s', created_at) AS REAL))
           / 3600.0 + 2.0
         ))
       DESC`
  ).all<{ id: string; name: string; type: string; creator_session_id: string | null; created_at: string; generation: number; total_swipes: number }>();

  return new Response(JSON.stringify({ threads: results }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

// POST /api/threads
async function handlePostThread(
  request: Request,
  env: Env,
  session: { session_id: string },
  ctx: ExecutionContext
): Promise<Response> {
  const sessionId = session.session_id;
  const body = await request.json<{ name?: string; type?: 'line' | 'mosaic'; fork_dna?: any; lineCount?: number }>();
  const { name, type, fork_dna, lineCount } = body;


  if (!name || !type || (type !== 'line' && type !== 'mosaic')) {
    return new Response(JSON.stringify({ error: 'Invalid name or type. Type must be "line" or "mosaic"' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  if (containsInappropriateContent(name)) {
    return new Response(JSON.stringify({ error: 'Inappropriate content detected in thread name' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  const threadId = `thread_${crypto.randomUUID()}`;
  const nowStr = new Date().toISOString();

  // Determine line count with default 10
  const lineCountValue = (type === 'line') ? (typeof lineCount === 'number' ? lineCount : 10) : undefined;
  // Validate line count range
  if (type === 'line' && (lineCountValue === undefined || lineCountValue < 1 || lineCountValue > 10)) {
    return new Response(JSON.stringify({ error: 'lineCount must be between 1 and 10' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // 1. Insert Thread. Older D1 databases may not have line_count yet, so keep creation backward compatible.
  const lineCountColumnExists = type === 'line' ? await hasThreadsLineCountColumn(env.DB) : false;
  await env.DB.prepare(
    type === 'line' && lineCountColumnExists
      ? "INSERT INTO threads (id, name, type, creator_session_id, created_at, line_count) VALUES (?, ?, ?, ?, ?, ?)"
      : "INSERT INTO threads (id, name, type, creator_session_id, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(
    threadId,
    name,
    type,
    sessionId || null,
    nowStr,
    ...(type === 'line' && lineCountColumnExists ? [lineCountValue] : [])
  ).run();

  // 2. Generate 100 specimens for Gen 0 (97 random or mutated, 3 honeypots)
  const specimensPool = [];
  for (let i = 0; i < 100; i++) {
    const specimenId = `${type}_${crypto.randomUUID()}`;
    const isHoneypot = i < 3 ? 1 : 0;
    
    let dna;
    if (type === 'line') {
      if (isHoneypot) {
        dna = generateHoneypotLineDNA();
      } else if (fork_dna && Array.isArray(fork_dna)) {
        dna = mutateLineDNA(fork_dna as LineDNA);
      } else {
        dna = generateRandomLineDNA();
      }
    } else {
      if (isHoneypot) {
        dna = generateHoneypotMosaicDNA();
      } else if (fork_dna && Array.isArray(fork_dna)) {
        dna = mutateMosaicDNA(fork_dna as MosaicDNA);
      } else {
        dna = generateRandomMosaicDNA();
      }
    }
    specimensPool.push({ id: specimenId, dna, isHoneypot });
  }

  // 最初の20件（ハニーポット3件含む、初期スワイプ表示用）を同期的にインサート
  const firstChunk = specimensPool.slice(0, 20);
  const initialStatements = firstChunk.map(item => {
    const dnaStr = JSON.stringify(item.dna);
    return env.DB.prepare(
      "INSERT INTO specimens (id, thread_id, generation, dna, likes_count, nopes_count, is_honeypot, status) VALUES (?, ?, 0, ?, 0, 0, ?, 'active')"
    ).bind(item.id, threadId, dnaStr, item.isHoneypot);
  });
  await env.DB.batch(initialStatements);

  // 残りの80件を非同期インサートするPromiseタスク
  const asyncInsertTask = (async () => {
    const remainingPool = specimensPool.slice(20);
    const CHUNK_SIZE = 80;
    for (let i = 0; i < remainingPool.length; i += CHUNK_SIZE) {
      const chunk = remainingPool.slice(i, i + CHUNK_SIZE);
      const chunkStatements = chunk.map(item => {
        const dnaStr = JSON.stringify(item.dna);
        return env.DB.prepare(
          "INSERT INTO specimens (id, thread_id, generation, dna, likes_count, nopes_count, is_honeypot, status) VALUES (?, ?, 0, ?, 0, 0, ?, 'active')"
        ).bind(item.id, threadId, dnaStr, item.isHoneypot);
      });
      await env.DB.batch(chunkStatements);
    }
  })();

  // バックグラウンドで残りをインサート
  ctx.waitUntil(asyncInsertTask);

  return new Response(JSON.stringify({ success: true, thread: { id: threadId, name, type, generation: 0 } }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
  });
}

function getRequiredSwipeForHoneypot(cardId: string): 'like' | 'nope' {
  let hash = 0;
  for (let i = 0; i < cardId.length; i++) {
    hash = cardId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return (hash % 2 === 0) ? 'like' : 'nope';
}

// GET /api/cards?thread_id=...
async function handleGetCards(
  request: Request,
  env: Env,
  session: { session_id: string },
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const threadId = url.searchParams.get('thread_id') || url.searchParams.get('threadId');
  const sessionId = session.session_id;

  if (!threadId || !sessionId) {
    return new Response(JSON.stringify({ error: 'Missing thread_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // Verify thread exists
  const thread = await env.DB.prepare(
    "SELECT * FROM threads WHERE id = ?"
  ).bind(threadId).first<{ id: string; type: 'line' | 'mosaic' }>();

  if (!thread) {
    return new Response(JSON.stringify({ error: 'Thread not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // 1. Get the current active generation
  const currentGenRow = await env.DB.prepare(
    "SELECT MAX(generation) as gen FROM specimens WHERE thread_id = ? AND status = 'active'"
  ).bind(threadId).first<{ gen: number | null }>();

  const currentGen = currentGenRow?.gen ?? 0;
  let activeGen = currentGen;

  // 2. Return cards already assigned to this session first.
  const excludeParam = url.searchParams.get('exclude') || '';
  const excludeIds = excludeParam.split(',').filter(id => id.length > 0);
  let results = await fetchAssignedCardsForSession(env.DB, threadId, activeGen, sessionId, excludeIds);

  if (results.length < 20) {
    const availableRow = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM specimens WHERE thread_id = ? AND generation = ? AND status = 'active' AND assigned_session_id IS NULL"
    ).bind(threadId, activeGen).first<{ count: number | null }>();

    const availableCount = availableRow?.count ?? 0;
    const cardsNeeded = 20 - results.length;

    if (availableCount > 0) {
      const claimCount = Math.min(cardsNeeded, availableCount);
      await claimCardsForSession(env.DB, threadId, activeGen, sessionId, claimCount, excludeIds);
      results = await fetchAssignedCardsForSession(env.DB, threadId, activeGen, sessionId, excludeIds);
    } else if (results.length === 0) {
      console.log(`Auto-evolving thread ${threadId} because generation ${currentGen} is fully assigned.`);
      const lastSwipedCardId = url.searchParams.get('last_swiped_card_id') || (excludeIds.length > 0 ? excludeIds[excludeIds.length - 1] : null);
      const res = await evolveThread(
        env.DB,
        threadId,
        thread.type,
        lastSwipedCardId,
        (promise) => ctx.waitUntil(promise)
      );
      activeGen = res.nextGen;
      await claimCardsForSession(env.DB, threadId, activeGen, sessionId, 20, excludeIds);
      results = await fetchAssignedCardsForSession(env.DB, threadId, activeGen, sessionId, excludeIds);
    }
  }

  // Parse DNA string back to object
  const cards = results.map(row => {
    const isHoneypot = row.is_honeypot === 1;
    return {
      id: row.id,
      generation: row.generation,
      dna: JSON.parse(row.dna),
      is_honeypot: isHoneypot,
      required_swipe: isHoneypot ? getRequiredSwipeForHoneypot(row.id) : undefined
    };
  });

  // Fetch session statistics if session ID is provided
  let userStats = { dailySwipes: 0, botFlag: 0 };
  if (sessionId) {
    const sessionRow = await env.DB.prepare(
      "SELECT daily_swipes, bot_flag FROM user_sessions WHERE session_id = ?"
    ).bind(sessionId).first<{ daily_swipes: number; bot_flag: number }>();

    if (sessionRow) {
      userStats = {
        dailySwipes: sessionRow.daily_swipes,
        botFlag: sessionRow.bot_flag
      };
    }
  }

  return new Response(JSON.stringify({ cards, generation: activeGen, stats: userStats }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
  });
}

// POST /api/swipe
interface SwipeRequestBody {
  thread_id: string;
  card_id: string;
  swipe: 'like' | 'nope';
  session_id: string;
  turnstile_token?: string;
}

async function handlePostSwipe(request: Request, env: Env, session: { session_id: string }): Promise<Response> {
  const body = await request.json<{ thread_id?: string; card_id?: string; swipe?: 'like' | 'nope'; turnstile_token?: string }>();
  const { thread_id, card_id, swipe, turnstile_token } = body;
  const sessionId = session.session_id;

  if (!thread_id || !card_id || !swipe) {
    return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // 1. Turnstile Token Verification
  const turnstileSecret = env.TURNSTILE_SECRET;
  if (turnstileSecret && turnstile_token) {
    const clientIP = request.headers.get('CF-Connecting-IP') || '';
    const formData = new FormData();
    formData.append('secret', turnstileSecret);
    formData.append('response', turnstile_token);
    formData.append('remoteip', clientIP);

    const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData
    });

    const verifyResult = await verifyResponse.json() as { success: boolean };
    if (!verifyResult.success) {
      return new Response(JSON.stringify({ error: 'Turnstile verification failed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
      });
    }
  }

  // 2. Fetch or Create User Session & Check Rate Limit
  const nowStr = new Date().toISOString();
  let userSession = await env.DB.prepare(
    "SELECT * FROM user_sessions WHERE session_id = ?"
  ).bind(sessionId).first<{ session_id: string; daily_swipes: number; bot_flag: number; last_swipe_at: string }>();

  if (!userSession) {
    await env.DB.prepare(
      "INSERT INTO user_sessions (session_id, daily_swipes, bot_flag, last_swipe_at) VALUES (?, 1, 0, ?)"
    ).bind(sessionId, nowStr).run();
    userSession = { session_id: sessionId, daily_swipes: 1, bot_flag: 0, last_swipe_at: nowStr };
  } else {
    const lastSwipeTime = new Date(userSession.last_swipe_at).getTime();
    const nowTime = Date.now();
    
    if (nowTime - lastSwipeTime < 60000) {
      if (userSession.daily_swipes % 120 === 0 && nowTime - lastSwipeTime < 5000) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait.' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
        });
      }
    }

    // Update session daily count and timestamp
    await env.DB.prepare(
      "UPDATE user_sessions SET daily_swipes = daily_swipes + 1, last_swipe_at = ? WHERE session_id = ?"
    ).bind(nowStr, sessionId).run();
  }

  // 3. Shadow Ban Check (Requires 3 strikes to prevent accidental bans)
  if (userSession.bot_flag >= 3) {
    return new Response(JSON.stringify({ success: true, message: 'Processed' }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // 4. Load the Card details to see if it's a honeypot
  const card = await env.DB.prepare(
    "SELECT is_honeypot FROM specimens WHERE id = ?"
  ).bind(card_id).first<{ is_honeypot: number }>();

  if (!card) {
    return new Response(JSON.stringify({ error: 'Card not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // 5. Honeypot check
  if (card.is_honeypot === 1) {
    // Honeypot cards are now ad cards, so we don't increment the bot flag.
    return new Response(JSON.stringify({ success: true, message: 'Processed Ad Card' }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // 6. Record vote in DB
  if (swipe === 'like') {
    await env.DB.prepare(
      "UPDATE specimens SET likes_count = likes_count + 1 WHERE id = ?"
    ).bind(card_id).run();
  } else {
    await env.DB.prepare(
      "UPDATE specimens SET nopes_count = nopes_count + 1 WHERE id = ?"
    ).bind(card_id).run();
  }

  // 7. Increment denormalized total_swipes on threads table
  await env.DB.prepare(
    "UPDATE threads SET total_swipes = total_swipes + 1 WHERE id = ?"
  ).bind(thread_id).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
  });
}

// POST /api/swipe/bulk
interface BulkSwipeItem {
  card_id: string;
  swipe: 'like' | 'nope';
}

async function handlePostSwipeBulk(
  request: Request,
  env: Env,
  session: { session_id: string }
): Promise<Response> {
  const body = await request.json<{ thread_id?: string; swipes?: BulkSwipeItem[]; turnstile_token?: string }>().catch(() => null);
  if (!body) {
    return new Response(JSON.stringify({ error: 'Invalid body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  const { thread_id, swipes, turnstile_token } = body;
  const sessionId = session.session_id;

  if (!thread_id || !swipes || !Array.isArray(swipes) || swipes.length === 0) {
    return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // 1. Turnstile Token Verification (Optional)
  const turnstileSecret = env.TURNSTILE_SECRET;
  if (turnstileSecret && turnstile_token) {
    const clientIP = request.headers.get('CF-Connecting-IP') || '';
    const formData = new FormData();
    formData.append('secret', turnstileSecret);
    formData.append('response', turnstile_token);
    formData.append('remoteip', clientIP);

    const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData
    });

    const verifyResult = await verifyResponse.json() as { success: boolean };
    if (!verifyResult.success) {
      return new Response(JSON.stringify({ error: 'Turnstile verification failed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
      });
    }
  }

  // 2. Fetch User Session
  const nowStr = new Date().toISOString();
  let userSession = await env.DB.prepare(
    "SELECT * FROM user_sessions WHERE session_id = ?"
  ).bind(sessionId).first<{ session_id: string; daily_swipes: number; bot_flag: number; last_swipe_at: string }>();

  if (!userSession) {
    await env.DB.prepare(
      "INSERT INTO user_sessions (session_id, daily_swipes, bot_flag, last_swipe_at) VALUES (?, ?, 0, ?)"
    ).bind(sessionId, swipes.length, nowStr).run();
    userSession = { session_id: sessionId, daily_swipes: swipes.length, bot_flag: 0, last_swipe_at: nowStr };
  } else {
    // Check rate limits
    const lastSwipeTime = new Date(userSession.last_swipe_at).getTime();
    const nowTime = Date.now();
    if (nowTime - lastSwipeTime < 5000 && userSession.daily_swipes % 120 === 0) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
      });
    }

    // Update session daily count and timestamp
    await env.DB.prepare(
      "UPDATE user_sessions SET daily_swipes = daily_swipes + ?, last_swipe_at = ? WHERE session_id = ?"
    ).bind(swipes.length, nowStr, sessionId).run();
  }

  // 3. Shadow Ban Check
  if (userSession.bot_flag >= 3) {
    return new Response(JSON.stringify({ success: true, message: 'Processed' }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // 4. Batch update vote counts (skip honeypot assets)
  const statements = [];
  for (const item of swipes) {
    if (item.swipe === 'like') {
      statements.push(
        env.DB.prepare("UPDATE specimens SET likes_count = likes_count + 1 WHERE id = ? AND is_honeypot = 0").bind(item.card_id)
      );
    } else {
      statements.push(
        env.DB.prepare("UPDATE specimens SET nopes_count = nopes_count + 1 WHERE id = ? AND is_honeypot = 0").bind(item.card_id)
      );
    }
  }

  // Increment denormalized total_swipes on threads table
  const realSwipeCount = swipes.length;
  if (realSwipeCount > 0) {
    statements.push(
      env.DB.prepare("UPDATE threads SET total_swipes = total_swipes + ? WHERE id = ?").bind(realSwipeCount, thread_id)
    );
  }

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
  });
}


// POST /api/admin/run-ga
async function handleAdminRunGA(request: Request, env: Env): Promise<Response> {
  let body: { secret?: string; thread_id?: string; current_card_id?: string } = {};
  try {
    body = await request.json();
  } catch (e) {}
  const adminSecret = env.ADMIN_SECRET || 'dev-secret-key';
  if (body.secret !== adminSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  const threadId = body.thread_id;
  if (!threadId) {
    return new Response(JSON.stringify({ error: 'Missing thread_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  const thread = await env.DB.prepare(
    "SELECT * FROM threads WHERE id = ?"
  ).bind(threadId).first<{ id: string; type: 'line' | 'mosaic' }>();

  if (!thread) {
    return new Response(JSON.stringify({ error: 'Thread not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  console.log(`Admin triggered manual GA evolution for thread ${threadId}...`);
  const res = await evolveThread(env.DB, threadId, thread.type, body.current_card_id);

  return new Response(JSON.stringify({
    success: true,
    currentGen: res.currentGen,
    nextGen: res.nextGen
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

// GET /api/threads/likes?thread_id=...
async function handleGetThreadLikes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const threadId = url.searchParams.get('thread_id');
  if (!threadId) {
    return new Response(JSON.stringify({ error: 'Missing thread_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  // Get top 12 specimens by likes_count
  const { results } = await env.DB.prepare(
    `SELECT id, generation, dna, likes_count, nopes_count 
     FROM specimens 
     WHERE thread_id = ? AND likes_count > 0 
     ORDER BY likes_count DESC, id ASC 
     LIMIT 12`
  ).bind(threadId).all<{ id: string; generation: number; dna: string; likes_count: number; nopes_count: number }>();

  const specimens = results.map(row => ({
    id: row.id,
    generation: row.generation,
    dna: JSON.parse(row.dna),
    likes_count: row.likes_count,
    nopes_count: row.nopes_count
  }));

  return new Response(JSON.stringify({ specimens }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

// GET /api/threads/history?thread_id=...
async function handleGetThreadHistory(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const threadId = url.searchParams.get('thread_id');
  if (!threadId) {
    return new Response(JSON.stringify({ error: 'Missing thread_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  // Read precomputed history snapshots instead of scanning archived specimens.
  const { results } = await env.DB.prepare(
    `SELECT generation, specimen_id AS id, dna, likes_count, nopes_count
     FROM thread_history
     WHERE thread_id = ?
     ORDER BY generation DESC`
  ).bind(threadId).all<{ id: string; generation: number; dna: string; likes_count: number; nopes_count: number }>();

  const history = results.map(row => ({
    id: row.id,
    generation: row.generation,
    dna: JSON.parse(row.dna),
    likes_count: row.likes_count,
    nopes_count: row.nopes_count
  }));

  return new Response(JSON.stringify({ history }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

// POST /api/threads/delete
async function handlePostDeleteThread(request: Request, env: Env, session: { session_id: string }): Promise<Response> {
  const body = await request.json<{ thread_id?: string }>();
  const { thread_id } = body;
  const session_id = session.session_id;

  if (!thread_id) {
    return new Response(JSON.stringify({ error: 'Missing thread_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // Fetch thread to check creator
  const thread = await env.DB.prepare(
    "SELECT creator_session_id FROM threads WHERE id = ?"
  ).bind(thread_id).first<{ creator_session_id: string | null }>();

  if (!thread) {
    return new Response(JSON.stringify({ error: 'Thread not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  if (!thread.creator_session_id || thread.creator_session_id !== session_id) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Only the creator can delete this thread.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // Delete specimens and thread in batch
  await env.DB.batch([
    env.DB.prepare("DELETE FROM specimens WHERE thread_id = ?").bind(thread_id),
    env.DB.prepare("DELETE FROM threads WHERE id = ?").bind(thread_id)
  ]);

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
  });
}

// POST /api/threads/rename
async function handlePostRenameThread(
  request: Request,
  env: Env,
  session: { session_id: string }
): Promise<Response> {
  const body = await request.json<{ thread_id?: string; name?: string }>().catch(() => null);
  if (!body) {
    return new Response(JSON.stringify({ error: 'Invalid body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  const { thread_id, name } = body;
  const sessionId = session.session_id;

  if (!thread_id || !name || !name.trim()) {
    return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  if (containsInappropriateContent(name)) {
    return new Response(JSON.stringify({ error: 'Inappropriate content detected in thread name' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // Fetch thread to check creator
  const thread = await env.DB.prepare(
    "SELECT creator_session_id FROM threads WHERE id = ?"
  ).bind(thread_id).first<{ creator_session_id: string | null }>();

  if (!thread) {
    return new Response(JSON.stringify({ error: 'Thread not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  if (!thread.creator_session_id || thread.creator_session_id !== sessionId) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Only the creator can rename this thread.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // Update thread name
  await env.DB.prepare(
    "UPDATE threads SET name = ? WHERE id = ?"
  ).bind(name.trim(), thread_id).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
  });
}

// POST /api/report
async function handlePostReport(request: Request, env: Env, session: { session_id: string }): Promise<Response> {
  const sessionId = session.session_id;
  const body = await request.json<{ category?: string; description?: string }>().catch(() => ({ category: undefined, description: undefined }));
  const { category, description } = body;

  if (!category || !description) {
    return new Response(JSON.stringify({ error: 'カテゴリーと不具合内容は必須項目です。' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  const reportId = `report_${crypto.randomUUID()}`;
  const nowStr = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO reports (id, session_id, category, description, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(reportId, sessionId, category, description, nowStr).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
  });
}

// POST /api/stamina/sync
async function handlePostStaminaSync(
  request: Request,
  env: Env,
  session: { session_id: string }
): Promise<Response> {
  const sessionId = session.session_id;
  const clientState = await request.json<{
    stamina?: number;
    maxStamina?: number;
    lifetimeSwipes?: number;
    lastRecoveryTime?: number;
    souls?: number;
    soulsVersion?: number;
    isAdFree?: boolean;
    outs?: number;
    lastOutRecoveryTime?: number;
    swipesSinceLastOutRecovery?: number;
  }>().catch(() => null);

  if (!clientState) {
    return new Response(JSON.stringify({ error: 'Invalid body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // 1. Fetch server state
  let serverRow = await env.DB.prepare(
    "SELECT * FROM user_sessions WHERE session_id = ?"
  ).bind(sessionId).first<any>();

  if (!serverRow) {
    // If session doesn't exist, create it
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO user_sessions (session_id, stamina, max_stamina, last_recovery_time, souls, souls_version) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(sessionId, clientState.stamina ?? 80, clientState.maxStamina ?? 80, clientState.lastRecoveryTime ?? now, clientState.souls ?? 0, clientState.soulsVersion ?? 0).run();
    
    serverRow = {
      stamina: clientState.stamina ?? 80,
      max_stamina: clientState.maxStamina ?? 80,
      lifetime_swipes: clientState.lifetimeSwipes ?? 0,
      last_recovery_time: clientState.lastRecoveryTime ?? now,
      souls: clientState.souls ?? 0,
      souls_version: clientState.soulsVersion ?? 0,
      is_ad_free: clientState.isAdFree ? 1 : 0,
      outs: clientState.outs ?? 0,
      last_out_recovery_time: clientState.lastOutRecoveryTime ?? 0,
      swipes_since_last_out_recovery: clientState.swipesSinceLastOutRecovery ?? 0
    };
  }

  const clientSoulsVersion = clientState.soulsVersion ?? 0;

  const clientParsed: GameState = {
    stamina: clientState.stamina ?? 80,
    maxStamina: clientState.maxStamina ?? 80,
    lifetimeSwipes: clientState.lifetimeSwipes ?? 0,
    lastRecoveryTime: clientState.lastRecoveryTime ?? Date.now(),
    souls: clientState.souls ?? 0,
    isAdFree: clientState.isAdFree ?? false,
    outs: clientState.outs ?? 0,
    lastOutRecoveryTime: clientState.lastOutRecoveryTime ?? 0,
    swipesSinceLastOutRecovery: clientState.swipesSinceLastOutRecovery ?? 0
  };

  const serverParsed: GameState = {
    stamina: serverRow.stamina ?? 80,
    maxStamina: serverRow.max_stamina ?? 80,
    lifetimeSwipes: serverRow.lifetime_swipes ?? 0,
    lastRecoveryTime: serverRow.last_recovery_time ?? Date.now(),
    souls: serverRow.souls ?? 0,
    isAdFree: (serverRow.is_ad_free ?? 0) === 1,
    outs: serverRow.outs ?? 0,
    lastOutRecoveryTime: serverRow.last_out_recovery_time ?? 0,
    swipesSinceLastOutRecovery: serverRow.swipes_since_last_out_recovery ?? 0
  };

  // 2. Merge states using standard conflict resolution
  const merged = mergeGameStates(clientParsed, serverParsed);
  const reconciledSouls = await reconcileSoulBalance(
    env.DB,
    sessionId,
    clientParsed.souls ?? 0,
    clientSoulsVersion
  );
  merged.souls = reconciledSouls.souls;

  // 3. Write merged state back to database
  const lastRecoveryUnchangedOrNotNeeded =
    merged.stamina >= merged.maxStamina && serverParsed.stamina >= serverParsed.maxStamina
      ? true
      : merged.lastRecoveryTime === serverParsed.lastRecoveryTime;

  const shouldPersist =
    merged.stamina !== serverParsed.stamina ||
    merged.maxStamina !== serverParsed.maxStamina ||
    merged.lifetimeSwipes !== serverParsed.lifetimeSwipes ||
    !lastRecoveryUnchangedOrNotNeeded ||
    merged.souls !== serverParsed.souls ||
    reconciledSouls.soulsVersion !== (serverRow.souls_version ?? 0) ||
    merged.isAdFree !== serverParsed.isAdFree ||
    (merged.outs ?? 0) !== (serverParsed.outs ?? 0) ||
    (merged.lastOutRecoveryTime ?? 0) !== (serverParsed.lastOutRecoveryTime ?? 0) ||
    (merged.swipesSinceLastOutRecovery ?? 0) !== (serverParsed.swipesSinceLastOutRecovery ?? 0);

  if (shouldPersist) {
    await env.DB.prepare(
      `UPDATE user_sessions
       SET stamina = ?,
           max_stamina = ?,
           lifetime_swipes = ?,
           last_recovery_time = ?,
           souls = ?,
           souls_version = ?,
           is_ad_free = ?,
           outs = ?,
           last_out_recovery_time = ?,
           swipes_since_last_out_recovery = ?
       WHERE session_id = ?`
    ).bind(
      merged.stamina,
      merged.maxStamina,
      merged.lifetimeSwipes,
      merged.lastRecoveryTime,
      merged.souls,
      reconciledSouls.soulsVersion,
      merged.isAdFree ? 1 : 0,
      merged.outs ?? 0,
      merged.lastOutRecoveryTime ?? 0,
      merged.swipesSinceLastOutRecovery ?? 0,
      sessionId
    ).run();
  }

  return new Response(JSON.stringify({ success: true, state: { ...merged, soulsVersion: reconciledSouls.soulsVersion } }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
  });
}

const EXACT_BAD_WORDS = new Set([
  "bj", "isil", "kz", "ss", "sa", "dp", "kkk", "9/11", "acab", "pd", "zob"
]);

const SUBSTRING_BAD_WORDS = [
  // 英語・その他外国語
  "analplug", "bullshit", "clit", "clitoris", "cock", "cocksucker", "coon", "cum", "cumshot",
  "cunt", "damn", "dick", "dickhead", "dike", "dildo", "dyke", "f.u.c.k.", "fuck", "fag", "faggot",
  "fags", "fascist", "fcuk", "fucker", "fuct", "fuk", "fvck", "gobshite", "goddamn", "gypo",
  "homo", "hore", "incest", "jesussucks", "jism", "jizz", "jizzum", "kill", "killer", "kunt",
  "lesbo", "masturbate", "molest", "paedo", "paedofile", "paedophile", "pecker", "pedo",
  "pedofile", "pedophile", "penis", "phuk", "poof", "poon", "porn", "pussy", "rape", "raped",
  "rapes", "rapist", "scrotum", "shiz", "slag", "slut", "spastic", "spaz", "sperm", "spick",
  "spik", "spunk", "suicide", "tits", "twat", "vag", "vagina", "vulva", "wank", "wanker",
  "whor", "whore", "bastard", "blowjob", "bitch", "nazi", "piss", "ass", "anal",
  "asshole", "shit", "nonce", "slave", "analsex", "isis", "nigga", "towelhead", "cocaine",
  "cokehead", "covid", "sau", "hitler", "wog", "paki", "mong", "kike", "yid", "gypsy",
  "kaffir", "negro", "nigger", "weed", "ejaculate", "handjob", "cannabis", "ganja", "chink",
  "gook", "hardon", "jap", "japs",
  "abruti", "abrutie", "adhd", "affanculo", "arsch", "arschloch", "bagascia", "baise", "baisé",
  "baiser", "baldracca", "batard", "battona", "bite", "bocchinara", "bocchinaro", "bollera",
  "bougnoul", "branleur", "burne", "cabron", "cabrón", "cabrona", "cabronazo", "capulla",
  "capullo", "cazzi", "cazzo", "chiavare", "chichi", "chier", "chocho", "cocu", "coglione",
  "cojon", "cojón", "cojones", "comepollas", "con", "connard", "connasse", "conne", "cono",
  "coño", "couille", "couillon", "couillonne", "crevard", "cul", "culattone", "culo",
  "dio bestia", "dio cane", "dio porco", "drecksack", "drecksau", "encule", "enculé", "enculee",
  "enculée", "enculer", "enfoire", "enfoiré", "fanculo", "fica", "ficken", "fickfresse", "figa",
  "fion", "follar", "follen", "fottere", "fotze", "foutre", "frocio", "furcia", "gilipollas",
  "hackfresse", "hijaputa", "hijo puta", "hijoputa", "holocaust", "hostia", "hurensohn",
  "inculare", "joder", "jodete", "jódetE", "joputa", "judensau", "kacke", "kanacke",
  "mamada", "mamon", "mamón", "mamona", "marica", "maricon", "maricón", "maricona", "mariconazo",
  "merde", "mignotta", "minchia", "missgeburt", "negre", "nègre", "negresse", "négresse",
  "nique", "niquer", "nutte", "ojete", "ostia", "padophiler", "pädophiler", "pajillero",
  "partouze", "pede", "pédé", "pendon", "pendón", "petasse", "pétasse", "picha", "pine",
  "pisser", "polla", "pollon", "pollón", "polvo", "pompinara", "pompino", "porco dio",
  "potorro", "pouffe", "pouffiasse", "puta", "putain", "pute", "puto", "puton", "putón",
  "puttana", "queer", "ricchione", "rottinculo", "salaud", "salop", "salopard", "salope",
  "sborra", "scheiße", "scheiße", "schlampe", "schwanz", "schwuchtel", "segaiolo", "sieg heil",
  "sodomie", "spasti", "stricher", "sucer", "tapette", "tare", "taré", "tortillera", "troia",
  "troietta", "troiona", "troione", "vaffanculo", "vagin", "vollidiot", "wichser", "zoccola",
  "zorron", "zorrón",

  // 日本語
  "いらまちお", "おまんこ", "せいえき", "ファック", "きえて", "きえろ", "きちがい", "きんたま",
  "くたばれ", "くりとりす", "コカイン", "56す", "ころすぞ", "ころすよ", "ぶっころす", "ごうかん",
  "ザーメン", "ざっこ", "しこしこ", "じさつ", "しつこい", "4ね", "タヒね", "しねば", "しねよ",
  "しょうべん", "しんで", "しんでよ", "しんでくれ", "セックス", "ぜつりん", "セフレ", "だいべん",
  "ダウンしょう", "だまれ", "ちしょう", "ちしょー", "ちんかす", "ちんちん", "ちんぼ", "ちんぽ",
  "ちんぽこ", "でかちん", "ふぇらちお", "へたくそ", "ぺにす", "ヘロイン", "ぽこちん", "まんこ",
  "まんかす", "メンヘラ", "やくたたず", "よわい", "かよわい", "よわすぎ", "リストカット", "レイプ",
  "かっす", "まじきち", "リスカ", "おなる", "せんぱん", "ちんこ", "ざこ", "ヒトラー", "ぱいぱん",
  "くろんぼ", "めくら", "おなにー", "おめこ", "まんげ", "ガイジ", "けつあな", "あべしね", "しね",
  "あべやめろ", "やめろ", "だっぷん", "しねくそ", "ごみかす", "ごみくず", "しゃせい", "ぼっき",
  "ちんげ", "ちゃんころ", "ころす", "あほ", "ばか", "おっぱい", "チョッパリ", "しっこ", "おしっこ",
  "うんこ", "うんち", "ろりこん", "あなる", "やりまん",
  "あいえき", "いぬごろし", "いんぱい", "いんもう", "かたわ", "けとう", "さんごくじん", "しなじん",
  "ちんば", "つんぼ", "どかた", "とさつ", "どもり", "にぐろ", "にんぴにん", "びっこ", "ひにん",
  "ふぇら", "ぶらく", "やらせろ", "りょうじょく",
  
  // 日本語（漢字表記バリエーション）
  "愛液", "犬殺し", "淫売", "陰毛", "強姦", "殺す", "死ね", "精液", "支那人", "屠殺",
  "避妊", "陵辱", "自殺", "消えろ", "消えて", "くたばれ", "馬鹿", "阿呆", "糞", "大便",
  "小便", "勃起", "射精", "脱糞", "近親相姦", "売春", "買春", "自傷", "殺人", "死体", "死亡", "即死", "殺害",

  // 韓国語
  "강간", "개새끼", "개지랄", "걸레같은년", "걸레년", "귀두", "성감대", "성폭행", "니미랄",
  "딸딸이", "미친년", "미친놈", "병신", "보지", "부랄", "불알", "빠구리", "빠굴이", "빨아",
  "사까시", "성관계", "성행위", "섹스", "시팔년", "시팔놈", "쌍넘", "쌍년", "쌍놈", "쌍뇬",
  "씨발", "씨발넘", "씨발년", "씨발놈", "씨발뇬", "씹새끼", "염병", "오르", "왕자지", "유두",
  "자지", "잠지", "정액", "창녀", "콘돔", "클리토리스", "페니스", "핥아", "후장"
];

function katakanaToHiragana(src: string): string {
  return src.replace(/[\u30a1-\u30f6]/g, (match) => {
    const chr = match.charCodeAt(0) - 0x60;
    return String.fromCharCode(chr);
  });
}

const NORMALIZED_BAD_WORDS = SUBSTRING_BAD_WORDS.map(w => katakanaToHiragana(w.toLowerCase()));

function containsInappropriateContent(text: string): boolean {
  if (!text) return false;

  const lowerText = katakanaToHiragana(text.trim().toLowerCase());

  // 1. 完全一致・単独単語チェック (BJ, SS などの誤判定防止のため単体のみNG)
  const words = lowerText.split(/[\s\-_.,/]+/);
  for (const w of words) {
    if (EXACT_BAD_WORDS.has(w)) {
      return true;
    }
  }

  // 2. 部分一致チェック (スペースや記号を挟むすり抜け対策のため除去して判定)
  const normalized = lowerText.replace(/[\s\-_.,/*~()]+/g, '');

  for (const badWord of NORMALIZED_BAD_WORDS) {
    if (normalized.includes(badWord)) {
      return true;
    }
  }

  return false;
}

async function handlePostCreateCheckoutSession(
  request: Request,
  env: Env,
  session: { session_id: string }
): Promise<Response> {
  const body = await request.json<{ item?: 'souls_500' | 'souls_1500' | 'souls_4000' }>().catch(() => ({ item: undefined }));
  const { item } = body;
  const sessionId = session.session_id;

  if (!item || (item !== 'souls_500' && item !== 'souls_1500' && item !== 'souls_4000')) {
    return new Response(JSON.stringify({ error: 'Invalid purchase item' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  const stripeSecret = env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return new Response(JSON.stringify({ error: 'Stripe configuration missing on server' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  const stripe = new Stripe(stripeSecret, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const requestUrl = new URL(request.url);
  const successUrl = `${requestUrl.origin}/?payment=success&item=${item}`;
  const cancelUrl = `${requestUrl.origin}/?payment=cancel`;

  let name = '';
  let amount = 0;
  if (item === 'souls_500') {
    name = '500 Souls';
    amount = 199; // $1.99 USD
  } else if (item === 'souls_1500') {
    name = '1,500 Souls';
    amount = 499; // $4.99 USD
  } else if (item === 'souls_4000') {
    name = '4,000 Souls';
    amount = 999; // $9.99 USD
  }

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: name,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        session_id: sessionId,
        purchase_item: item,
      },
    });

    return new Response(JSON.stringify({ url: checkoutSession.url }), {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(request),
      },
    });
  } catch (err: any) {
    console.error('Failed to create Stripe checkout session:', err);
    return new Response(JSON.stringify({ error: err.message || 'Stripe error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }
}

async function handlePostStripeWebhook(request: Request, env: Env): Promise<Response> {
  const stripeSecret = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecret || !webhookSecret) {
    return new Response('Stripe secret or webhook secret missing', { status: 500 });
  }

  const stripe = new Stripe(stripeSecret, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  const bodyText = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(bodyText, signature, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = session.metadata;

    if (metadata && metadata.session_id && metadata.purchase_item) {
      const sessionId = metadata.session_id;
      const purchaseItem = metadata.purchase_item;
      console.log(`Processing completed payment for session ${sessionId}, item: ${purchaseItem}`);

      try {
        let amount = 0;
        if (purchaseItem === 'souls_500') {
          amount = 500;
        } else if (purchaseItem === 'souls_1500') {
          amount = 1500;
        } else if (purchaseItem === 'souls_4000') {
          amount = 4000;
        }

        if (amount > 0) {
          const now = Date.now();
          const nowIso = new Date(now).toISOString();
          const grantId = `soul_grant_${crypto.randomUUID()}`;
          const grantResult = await env.DB.prepare(
            `INSERT OR IGNORE INTO soul_grants (
               id,
               session_id,
               stripe_checkout_session_id,
               purchase_item,
               amount,
               remaining_amount,
               issued_at,
               expires_at,
               status,
               created_at,
               updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
          ).bind(
            grantId,
            sessionId,
            session.id ?? grantId,
            purchaseItem,
            amount,
            amount,
            now,
            now + SOUL_GRANT_EXPIRY_MS,
            nowIso,
            nowIso
          ).run();

          if ((grantResult.meta?.changes ?? 0) > 0) {
            await ensureUserSessionRow(env.DB, sessionId, now);
            await env.DB.prepare(
              "UPDATE user_sessions SET souls = COALESCE(souls, 0) + ?, souls_version = COALESCE(souls_version, 0) + 1 WHERE session_id = ?"
            ).bind(amount, sessionId).run();
            console.log(`Successfully granted ${amount} souls to session ${sessionId}`);
          } else {
            console.log(`Stripe grant already recorded for checkout session ${session.id ?? 'unknown'}`);
          }
        }
      } catch (dbErr: any) {
        console.error('Failed to update user session after payment success:', dbErr);
        return new Response('Database update failed', { status: 500 });
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
