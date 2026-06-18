import { D1Database, ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';
import { evolveThread, mutateLineDNA, mutateMosaicDNA } from './ga';
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
  const token = cookies['auth_token'];
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

  // Check if session is banned
  const session = await env.DB.prepare(
    "SELECT banned FROM user_sessions WHERE session_id = ?"
  ).bind(payload.session_id).first<{ banned: number }>();

  if (session && session.banned === 1) {
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

  return new Response(JSON.stringify({ success: true, session_id: sessionId, type: 'anonymous' }), {
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

  return new Response(JSON.stringify({ success: true, session_id: sessionId, clerk_user_id: clerkUserId, type: 'authenticated' }), {
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
      isAdFree: (row?.is_ad_free ?? 0) === 1
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

      // 4. Update the current upgraded session with the merged values and clerk_user_id
      await env.DB.prepare(
        `UPDATE user_sessions
         SET clerk_user_id = ?,
             stamina = ?,
             max_stamina = ?,
             lifetime_swipes = ?,
             last_recovery_time = ?,
             souls = ?,
             is_ad_free = ?
         WHERE session_id = ?`
      ).bind(
        googleUserId,
        merged.stamina,
        merged.maxStamina,
        merged.lifetimeSwipes,
        merged.lastRecoveryTime,
        merged.souls,
        merged.isAdFree ? 1 : 0,
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

    return new Response(null, {
      status: 302,
      headers: {
        'Location': fallbackUrl,
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
      if (url.pathname === '/api/threads/likes' && request.method === 'GET') {
        return await handleGetThreadLikes(request, env);
      }
      if (url.pathname === '/api/threads/history' && request.method === 'GET') {
        return await handleGetThreadHistory(request, env);
      }

      // Admin endpoints
      if (url.pathname === '/api/admin/run-ga' && request.method === 'POST') {
        return await handleAdminRunGA(request, env);
      }

      // Authenticated endpoints
      if (url.pathname.startsWith('/api/')) {
        const sessionOrResponse = await authenticateSession(request, env);
        if (sessionOrResponse instanceof Response) {
          return sessionOrResponse;
        }

        if (url.pathname === '/api/threads' && request.method === 'POST') {
          return await handlePostThread(request, env, sessionOrResponse);
        }
        if (url.pathname === '/api/threads/delete' && request.method === 'POST') {
          return await handlePostDeleteThread(request, env, sessionOrResponse);
        }
        if (url.pathname === '/api/cards' && request.method === 'GET') {
          return await handleGetCards(request, env, sessionOrResponse);
        }
        if (url.pathname === '/api/swipe' && request.method === 'POST') {
          return await handlePostSwipe(request, env, sessionOrResponse);
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
  },

  // Cron trigger execution
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('Running scheduled genetic algorithm evolution...');
    try {
      const { results: threads } = await env.DB.prepare(
        "SELECT id, type FROM threads"
      ).all<{ id: string; type: 'line' | 'mosaic' }>();

      for (const thread of threads) {
        try {
          const res = await evolveThread(env.DB, thread.id, thread.type);
          console.log(`Thread ${thread.id} evolved: Gen ${res.currentGen} -> Gen ${res.nextGen}`);
        } catch (e) {
          console.error(`Failed to evolve thread ${thread.id}:`, e);
        }
      }
    } catch (err) {
      console.error('Failed to run scheduled GA evolution:', err);
    }
  }
};

// GET /api/threads
// Ranking: Hacker News-style hybrid score = (total_swipes + 1) / (age_hours + 2)^1.5
// New projects appear near top by default; active ones stay visible; all decay over time.
async function handleGetThreads(request: Request, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT
       t.id, t.name, t.type, t.creator_session_id, t.created_at,
       COALESCE(MAX(s.generation), 0) AS generation,
       COALESCE(SUM(s.likes_count + s.nopes_count), 0) AS total_swipes
     FROM threads t
     LEFT JOIN specimens s ON t.id = s.thread_id AND s.status = 'active'
     GROUP BY t.id
     ORDER BY
       (COALESCE(SUM(s.likes_count + s.nopes_count), 0) + 1.0)
       / exp(1.5 * log(
           (CAST(strftime('%s', 'now') AS REAL) - CAST(strftime('%s', t.created_at) AS REAL))
           / 3600.0 + 2.0
         ))
       DESC`
  ).all<{ id: string; name: string; type: string; creator_session_id: string | null; created_at: string; generation: number; total_swipes: number }>();

  return new Response(JSON.stringify({ threads: results }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

// POST /api/threads
async function handlePostThread(request: Request, env: Env, session: { session_id: string }): Promise<Response> {
  const sessionId = session.session_id;
  const body = await request.json<{ name?: string; type?: 'line' | 'mosaic'; fork_dna?: any }>();
  const { name, type, fork_dna } = body;

  if (!name || !type || (type !== 'line' && type !== 'mosaic')) {
    return new Response(JSON.stringify({ error: 'Invalid name or type. Type must be "line" or "mosaic"' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  const threadId = `thread_${crypto.randomUUID()}`;
  const nowStr = new Date().toISOString();

  // 1. Insert Thread
  await env.DB.prepare(
    "INSERT INTO threads (id, name, type, creator_session_id, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(threadId, name, type, sessionId || null, nowStr).run();

  // 2. Generate 100 specimens for Gen 0 (97 random or mutated, 3 honeypots)
  const statements = [];
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
    const dnaStr = JSON.stringify(dna);

    statements.push(
      env.DB.prepare(
        "INSERT INTO specimens (id, thread_id, generation, dna, likes_count, nopes_count, is_honeypot, status) VALUES (?, ?, 0, ?, 0, 0, ?, 'active')"
      ).bind(specimenId, threadId, dnaStr, isHoneypot)
    );
  }

  await env.DB.batch(statements);

  return new Response(JSON.stringify({ success: true, thread: { id: threadId, name, type, generation: 0 } }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
  });
}

// GET /api/cards?thread_id=...
async function handleGetCards(request: Request, env: Env, session: { session_id: string }): Promise<Response> {
  const url = new URL(request.url);
  const threadId = url.searchParams.get('thread_id');
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
      const res = await evolveThread(env.DB, threadId, thread.type, lastSwipedCardId);
      activeGen = res.nextGen;
      await claimCardsForSession(env.DB, threadId, activeGen, sessionId, 20, excludeIds);
      results = await fetchAssignedCardsForSession(env.DB, threadId, activeGen, sessionId, excludeIds);
    }
  }

  // Parse DNA string back to object
  const cards = results.map(row => ({
    id: row.id,
    generation: row.generation,
    dna: JSON.parse(row.dna),
    is_honeypot: row.is_honeypot === 1
  }));

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

  // Retrieve exactly one representative specimen for each archived generation
  const { results } = await env.DB.prepare(
    `SELECT generation, id, dna, likes_count, nopes_count 
     FROM specimens s1
     WHERE thread_id = ? AND status = 'archived'
       AND id = (
         SELECT id FROM specimens s2
         WHERE s2.thread_id = s1.thread_id
           AND s2.generation = s1.generation
           AND s2.status = 'archived'
         ORDER BY s2.is_representative DESC, s2.likes_count DESC, s2.id ASC
         LIMIT 1
       )
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
    isAdFree?: boolean;
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
      "INSERT INTO user_sessions (session_id, stamina, max_stamina, last_recovery_time) VALUES (?, ?, ?, ?)"
    ).bind(sessionId, clientState.stamina ?? 80, clientState.maxStamina ?? 80, clientState.lastRecoveryTime ?? now).run();
    
    serverRow = {
      stamina: clientState.stamina ?? 80,
      max_stamina: clientState.maxStamina ?? 80,
      lifetime_swipes: clientState.lifetimeSwipes ?? 0,
      last_recovery_time: clientState.lastRecoveryTime ?? now,
      souls: clientState.souls ?? 0,
      is_ad_free: clientState.isAdFree ? 1 : 0
    };
  }

  const clientParsed: GameState = {
    stamina: clientState.stamina ?? 80,
    maxStamina: clientState.maxStamina ?? 80,
    lifetimeSwipes: clientState.lifetimeSwipes ?? 0,
    lastRecoveryTime: clientState.lastRecoveryTime ?? Date.now(),
    souls: clientState.souls ?? 0,
    isAdFree: clientState.isAdFree ?? false
  };

  const serverParsed: GameState = {
    stamina: serverRow.stamina ?? 80,
    maxStamina: serverRow.max_stamina ?? 80,
    lifetimeSwipes: serverRow.lifetime_swipes ?? 0,
    lastRecoveryTime: serverRow.last_recovery_time ?? Date.now(),
    souls: serverRow.souls ?? 0,
    isAdFree: (serverRow.is_ad_free ?? 0) === 1
  };

  // 2. Merge states using standard conflict resolution
  const merged = mergeGameStates(clientParsed, serverParsed);

  // 3. Write merged state back to database
  await env.DB.prepare(
    `UPDATE user_sessions
     SET stamina = ?,
         max_stamina = ?,
         lifetime_swipes = ?,
         last_recovery_time = ?,
         souls = ?,
         is_ad_free = ?
     WHERE session_id = ?`
  ).bind(
    merged.stamina,
    merged.maxStamina,
    merged.lifetimeSwipes,
    merged.lastRecoveryTime,
    merged.souls,
    merged.isAdFree ? 1 : 0,
    sessionId
  ).run();

  return new Response(JSON.stringify({ success: true, state: merged }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
  });
}
