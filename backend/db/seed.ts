import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore - node:sqlite is available in Node 22, type definitions might be loading
import { DatabaseSync } from 'node:sqlite';
import { 
  generateRandomLineDNA, 
  generateHoneypotLineDNA, 
  generateRandomMosaicDNA, 
  generateHoneypotMosaicDNA 
} from '../src/shared-types';

function generateUUID(): string {
  return crypto.randomUUID();
}

function findSqliteFile(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const found = findSqliteFile(fullPath);
      if (found) return found;
    } else if (file.endsWith('.sqlite')) {
      return fullPath;
    }
  }
  return null;
}

function seedDatabase() {
  const wranglerStateDir = path.join(__dirname, '..', '.wrangler');
  const sqlitePath = findSqliteFile(wranglerStateDir);
  
  if (!sqlitePath) {
    console.error("Could not find SQLite file under .wrangler directory. Make sure you ran 'npm run db:init' first.");
    process.exit(1);
  }

  console.log(`Found local SQLite database at: ${sqlitePath}`);
  const db = new DatabaseSync(sqlitePath);

  try {
    db.exec("BEGIN TRANSACTION;");
    
    // Clear existing
    db.exec("DELETE FROM threads;");
    db.exec("DELETE FROM specimens;");
    db.exec("DELETE FROM thread_history;");
    db.exec("DELETE FROM user_sessions;");

    const nowStr = new Date().toISOString();

    // Insert default threads
    const insertThreadStmt = db.prepare(
      "INSERT INTO threads (id, name, type, creator_session_id, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    insertThreadStmt.run("default-line", "10 Lines (幾何学)", "line", null, nowStr);
    insertThreadStmt.run("default-mosaic", "Mosaic Beauty (美少女)", "mosaic", null, nowStr);

    // Seed specimens (100 total for each, 3 honeypots each)
    const insertSpecimenStmt = db.prepare(
      "INSERT INTO specimens (id, thread_id, generation, dna, likes_count, nopes_count, is_honeypot, is_representative, status) VALUES (?, ?, ?, ?, 0, 0, ?, 0, 'active')"
    );
    
    // Seed default-line specimens
    for (let i = 0; i < 100; i++) {
      const id = `specimen_${generateUUID()}`;
      const generation = 0;
      const isHoneypot = i < 3 ? 1 : 0;
      const dna = isHoneypot ? generateHoneypotLineDNA() : generateRandomLineDNA();
      const dnaStr = JSON.stringify(dna);
      
      insertSpecimenStmt.run(id, "default-line", generation, dnaStr, isHoneypot);
    }

    // Seed default-mosaic specimens
    for (let i = 0; i < 100; i++) {
      const id = `specimen_${generateUUID()}`;
      const generation = 0;
      const isHoneypot = i < 3 ? 1 : 0;
      const dna = isHoneypot ? generateHoneypotMosaicDNA() : generateRandomMosaicDNA();
      const dnaStr = JSON.stringify(dna);

      insertSpecimenStmt.run(id, "default-mosaic", generation, dnaStr, isHoneypot);
    }

    db.exec("COMMIT;");
    console.log("Successfully seeded database via native node:sqlite!");
  } catch (err) {
    db.exec("ROLLBACK;");
    console.error("Failed to seed database:", err);
    process.exit(1);
  }
}

seedDatabase();
