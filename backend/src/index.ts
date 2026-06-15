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

export interface Env {
  DB: D1Database;
  TURNSTILE_SECRET?: string;
  ADMIN_SECRET?: string;
}

// CORS Headers Helper
function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, cf-turnstile-response, x-session-id',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    try {
      if (url.pathname === '/api/threads' && request.method === 'GET') {
        return await handleGetThreads(request, env);
      }

      if (url.pathname === '/api/threads' && request.method === 'POST') {
        return await handlePostThread(request, env);
      }

      if (url.pathname === '/api/threads/delete' && request.method === 'POST') {
        return await handlePostDeleteThread(request, env);
      }

      if (url.pathname === '/api/threads/likes' && request.method === 'GET') {
        return await handleGetThreadLikes(request, env);
      }

      if (url.pathname === '/api/threads/history' && request.method === 'GET') {
        return await handleGetThreadHistory(request, env);
      }

      if (url.pathname === '/api/cards' && request.method === 'GET') {
        return await handleGetCards(request, env);
      }

      if (url.pathname === '/api/swipe' && request.method === 'POST') {
        return await handlePostSwipe(request, env);
      }

      if (url.pathname === '/api/admin/run-ga' && request.method === 'POST') {
        return await handleAdminRunGA(request, env);
      }

      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
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
async function handleGetThreads(request: Request, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.name, t.type, t.creator_session_id, t.created_at, COALESCE(MAX(s.generation), 0) as generation 
     FROM threads t 
     LEFT JOIN specimens s ON t.id = s.thread_id AND s.status = 'active' 
     GROUP BY t.id 
     ORDER BY t.created_at ASC`
  ).all<{ id: string; name: string; type: string; creator_session_id: string | null; created_at: string; generation: number }>();

  return new Response(JSON.stringify({ threads: results }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

// POST /api/threads
async function handlePostThread(request: Request, env: Env): Promise<Response> {
  const sessionId = request.headers.get('x-session-id') || '';
  const body = await request.json<{ name?: string; type?: 'line' | 'mosaic'; fork_dna?: any }>();
  const { name, type, fork_dna } = body;

  if (!name || !type || (type !== 'line' && type !== 'mosaic')) {
    return new Response(JSON.stringify({ error: 'Invalid name or type. Type must be "line" or "mosaic"' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
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
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

// GET /api/cards?thread_id=...
async function handleGetCards(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const threadId = url.searchParams.get('thread_id');
  const sessionId = request.headers.get('x-session-id') || url.searchParams.get('session_id');

  if (!threadId) {
    return new Response(JSON.stringify({ error: 'Missing thread_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  // Verify thread exists
  const thread = await env.DB.prepare(
    "SELECT * FROM threads WHERE id = ?"
  ).bind(threadId).first<{ id: string; type: 'line' | 'mosaic' }>();

  if (!thread) {
    return new Response(JSON.stringify({ error: 'Thread not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  // 1. Get the current active generation
  const currentGenRow = await env.DB.prepare(
    "SELECT MAX(generation) as gen FROM specimens WHERE thread_id = ? AND status = 'active'"
  ).bind(threadId).first<{ gen: number | null }>();

  const currentGen = currentGenRow?.gen ?? 0;

  // 2. Fetch a random batch of 20 active cards from the current generation,
  // excluding cards the user has already swiped.
  const excludeParam = url.searchParams.get('exclude') || '';
  const excludeIds = excludeParam.split(',').filter(id => id.length > 0);

  let query = `SELECT id, generation, dna FROM specimens WHERE thread_id = ? AND generation = ? AND status = 'active'`;
  const bindParams: any[] = [threadId, currentGen];

  if (excludeIds.length > 0) {
    const placeholders = excludeIds.map(() => '?').join(',');
    query += ` AND id NOT IN (${placeholders})`;
    bindParams.push(...excludeIds);
  }

  query += ` ORDER BY RANDOM() LIMIT 20`;

  let { results } = await env.DB.prepare(query).bind(...bindParams).all<{ id: string; generation: number; dna: string }>();
  let activeGen = currentGen;

  // Auto-evolve if we ran out of cards for this user/session in the current generation
  if (results.length === 0 && excludeIds.length > 0) {
    console.log(`Auto-evolving thread ${threadId} because no unswiped cards remain in generation ${currentGen}.`);
    try {
      const latestGenRow = await env.DB.prepare(
        "SELECT MAX(generation) as gen FROM specimens WHERE thread_id = ? AND status = 'active'"
      ).bind(threadId).first<{ gen: number | null }>();
      const latestGen = latestGenRow?.gen ?? 0;

      if (latestGen > currentGen) {
        activeGen = latestGen;
      } else {
        const lastSwipedCardId = url.searchParams.get('last_swiped_card_id') || (excludeIds.length > 0 ? excludeIds[excludeIds.length - 1] : null);
        const res = await evolveThread(env.DB, threadId, thread.type, lastSwipedCardId);
        activeGen = res.nextGen;
      }

      // Fetch cards from the active generation (no exclusion list needed since it's a fresh pool)
      const newQuery = `SELECT id, generation, dna FROM specimens WHERE thread_id = ? AND generation = ? AND status = 'active' ORDER BY RANDOM() LIMIT 20`;
      const newResults = await env.DB.prepare(newQuery).bind(threadId, activeGen).all<{ id: string; generation: number; dna: string }>();
      results = newResults.results;
    } catch (err) {
      console.error('Failed to auto-evolve:', err);
    }
  }

  // Parse DNA string back to object
  const cards = results.map(row => ({
    id: row.id,
    generation: row.generation,
    dna: JSON.parse(row.dna)
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
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
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

async function handlePostSwipe(request: Request, env: Env): Promise<Response> {
  const body = await request.json<SwipeRequestBody>();
  const { thread_id, card_id, swipe, session_id, turnstile_token } = body;

  if (!thread_id || !card_id || !swipe || !session_id) {
    return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
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
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }
  }

  // 2. Fetch or Create User Session & Check Rate Limit
  const nowStr = new Date().toISOString();
  let session = await env.DB.prepare(
    "SELECT * FROM user_sessions WHERE session_id = ?"
  ).bind(session_id).first<{ session_id: string; daily_swipes: number; bot_flag: number; last_swipe_at: string }>();

  if (!session) {
    await env.DB.prepare(
      "INSERT INTO user_sessions (session_id, daily_swipes, bot_flag, last_swipe_at) VALUES (?, 1, 0, ?)"
    ).bind(session_id, nowStr).run();
    session = { session_id, daily_swipes: 1, bot_flag: 0, last_swipe_at: nowStr };
  } else {
    const lastSwipeTime = new Date(session.last_swipe_at).getTime();
    const nowTime = Date.now();
    
    if (nowTime - lastSwipeTime < 60000) {
      if (session.daily_swipes % 120 === 0 && nowTime - lastSwipeTime < 5000) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait.' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
      }
    }

    // Update session daily count and timestamp
    await env.DB.prepare(
      "UPDATE user_sessions SET daily_swipes = daily_swipes + 1, last_swipe_at = ? WHERE session_id = ?"
    ).bind(nowStr, session_id).run();
  }

  // 3. Shadow Ban Check
  if (session.bot_flag === 1) {
    return new Response(JSON.stringify({ success: true, message: 'Processed' }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  // 4. Load the Card details to see if it's a honeypot
  const card = await env.DB.prepare(
    "SELECT is_honeypot FROM specimens WHERE id = ?"
  ).bind(card_id).first<{ is_honeypot: number }>();

  if (!card) {
    return new Response(JSON.stringify({ error: 'Card not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  // 5. Honeypot check
  if (card.is_honeypot === 1) {
    if (swipe === 'like') {
      await env.DB.prepare(
        "UPDATE user_sessions SET bot_flag = 1 WHERE session_id = ?"
      ).bind(session_id).run();
      console.warn(`Session ${session_id} shadow-banned due to liking honeypot card ${card_id}`);
    }
    return new Response(JSON.stringify({ success: true, message: 'Processed' }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
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
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
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
async function handlePostDeleteThread(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ thread_id?: string; session_id?: string }>();
  const { thread_id, session_id } = body;

  if (!thread_id || !session_id) {
    return new Response(JSON.stringify({ error: 'Missing thread_id or session_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  // Fetch thread to check creator
  const thread = await env.DB.prepare(
    "SELECT creator_session_id FROM threads WHERE id = ?"
  ).bind(thread_id).first<{ creator_session_id: string | null }>();

  if (!thread) {
    return new Response(JSON.stringify({ error: 'Thread not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  if (!thread.creator_session_id || thread.creator_session_id !== session_id) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Only the creator can delete this thread.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  // Delete specimens and thread in batch
  await env.DB.batch([
    env.DB.prepare("DELETE FROM specimens WHERE thread_id = ?").bind(thread_id),
    env.DB.prepare("DELETE FROM threads WHERE id = ?").bind(thread_id)
  ]);

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}
