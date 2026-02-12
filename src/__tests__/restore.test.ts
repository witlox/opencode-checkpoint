/**
 * restore.test.ts - Tests for checkpoint restore functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RestoreManager, type OpenCodeSessionClient } from '../src/restore';
import { CheckpointDatabase } from '../src/database';
import { unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('RestoreManager', () => {
  let db: CheckpointDatabase;
  let mockSessionClient: OpenCodeSessionClient;
  let restoreManager: RestoreManager;
  const testDbPath = join(tmpdir(), `test-restore-${Date.now()}.db`);

  beforeEach(() => {
    db = new CheckpointDatabase(testDbPath);
    
    // Mock OpenCode session client
    mockSessionClient = {
      fork: vi.fn(),
      messages: vi.fn()
    };

    restoreManager = new RestoreManager(db, mockSessionClient);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('restore', () => {
    it('should fail if checkpoint does not exist', async () => {
      const result = await restoreManager.restore('session-123', 999);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail if checkpoint belongs to different session', async () => {
      const checkpointId = db.createCheckpoint({
        sessionId: 'session-abc',
        name: 'Test',
        messageCount: 10
      });

      const result = await restoreManager.restore('session-xyz', checkpointId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('different session');
    });

    it('should fail if current session has fewer messages than checkpoint', async () => {
      const sessionId = 'session-short';
      const checkpointId = db.createCheckpoint({
        sessionId,
        name: 'Test',
        messageCount: 100
      });

      // Mock messages returning fewer than checkpoint expects
      vi.mocked(mockSessionClient.messages).mockResolvedValue(
        Array.from({ length: 50 }, (_, i) => ({
          id: `msg-${i}`,
          content: 'test'
        }))
      );

      const result = await restoreManager.restore(sessionId, checkpointId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('has 50 messages');
      expect(result.error).toContain('expects 100');
    });

    it('should successfully restore to checkpoint', async () => {
      const sessionId = 'session-restore';
      const checkpointId = db.createCheckpoint({
        sessionId,
        name: 'Working State',
        messageCount: 10,
        description: 'Before refactor'
      });

      // Mock messages
      const mockMessages = Array.from({ length: 20 }, (_, i) => ({
        id: `msg-${i}`,
        content: `Message ${i}`
      }));
      vi.mocked(mockSessionClient.messages).mockResolvedValue(mockMessages);

      // Mock fork
      vi.mocked(mockSessionClient.fork).mockResolvedValue({
        id: 'forked-session-123',
        title: 'Restored: Working State'
      });

      const result = await restoreManager.restore(sessionId, checkpointId);

      expect(result.success).toBe(true);
      expect(result.checkpointName).toBe('Working State');
      expect(result.newSessionId).toBe('forked-session-123');
      expect(result.messageCount).toBe(10);

      // Verify fork was called with correct message ID
      expect(mockSessionClient.fork).toHaveBeenCalledWith({
        sessionId,
        messageId: 'msg-9', // 10th message (index 9)
        title: 'Restored: Working State'
      });
    });

    it('should handle fork errors gracefully', async () => {
      const sessionId = 'session-error';
      const checkpointId = db.createCheckpoint({
        sessionId,
        name: 'Test',
        messageCount: 5
      });

      const mockMessages = Array.from({ length: 10 }, (_, i) => ({
        id: `msg-${i}`,
        content: 'test'
      }));
      vi.mocked(mockSessionClient.messages).mockResolvedValue(mockMessages);

      // Mock fork throwing error
      vi.mocked(mockSessionClient.fork).mockRejectedValue(
        new Error('Fork failed: API error')
      );

      const result = await restoreManager.restore(sessionId, checkpointId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Fork failed');
    });

    it('should restore to exact message boundary', async () => {
      const sessionId = 'session-boundary';
      
      // Checkpoint at message 15
      const checkpointId = db.createCheckpoint({
        sessionId,
        name: 'Checkpoint at 15',
        messageCount: 15
      });

      const mockMessages = Array.from({ length: 30 }, (_, i) => ({
        id: `msg-${i}`,
        content: `Message ${i}`
      }));
      vi.mocked(mockSessionClient.messages).mockResolvedValue(mockMessages);

      vi.mocked(mockSessionClient.fork).mockResolvedValue({
        id: 'new-session',
        title: 'Restored'
      });

      await restoreManager.restore(sessionId, checkpointId);

      // Should fork at message index 14 (15th message)
      expect(mockSessionClient.fork).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-14'
        })
      );
    });
  });

  describe('restoreByName', () => {
    it('should fail if no checkpoint with name exists', async () => {
      const result = await restoreManager.restoreByName(
        'session-123',
        'NonExistent'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No checkpoint named');
    });

    it('should restore using most recent checkpoint with name', async () => {
      const sessionId = 'session-by-name';
      
      // Create two checkpoints with same name
      db.createCheckpoint({
        sessionId,
        name: 'MyCheckpoint',
        messageCount: 5
      });

      const latestId = db.createCheckpoint({
        sessionId,
        name: 'MyCheckpoint',
        messageCount: 10
      });

      const mockMessages = Array.from({ length: 15 }, (_, i) => ({
        id: `msg-${i}`,
        content: 'test'
      }));
      vi.mocked(mockSessionClient.messages).mockResolvedValue(mockMessages);

      vi.mocked(mockSessionClient.fork).mockResolvedValue({
        id: 'forked',
        title: 'Restored'
      });

      const result = await restoreManager.restoreByName(sessionId, 'MyCheckpoint');

      expect(result.success).toBe(true);
      expect(result.checkpointId).toBe(latestId);
      expect(result.messageCount).toBe(10);

      // Should use 10th message (index 9)
      expect(mockSessionClient.fork).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-9'
        })
      );
    });

    it('should be case-sensitive for checkpoint names', async () => {
      const sessionId = 'session-case';
      
      db.createCheckpoint({
        sessionId,
        name: 'MyCheckpoint',
        messageCount: 5
      });

      const result = await restoreManager.restoreByName(sessionId, 'mycheckpoint');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No checkpoint named');
    });
  });

  describe('canRestore', () => {
    it('should return false if checkpoint does not exist', async () => {
      const result = await restoreManager.canRestore('session-123', 999);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('should return false if checkpoint belongs to different session', async () => {
      const checkpointId = db.createCheckpoint({
        sessionId: 'session-a',
        name: 'Test',
        messageCount: 10
      });

      const result = await restoreManager.canRestore('session-b', checkpointId);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('different session');
    });

    it('should return false if session has too few messages', async () => {
      const sessionId = 'session-check';
      const checkpointId = db.createCheckpoint({
        sessionId,
        name: 'Test',
        messageCount: 50
      });

      vi.mocked(mockSessionClient.messages).mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          id: `msg-${i}`,
          content: 'test'
        }))
      );

      const result = await restoreManager.canRestore(sessionId, checkpointId);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('has 30 messages');
      expect(result.reason).toContain('requires 50');
    });

    it('should return true if restore is possible', async () => {
      const sessionId = 'session-valid';
      const checkpointId = db.createCheckpoint({
        sessionId,
        name: 'Test',
        messageCount: 10
      });

      vi.mocked(mockSessionClient.messages).mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          id: `msg-${i}`,
          content: 'test'
        }))
      );

      const result = await restoreManager.canRestore(sessionId, checkpointId);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should handle API errors', async () => {
      const sessionId = 'session-error';
      const checkpointId = db.createCheckpoint({
        sessionId,
        name: 'Test',
        messageCount: 10
      });

      vi.mocked(mockSessionClient.messages).mockRejectedValue(
        new Error('API connection failed')
      );

      const result = await restoreManager.canRestore(sessionId, checkpointId);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('API connection failed');
    });
  });

  describe('edge cases', () => {
    it('should handle checkpoint at first message', async () => {
      const sessionId = 'session-first';
      const checkpointId = db.createCheckpoint({
        sessionId,
        name: 'First Message',
        messageCount: 1
      });

      const mockMessages = [
        { id: 'msg-0', content: 'First message' },
        { id: 'msg-1', content: 'Second message' }
      ];
      vi.mocked(mockSessionClient.messages).mockResolvedValue(mockMessages);

      vi.mocked(mockSessionClient.fork).mockResolvedValue({
        id: 'forked',
        title: 'Restored'
      });

      const result = await restoreManager.restore(sessionId, checkpointId);

      expect(result.success).toBe(true);
      expect(mockSessionClient.fork).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-0'
        })
      );
    });

    it('should handle checkpoint at current message count (no-op restore)', async () => {
      const sessionId = 'session-current';
      const checkpointId = db.createCheckpoint({
        sessionId,
        name: 'Current State',
        messageCount: 10
      });

      const mockMessages = Array.from({ length: 10 }, (_, i) => ({
        id: `msg-${i}`,
        content: 'test'
      }));
      vi.mocked(mockSessionClient.messages).mockResolvedValue(mockMessages);

      vi.mocked(mockSessionClient.fork).mockResolvedValue({
        id: 'forked',
        title: 'Restored'
      });

      const result = await restoreManager.restore(sessionId, checkpointId);

      expect(result.success).toBe(true);
      // Should fork at last message (no actual rollback, but valid operation)
      expect(mockSessionClient.fork).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-9'
        })
      );
    });

    it('should handle very large message counts', async () => {
      const sessionId = 'session-large';
      const checkpointId = db.createCheckpoint({
        sessionId,
        name: 'Large Checkpoint',
        messageCount: 1000
      });

      const mockMessages = Array.from({ length: 2000 }, (_, i) => ({
        id: `msg-${i}`,
        content: 'test'
      }));
      vi.mocked(mockSessionClient.messages).mockResolvedValue(mockMessages);

      vi.mocked(mockSessionClient.fork).mockResolvedValue({
        id: 'forked',
        title: 'Restored'
      });

      const result = await restoreManager.restore(sessionId, checkpointId);

      expect(result.success).toBe(true);
      expect(result.messageCount).toBe(1000);
      expect(mockSessionClient.fork).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-999'
        })
      );
    });
  });

  describe('integration scenarios', () => {
    it('should handle multiple restore operations on same session', async () => {
      const sessionId = 'session-multi';
      
      const cp1 = db.createCheckpoint({
        sessionId,
        name: 'CP1',
        messageCount: 5
      });

      const cp2 = db.createCheckpoint({
        sessionId,
        name: 'CP2',
        messageCount: 10
      });

      const mockMessages = Array.from({ length: 15 }, (_, i) => ({
        id: `msg-${i}`,
        content: 'test'
      }));
      vi.mocked(mockSessionClient.messages).mockResolvedValue(mockMessages);

      vi.mocked(mockSessionClient.fork).mockResolvedValue({
        id: 'forked-1',
        title: 'Restored'
      });

      const result1 = await restoreManager.restore(sessionId, cp1);
      expect(result1.success).toBe(true);
      expect(result1.messageCount).toBe(5);

      vi.mocked(mockSessionClient.fork).mockResolvedValue({
        id: 'forked-2',
        title: 'Restored'
      });

      const result2 = await restoreManager.restore(sessionId, cp2);
      expect(result2.success).toBe(true);
      expect(result2.messageCount).toBe(10);

      // Both should succeed independently
      expect(result1.newSessionId).not.toBe(result2.newSessionId);
    });

    it('should validate before restore and then execute', async () => {
      const sessionId = 'session-validate';
      const checkpointId = db.createCheckpoint({
        sessionId,
        name: 'Test',
        messageCount: 10
      });

      const mockMessages = Array.from({ length: 20 }, (_, i) => ({
        id: `msg-${i}`,
        content: 'test'
      }));
      vi.mocked(mockSessionClient.messages).mockResolvedValue(mockMessages);

      // First validate
      const validation = await restoreManager.canRestore(sessionId, checkpointId);
      expect(validation.valid).toBe(true);

      // Then restore
      vi.mocked(mockSessionClient.fork).mockResolvedValue({
        id: 'forked',
        title: 'Restored'
      });

      const result = await restoreManager.restore(sessionId, checkpointId);
      expect(result.success).toBe(true);
    });
  });
});
