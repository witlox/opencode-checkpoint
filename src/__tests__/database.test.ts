/**
 * database.test.ts - Tests for checkpoint database
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CheckpointDatabase } from '../database';
import { unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('CheckpointDatabase', () => {
  let db: CheckpointDatabase;
  const testDbPath = join(tmpdir(), `test-checkpoints-${Date.now()}.db`);

  beforeEach(() => {
    db = new CheckpointDatabase(testDbPath);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('createCheckpoint', () => {
    it('should create a checkpoint with required fields', () => {
      const checkpointId = db.createCheckpoint({
        sessionId: 'session-123',
        name: 'Test Checkpoint',
        messageCount: 10
      });

      expect(checkpointId).toBeGreaterThan(0);

      const checkpoint = db.getCheckpoint(checkpointId);
      expect(checkpoint).toBeDefined();
      expect(checkpoint?.sessionId).toBe('session-123');
      expect(checkpoint?.name).toBe('Test Checkpoint');
      expect(checkpoint?.messageCount).toBe(10);
      expect(checkpoint?.description).toBeNull();
      expect(checkpoint?.gitCommit).toBeNull();
    });

    it('should create a checkpoint with all fields', () => {
      const checkpointId = db.createCheckpoint({
        sessionId: 'session-456',
        name: 'Full Checkpoint',
        description: 'Before major refactor',
        messageCount: 25,
        gitCommit: 'abc123def456',
        metadata: { custom: 'value', count: 42 }
      });

      const checkpoint = db.getCheckpoint(checkpointId);
      expect(checkpoint?.description).toBe('Before major refactor');
      expect(checkpoint?.gitCommit).toBe('abc123def456');
      
      const metadata = JSON.parse(checkpoint!.metadata);
      expect(metadata.custom).toBe('value');
      expect(metadata.count).toBe(42);
    });

    it('should assign sequential IDs', () => {
      const id1 = db.createCheckpoint({
        sessionId: 'session-1',
        name: 'First',
        messageCount: 5
      });

      const id2 = db.createCheckpoint({
        sessionId: 'session-1',
        name: 'Second',
        messageCount: 10
      });

      expect(id2).toBe(id1 + 1);
    });
  });

  describe('getCheckpoint', () => {
    it('should return null for non-existent checkpoint', () => {
      const checkpoint = db.getCheckpoint(999);
      expect(checkpoint).toBeNull();
    });

    it('should return checkpoint by ID', () => {
      const checkpointId = db.createCheckpoint({
        sessionId: 'session-789',
        name: 'Named Checkpoint',
        messageCount: 15
      });

      const checkpoint = db.getCheckpoint(checkpointId);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.id).toBe(checkpointId);
    });
  });

  describe('listCheckpoints', () => {
    it('should return empty array for session with no checkpoints', () => {
      const checkpoints = db.listCheckpoints('nonexistent-session');
      expect(checkpoints).toHaveLength(0);
    });

    it('should return checkpoints in reverse chronological order', () => {
      const sessionId = 'session-chrono';
      
      // Create checkpoints with small delays to ensure different timestamps
      const id1 = db.createCheckpoint({
        sessionId,
        name: 'First',
        messageCount: 5
      });

      // Small delay
      const id2 = db.createCheckpoint({
        sessionId,
        name: 'Second',
        messageCount: 10
      });

      const id3 = db.createCheckpoint({
        sessionId,
        name: 'Third',
        messageCount: 15
      });

      const checkpoints = db.listCheckpoints(sessionId);
      expect(checkpoints).toHaveLength(3);
      
      // Most recent first
      expect(checkpoints[0].id).toBe(id3);
      expect(checkpoints[1].id).toBe(id2);
      expect(checkpoints[2].id).toBe(id1);
    });

    it('should respect limit parameter', () => {
      const sessionId = 'session-limit';
      
      for (let i = 0; i < 10; i++) {
        db.createCheckpoint({
          sessionId,
          name: `Checkpoint ${i}`,
          messageCount: i + 1
        });
      }

      const checkpoints = db.listCheckpoints(sessionId, 5);
      expect(checkpoints).toHaveLength(5);
    });

    it('should only return checkpoints for specified session', () => {
      db.createCheckpoint({
        sessionId: 'session-a',
        name: 'A1',
        messageCount: 5
      });

      db.createCheckpoint({
        sessionId: 'session-b',
        name: 'B1',
        messageCount: 10
      });

      db.createCheckpoint({
        sessionId: 'session-a',
        name: 'A2',
        messageCount: 15
      });

      const checkpointsA = db.listCheckpoints('session-a');
      expect(checkpointsA).toHaveLength(2);
      expect(checkpointsA.every(cp => cp.sessionId === 'session-a')).toBe(true);

      const checkpointsB = db.listCheckpoints('session-b');
      expect(checkpointsB).toHaveLength(1);
    });
  });

  describe('findCheckpointByName', () => {
    it('should return null for non-existent name', () => {
      const checkpoint = db.findCheckpointByName('session-123', 'NonExistent');
      expect(checkpoint).toBeNull();
    });

    it('should find checkpoint by exact name match', () => {
      const sessionId = 'session-names';
      
      db.createCheckpoint({
        sessionId,
        name: 'Before Refactor',
        messageCount: 20
      });

      const found = db.findCheckpointByName(sessionId, 'Before Refactor');
      expect(found).not.toBeNull();
      expect(found?.name).toBe('Before Refactor');
    });

    it('should return most recent when multiple checkpoints have same name', () => {
      const sessionId = 'session-duplicates';
      
      db.createCheckpoint({
        sessionId,
        name: 'Working State',
        messageCount: 10
      });

      const latestId = db.createCheckpoint({
        sessionId,
        name: 'Working State',
        messageCount: 20
      });

      const found = db.findCheckpointByName(sessionId, 'Working State');
      expect(found?.id).toBe(latestId);
      expect(found?.messageCount).toBe(20);
    });

    it('should be case-sensitive', () => {
      const sessionId = 'session-case';
      
      db.createCheckpoint({
        sessionId,
        name: 'MyCheckpoint',
        messageCount: 10
      });

      const found = db.findCheckpointByName(sessionId, 'mycheckpoint');
      expect(found).toBeNull();
    });
  });

  describe('deleteCheckpoint', () => {
    it('should delete checkpoint and return true', () => {
      const checkpointId = db.createCheckpoint({
        sessionId: 'session-delete',
        name: 'To Delete',
        messageCount: 5
      });

      const deleted = db.deleteCheckpoint(checkpointId);
      expect(deleted).toBe(true);

      const checkpoint = db.getCheckpoint(checkpointId);
      expect(checkpoint).toBeNull();
    });

    it('should return false for non-existent checkpoint', () => {
      const deleted = db.deleteCheckpoint(999);
      expect(deleted).toBe(false);
    });
  });

  describe('deleteSessionCheckpoints', () => {
    it('should delete all checkpoints for a session', () => {
      const sessionId = 'session-delete-all';
      
      for (let i = 0; i < 5; i++) {
        db.createCheckpoint({
          sessionId,
          name: `Checkpoint ${i}`,
          messageCount: i + 1
        });
      }

      const count = db.deleteSessionCheckpoints(sessionId);
      expect(count).toBe(5);

      const remaining = db.listCheckpoints(sessionId);
      expect(remaining).toHaveLength(0);
    });

    it('should not affect other sessions', () => {
      db.createCheckpoint({
        sessionId: 'session-keep',
        name: 'Keep',
        messageCount: 5
      });

      db.createCheckpoint({
        sessionId: 'session-remove',
        name: 'Remove',
        messageCount: 10
      });

      db.deleteSessionCheckpoints('session-remove');

      const kept = db.listCheckpoints('session-keep');
      expect(kept).toHaveLength(1);
    });

    it('should return 0 for session with no checkpoints', () => {
      const count = db.deleteSessionCheckpoints('nonexistent');
      expect(count).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return zero stats for empty database', () => {
      const stats = db.getStats();
      expect(stats.totalCheckpoints).toBe(0);
      expect(stats.totalSessions).toBe(0);
    });

    it('should count checkpoints and sessions correctly', () => {
      db.createCheckpoint({
        sessionId: 'session-1',
        name: 'CP1',
        messageCount: 5
      });

      db.createCheckpoint({
        sessionId: 'session-1',
        name: 'CP2',
        messageCount: 10
      });

      db.createCheckpoint({
        sessionId: 'session-2',
        name: 'CP3',
        messageCount: 15
      });

      const stats = db.getStats();
      expect(stats.totalCheckpoints).toBe(3);
      expect(stats.totalSessions).toBe(2);
    });
  });

  describe('schema and indexes', () => {
    it('should create database file', () => {
      expect(existsSync(testDbPath)).toBe(true);
    });

    it('should handle concurrent checkpoints', () => {
      const sessionId = 'session-concurrent';
      const ids: number[] = [];

      for (let i = 0; i < 100; i++) {
        ids.push(db.createCheckpoint({
          sessionId,
          name: `Checkpoint ${i}`,
          messageCount: i
        }));
      }

      // All IDs should be unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(100);

      // All checkpoints should be retrievable
      const checkpoints = db.listCheckpoints(sessionId, 100);
      expect(checkpoints).toHaveLength(100);
    });
  });
});
