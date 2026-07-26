import { Env } from './index';

// CORS Headers Helper
function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('Origin') || '*';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin === 'null' ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret, cf-turnstile-response, x-session-id, Cookie',
    'Access-Control-Max-Age': '86400',
  };
  if (origin !== '*' && origin !== 'null') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

// Admin Secret Verification
function verifyAdmin(request: Request, env: Env): boolean {
  // Bypassed as per user request to allow public access without passwords
  return true;
}

// 1. GET /api/admin/stats
export async function handleAdminStats(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(request) });
  }

  try {
    const totalSessions = await env.DB.prepare("SELECT COUNT(*) as cnt FROM user_sessions").first<{ cnt: number }>();
    const totalThreads = await env.DB.prepare("SELECT COUNT(*) as cnt FROM threads").first<{ cnt: number }>();
    const totalSwipes = await env.DB.prepare("SELECT SUM(total_swipes) as cnt FROM threads").first<{ cnt: number }>();

    // Fetch noise outs distribution from user_sessions
    const outsRows = await env.DB.prepare(
      "SELECT outs, COUNT(*) as cnt FROM user_sessions GROUP BY outs ORDER BY outs ASC"
    ).all<{ outs: number; cnt: number }>();

    return new Response(JSON.stringify({
      success: true,
      stats: {
        totalSessions: totalSessions?.cnt ?? 0,
        totalThreads: totalThreads?.cnt ?? 0,
        totalSwipes: totalSwipes?.cnt ?? 0,
        outsDistribution: outsRows.results ?? []
      }
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }
}

// 2. GET /api/admin/threads
export async function handleAdminThreads(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(request) });
  }

  if (!verifyAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  try {
    const rows = await env.DB.prepare("SELECT * FROM threads ORDER BY created_at DESC").all<any>();
    return new Response(JSON.stringify({
      success: true,
      threads: rows.results ?? []
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }
}

// Helper: Calculate variance of DNA genes
function calculateDnaVariance(dnas: any[], type: 'line' | 'mosaic'): { mean: number; variance: number } {
  const values: number[] = [];

  for (const dna of dnas) {
    if (!dna || !Array.isArray(dna)) continue;
    
    if (type === 'line') {
      for (const gene of dna) {
        if (typeof gene.sx === 'number') values.push(gene.sx);
        if (typeof gene.sy === 'number') values.push(gene.sy);
        if (typeof gene.cp1x === 'number') values.push(gene.cp1x);
        if (typeof gene.cp1y === 'number') values.push(gene.cp1y);
        if (typeof gene.cp2x === 'number') values.push(gene.cp2x);
        if (typeof gene.cp2y === 'number') values.push(gene.cp2y);
        if (typeof gene.ex === 'number') values.push(gene.ex);
        if (typeof gene.ey === 'number') values.push(gene.ey);
        if (typeof gene.width === 'number') values.push(gene.width);
      }
    } else {
      // CGP weights w1 and w2
      for (const node of dna) {
        if (typeof node.w1 === 'number') values.push(node.w1);
        if (typeof node.w2 === 'number') values.push(node.w2);
      }
    }
  }

  if (values.length === 0) return { mean: 0, variance: 0 };

  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;

  return { mean, variance };
}

// 3. GET /api/admin/thread-stats
export async function handleAdminThreadStats(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(request) });
  }

  if (!verifyAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  const url = new URL(request.url);
  const threadId = url.searchParams.get('thread_id');
  if (!threadId) {
    return new Response(JSON.stringify({ error: 'Missing thread_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  try {
    // A. Fetch the thread information
    const thread = await env.DB.prepare("SELECT * FROM threads WHERE id = ?").bind(threadId).first<any>();
    if (!thread) {
      return new Response(JSON.stringify({ error: 'Thread not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
      });
    }

    // B. Fetch active specimens in this thread to calculate dynamic stats
    const specimens = await env.DB.prepare(
      "SELECT generation, likes_count, nopes_count, dna FROM specimens WHERE thread_id = ? AND status = 'active'"
    ).bind(threadId).all<any>();
    
    // C. Fetch thread history
    const history = await env.DB.prepare(
      "SELECT generation, likes_count, nopes_count, dna FROM thread_history WHERE thread_id = ? ORDER BY generation ASC"
    ).bind(threadId).all<any>();

    // D. Build chronological generation statistics
    const generationStatsMap = new Map<number, {
      generation: number;
      likes: number;
      nopes: number;
      dnas: any[];
    }>();

    const addRecord = (gen: number, likes: number, nopes: number, dnaStr: string) => {
      let rec = generationStatsMap.get(gen);
      if (!rec) {
        rec = { generation: gen, likes: 0, nopes: 0, dnas: [] };
        generationStatsMap.set(gen, rec);
      }
      rec.likes += likes;
      rec.nopes += nopes;
      try {
        const dna = JSON.parse(dnaStr);
        rec.dnas.push(dna);
      } catch (e) {}
    };

    // Populate from history
    for (const h of history.results ?? []) {
      addRecord(h.generation, h.likes_count ?? 0, h.nopes_count ?? 0, h.dna);
    }

    // Populate from active specimens
    for (const s of specimens.results ?? []) {
      addRecord(s.generation, s.likes_count ?? 0, s.nopes_count ?? 0, s.dna);
    }

    // Calculate metrics for each generation
    const statsList = Array.from(generationStatsMap.values())
      .map(genData => {
        const totalVotes = genData.likes + genData.nopes;
        const likeRate = totalVotes > 0 ? genData.likes / totalVotes : 0;
        const { mean, variance } = calculateDnaVariance(genData.dnas, thread.type);

        return {
          generation: genData.generation,
          totalVotes,
          likes: genData.likes,
          nopes: genData.nopes,
          likeRate,
          dnaMean: mean,
          dnaVariance: variance,
          dnas: genData.dnas.length > 0 ? [genData.dnas[0]] : []
        };
      })
      .sort((a, b) => a.generation - b.generation);

    return new Response(JSON.stringify({
      success: true,
      thread,
      generations: statsList
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }
}
