/**
 * database.ts - SQLite database manager for checkpoint storage
 * 
 * This layer manages checkpoint persistence using better-sqlite3.
 * Design: Leverage OpenCode's existing session storage, add checkpoint metadata.
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

export interface Checkpoint {
  id: number;
  sessionId: string;
  name: string;
  description: string | null;
  messageCount: number;
  gitCommit: string | null;
  createdAt: number;
  metadata: string; // JSON string
}

export interface CheckpointCreate {
  sessionId: string;
  name: string;
  description?: string;
  messageCount: number;
  gitCommit?: string;
  metadata?: Record<string, any>;
}

export class CheckpointDatabase {
  private db: Database.Database;
  private readonly dbPath: string;

  constructor(dbPath?: string) {
    // Default: ~/.local/share/opencode/checkpoints.db
    this.dbPath = dbPath || join(
      homedir(),
      '.local',
      'share',
      'opencode',
      'checkpoints.db'
    );

    // Ensure directory exists
    const dir = join(homedir(), '.local', 'share', 'opencode');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        message_count INTEGER NOT NULL,
        git_commit TEXT,
        created_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_checkpoints_session 
        ON checkpoints(session_id, created_at DESC);
      
      CREATE INDEX IF NOT EXISTS idx_checkpoints_name 
        ON checkpoints(session_id, name);
    `);
  }

  /**
   * Create a new checkpoint
   */
  createCheckpoint(data: CheckpointCreate): number {
    const stmt = this.db.prepare(`
      INSERT INTO checkpoints (
        session_id, name, description, message_count, 
        git_commit, created_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.sessionId,
      data.name,
      data.description || null,
      data.messageCount,
      data.gitCommit || null,
      Date.now(),
      JSON.stringify(data.metadata || {})
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Get a checkpoint by ID
   */
  getCheckpoint(id: number): Checkpoint | null {
    const stmt = this.db.prepare(`
      SELECT 
        id,
        session_id as sessionId,
        name,
        description,
        message_count as messageCount,
        git_commit as gitCommit,
        created_at as createdAt,
        metadata
      FROM checkpoints
      WHERE id = ?
    `);

    return stmt.get(id) as Checkpoint | null;
  }

  /**
   * List checkpoints for a session
   */
  listCheckpoints(sessionId: string, limit = 50): Checkpoint[] {
    const stmt = this.db.prepare(`
      SELECT 
        id,
        session_id as sessionId,
        name,
        description,
        message_count as messageCount,
        git_commit as gitCommit,
        created_at as createdAt,
        metadata
      FROM checkpoints
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    return stmt.all(sessionId, limit) as Checkpoint[];
  }

  /**
   * Find checkpoint by name (most recent if multiple)
   */
  findCheckpointByName(sessionId: string, name: string): Checkpoint | null {
    const stmt = this.db.prepare(`
      SELECT 
        id,
        session_id as sessionId,
        name,
        description,
        message_count as messageCount,
        git_commit as gitCommit,
        created_at as createdAt,
        metadata
      FROM checkpoints
      WHERE session_id = ? AND name = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    return stmt.get(sessionId, name) as Checkpoint | null;
  }

  /**
   * Delete a checkpoint
   */
  deleteCheckpoint(id: number): boolean {
    const stmt = this.db.prepare('DELETE FROM checkpoints WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Delete all checkpoints for a session
   */
  deleteSessionCheckpoints(sessionId: string): number {
    const stmt = this.db.prepare('DELETE FROM checkpoints WHERE session_id = ?');
    const result = stmt.run(sessionId);
    return result.changes;
  }

  /**
   * Get checkpoint statistics
   */
  getStats(): { totalCheckpoints: number; totalSessions: number } {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as totalCheckpoints,
        COUNT(DISTINCT session_id) as totalSessions
      FROM checkpoints
    `);

    return stmt.get() as { totalCheckpoints: number; totalSessions: number };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Get database path (for testing)
   */
  getPath(): string {
    return this.dbPath;
  }
}
