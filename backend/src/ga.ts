import { D1Database } from '@cloudflare/workers-types';
import { 
  LineDNA, 
  MosaicDNA, 
  generateRandomLineDNA, 
  generateRandomMosaicDNA,
  generateHoneypotLineDNA,
  generateHoneypotMosaicDNA,
  pickRandom,
  randomHexColor
} from './shared-types';

// Helper: UUID generator
function generateUUID(): string {
  return crypto.randomUUID();
}

// Helper: blend two hex colors
function blendColors(c1: string, c2: string): string {
  // Simple RGB blending
  const parseHex = (hex: string) => {
    const clean = hex.startsWith('#') ? hex.substring(1) : hex;
    return {
      r: parseInt(clean.substring(0, 2), 16) || 0,
      g: parseInt(clean.substring(2, 4), 16) || 0,
      b: parseInt(clean.substring(4, 6), 16) || 0
    };
  };

  const color1 = parseHex(c1);
  const color2 = parseHex(c2);

  const r = Math.floor((color1.r + color2.r) / 2).toString(16).padStart(2, '0');
  const g = Math.floor((color1.g + color2.g) / 2).toString(16).padStart(2, '0');
  const b = Math.floor((color1.b + color2.b) / 2).toString(16).padStart(2, '0');

  return `#${r}${g}${b}`;
}

// Helper: mutate a hex color slightly
function mutateColor(c: string, rate = 0.15): string {
  const clean = c.startsWith('#') ? c.substring(1) : c;
  let r = parseInt(clean.substring(0, 2), 16) || 0;
  let g = parseInt(clean.substring(2, 4), 16) || 0;
  let b = parseInt(clean.substring(4, 6), 16) || 0;

  const shift = () => Math.floor((Math.random() * 2 - 1) * rate * 255);
  r = Math.max(0, Math.min(255, r + shift()));
  g = Math.max(0, Math.min(255, g + shift()));
  b = Math.max(0, Math.min(255, b + shift()));

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Types for DB entries
interface PoolDBRow {
  id: string;
  generation: number;
  dna: string;
  likes_count: number;
  nopes_count: number;
  is_honeypot: number;
  status: string;
}

// Perform evolution loop for a specific Thread
export async function evolveThread(
  db: D1Database,
  threadId: string,
  threadType: 'line' | 'mosaic',
  representativeCardId?: string | null,
  runAsync?: (promise: Promise<any>) => void
): Promise<{ currentGen: number; nextGen: number }> {
  // 1. Get the current active generation
  const currentGenRow = await db.prepare(
    "SELECT MAX(generation) as gen FROM specimens WHERE thread_id = ? AND status = 'active'"
  ).bind(threadId).first<{ gen: number | null }>();

  const currentGen = currentGenRow?.gen ?? 0;
  const nextGen = currentGen + 1;

  // 2. Fetch active pool (excluding honeypots from GA parents)
  const rows = await db.prepare(
    "SELECT * FROM specimens WHERE thread_id = ? AND generation = ? AND is_honeypot = 0 AND status = 'active'"
  ).bind(threadId, currentGen).all<PoolDBRow>();

  const population = rows.results;
  if (population.length === 0) {
    throw new Error(`No active population found for thread ${threadId} generation ${currentGen}`);
  }

  // 3. Calculate fitness for each individual
  // Use Laplace smoothing: (likes + 1) / (likes + nopes + 2)
  const scoredPopulation = population.map(ind => {
    const dna = JSON.parse(ind.dna);
    const fitness = (ind.likes_count + 1) / (ind.likes_count + ind.nopes_count + 2);
    return { ind, dna, fitness };
  });

  // Sort by fitness descending
  scoredPopulation.sort((a, b) => b.fitness - a.fitness);

  const nextGenerationPool: { dna: any; isHoneypot: number }[] = [];

  // Elite Selection: Keep top 10% (10 individuals) unchanged
  const eliteCount = Math.max(1, Math.floor(scoredPopulation.length * 0.1));
  for (let i = 0; i < eliteCount; i++) {
    nextGenerationPool.push({
      dna: scoredPopulation[i].dna,
      isHoneypot: 0
    });
  }

  // Crossover & Mutation for remaining slots
  // We need 97 slots (since 3 will be newly generated honeypots to make 100 total)
  const targetSize = 97;
  const parentsPool = scoredPopulation.slice(0, Math.max(2, Math.floor(scoredPopulation.length * 0.5)));

  while (nextGenerationPool.length < targetSize) {
    const parentA = pickRandom(parentsPool);
    const parentB = pickRandom(parentsPool);

    let childDNA: any;

    if (threadType === 'line') {
      const parentLineA = parentA.dna as LineDNA;
      const parentLineB = parentB.dna as LineDNA;
      const lineChild: LineDNA = [];
      for (let i = 0; i < 10; i++) {
        const lineGene = Math.random() > 0.5 ? parentLineA[i] : parentLineB[i];
        
        // Mutation: 5% chance per line gene
        if (Math.random() < 0.05) {
          const mutatedGene = { ...lineGene };
          // Mutate positions slightly by +/- 15%
          const mutateVal = (v: number) => Math.max(0, Math.min(1, v + (Math.random() * 2 - 1) * 0.15));
          mutatedGene.sx = mutateVal(mutatedGene.sx);
          mutatedGene.sy = mutateVal(mutatedGene.sy);
          mutatedGene.cp1x = mutateVal(mutatedGene.cp1x);
          mutatedGene.cp1y = mutateVal(mutatedGene.cp1y);
          mutatedGene.cp2x = mutateVal(mutatedGene.cp2x);
          mutatedGene.cp2y = mutateVal(mutatedGene.cp2y);
          mutatedGene.ex = mutateVal(mutatedGene.ex);
          mutatedGene.ey = mutateVal(mutatedGene.ey);
          
          // Mutate width slightly
          mutatedGene.width = Math.max(0.1, Math.min(1.0, mutatedGene.width + (Math.random() * 2 - 1) * 0.1));
          
          lineChild.push(mutatedGene);
        } else {
          lineChild.push({ ...lineGene });
        }
      }
      childDNA = lineChild;
    } else {
      const parentMosaicA = parentA.dna as MosaicDNA;
      const parentMosaicB = parentB.dna as MosaicDNA;
      const mosaicChild: MosaicDNA = [];
      for (let i = 0; i < 30; i++) {
        // Crossover: 50% chance per node to pick from parent A or parent B
        const parentNode = Math.random() > 0.5 ? parentMosaicA[i] : parentMosaicB[i];
        const childNode = { ...parentNode };

        // Mutation: 5% chance per node
        if (Math.random() < 0.05) {
          const rand = Math.random();
          if (rand < 0.25) {
            // Re-connect inputs
            const maxInputIndex = 4 + i;
            childNode.in1 = Math.floor(Math.random() * maxInputIndex);
            childNode.in2 = Math.floor(Math.random() * maxInputIndex);
          } else if (rand < 0.75) {
            // Jitter or reset weights
            const jitter = (w: number) => {
              if (Math.random() < 0.2) return Math.random() * 4.0 - 2.0;
              return Math.max(-2.0, Math.min(2.0, w + (Math.random() * 2 - 1) * 0.3));
            };
            childNode.w1 = jitter(childNode.w1);
            childNode.w2 = jitter(childNode.w2);
          } else {
            // Change activation function
            childNode.fn = Math.floor(Math.random() * 8);
          }
        }
        mosaicChild.push(childNode);
      }
      childDNA = mosaicChild;
    }

    nextGenerationPool.push({
      dna: childDNA,
      isHoneypot: 0
    });
  }

  // Insert 3 new honeypots
  for (let i = 0; i < 3; i++) {
    nextGenerationPool.push({
      dna: threadType === 'line' ? generateHoneypotLineDNA() : generateHoneypotMosaicDNA(),
      isHoneypot: 1
    });
  }

  // 1. 代表値の更新 (同期処理)
  await db.prepare(`
    UPDATE specimens SET is_representative = 1 WHERE id = (
      SELECT id FROM specimens 
      WHERE thread_id = ? AND generation = ? 
      ORDER BY CASE WHEN id = ? THEN 1 ELSE 0 END DESC, likes_count DESC, id ASC 
      LIMIT 1
    )
  `).bind(threadId, currentGen, representativeCardId || '').run();

  // 2. 最初の20件を同期的にインサート (ユーザーが即座にスワイプ再開できるよう20件にする)
  const firstChunk = nextGenerationPool.slice(0, 20);
  const initialStatements = firstChunk.map(item => {
    const id = `${threadType}_${generateUUID()}`;
    const dnaStr = JSON.stringify(item.dna);
    return db.prepare(
      "INSERT INTO specimens (id, thread_id, generation, dna, likes_count, nopes_count, is_honeypot, is_representative, status) VALUES (?, ?, ?, ?, 0, 0, ?, 0, 'active')"
    ).bind(id, threadId, nextGen, dnaStr, item.isHoneypot);
  });
  await db.batch(initialStatements);

  // 3. 残りの80件と現世代のアーカイブ/削除を非同期でバッチ処理
  const asyncInsertTask = (async () => {
    const remainingPool = nextGenerationPool.slice(20);
    const CHUNK_SIZE = 80;
    for (let i = 0; i < remainingPool.length; i += CHUNK_SIZE) {
      const chunk = remainingPool.slice(i, i + CHUNK_SIZE);
      const chunkStatements = chunk.map(item => {
        const id = `${threadType}_${generateUUID()}`;
        const dnaStr = JSON.stringify(item.dna);
        return db.prepare(
          "INSERT INTO specimens (id, thread_id, generation, dna, likes_count, nopes_count, is_honeypot, is_representative, status) VALUES (?, ?, ?, ?, 0, 0, ?, 0, 'active')"
        ).bind(id, threadId, nextGen, dnaStr, item.isHoneypot);
      });
      await db.batch(chunkStatements);
    }
    
    // 全インサート後に現世代をアーカイブまたは削除
    if (currentGen % 10 === 0) {
      await db.prepare(
        "UPDATE specimens SET status = 'archived' WHERE thread_id = ? AND generation = ?"
      ).bind(threadId, currentGen).run();
    } else {
      await db.prepare(
        "DELETE FROM specimens WHERE thread_id = ? AND generation = ?"
      ).bind(threadId, currentGen).run();
    }
  })();

  // 非同期タスクを実行環境(Wrangler/Cloudflare Workers)の ctx.waitUntil に流す
  if (runAsync) {
    runAsync(asyncInsertTask);
  } else {
    // ローカルテスト用やコールバックが無い場合は待つ
    await asyncInsertTask;
  }

  return { currentGen, nextGen };
}

export function mutateLineDNA(dna: LineDNA, rate = 0.3): LineDNA {
  return dna.map(gene => {
    if (Math.random() < rate) {
      const mutated = { ...gene };
      const mutateVal = (v: number) => Math.max(0, Math.min(1, v + (Math.random() * 2 - 1) * 0.15));
      mutated.sx = mutateVal(mutated.sx);
      mutated.sy = mutateVal(mutated.sy);
      mutated.cp1x = mutateVal(mutated.cp1x);
      mutated.cp1y = mutateVal(mutated.cp1y);
      mutated.cp2x = mutateVal(mutated.cp2x);
      mutated.cp2y = mutateVal(mutated.cp2y);
      mutated.ex = mutateVal(mutated.ex);
      mutated.ey = mutateVal(mutated.ey);
      mutated.width = Math.max(0.1, Math.min(1.0, mutated.width + (Math.random() * 2 - 1) * 0.1));
      return mutated;
    }
    return { ...gene };
  });
}

export function mutateMosaicDNA(dna: MosaicDNA, rate = 0.3): MosaicDNA {
  return dna.map((node, i) => {
    if (Math.random() < rate) {
      const childNode = { ...node };
      const rand = Math.random();
      if (rand < 0.25) {
        const maxInputIndex = 4 + i;
        childNode.in1 = Math.floor(Math.random() * maxInputIndex);
        childNode.in2 = Math.floor(Math.random() * maxInputIndex);
      } else if (rand < 0.75) {
        const jitter = (w: number) => {
          if (Math.random() < 0.2) return Math.random() * 4.0 - 2.0;
          return Math.max(-2.0, Math.min(2.0, w + (Math.random() * 2 - 1) * 0.3));
        };
        childNode.w1 = jitter(childNode.w1);
        childNode.w2 = jitter(childNode.w2);
      } else {
        childNode.fn = Math.floor(Math.random() * 8);
      }
      return childNode;
    }
    return { ...node };
  });
}

