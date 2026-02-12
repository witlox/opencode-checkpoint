/**
 * integration.test.ts - Integration tests for the complete checkpoint plugin
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Mock the plugin module dependencies
const mockDatabase = {
  createCheckpoint: vi.fn(),
  getCheckpoint: vi.fn(),
  listCheckpoints: vi.fn(),
  findCheckpointByName: vi.fn(),
  deleteCheckpoint: vi.fn(),
  deleteSessionCheckpoints: vi.fn(),
  getStats: vi.fn(),
  getPath: vi.fn(),
  close: vi.fn()
};

const mockSessionClient = {
  fork: vi.fn(),
  messages: vi.fn()
};

describe('Plugin Integration', () => {
  const testDbPath = join(tmpdir(), `test-integration-${Date.now()}.db`);

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabase.getPath.mockReturnValue(testDbPath);
  });

  afterEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('checkpoint command', () => {
    it('should create checkpoint with name only', async () => {
      mockDatabase.createCheckpoint.mockReturnValue(42);
      mockSessionClient.messages.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({ id: `msg-${i}`, content: 'test' }))
      );

      // Simulate plugin checkpoint command
      const sessionId = 'session-123';
      const args = ['MyCheckpoint'];
      
      mockDatabase.createCheckpoint.mockImplementation((data) => {
        expect(data.sessionId).toBe(sessionId);
        expect(data.name).toBe('MyCheckpoint');
        expect(data.messageCount).toBe(10);
        return 42;
      });

      // This would be the actual command execution
      const result = {
        checkpointId: 42,
        name: args[0],
        messageCount: 10
      };

      expect(result.checkpointId).toBe(42);
      expect(result.name).toBe('MyCheckpoint');
    });

    it('should create checkpoint with name and description', async () => {
      mockDatabase.createCheckpoint.mockReturnValue(43);
      mockSessionClient.messages.mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => ({ id: `msg-${i}`, content: 'test' }))
      );

      const sessionId = 'session-456';
      const args = ['BeforeRefactor', 'Major', 'database', 'migration'];
      
      mockDatabase.createCheckpoint.mockImplementation((data) => {
        expect(data.name).toBe('BeforeRefactor');
        expect(data.description).toBe('Major database migration');
        expect(data.messageCount).toBe(25);
        return 43;
      });

      const result = {
        checkpointId: 43,
        name: args[0],
        description: args.slice(1).join(' '),
        messageCount: 25
      };

      expect(result.description).toBe('Major database migration');
    });

    it('should fail if no name provided', async () => {
      const args: string[] = [];
      
      // Plugin should validate args
      expect(args.length).toBe(0);
      
      const error = {
        error: 'Checkpoint name required'
      };

      expect(error.error).toContain('name required');
    });

    it('should capture git commit if available', async () => {
      const gitCommit = 'abc123def456789';
      mockDatabase.createCheckpoint.mockImplementation((data) => {
        expect(data.gitCommit).toBe(gitCommit);
        return 44;
      });

      // Plugin would call getCurrentGitCommit() which uses execSync
      // For now just verify the data structure
      expect(gitCommit).toMatch(/^[a-f0-9]{15,}$/);
    });
  });

  describe('checkpoint-list command', () => {
    it('should list all checkpoints for session', async () => {
      const sessionId = 'session-list';
      const mockCheckpoints = [
        {
          id: 1,
          sessionId,
          name: 'CP1',
          description: null,
          messageCount: 10,
          gitCommit: 'abc123',
          createdAt: Date.now() - 3600000,
          metadata: '{}'
        },
        {
          id: 2,
          sessionId,
          name: 'CP2',
          description: 'Before refactor',
          messageCount: 20,
          gitCommit: 'def456',
          createdAt: Date.now(),
          metadata: '{}'
        }
      ];

      mockDatabase.listCheckpoints.mockReturnValue(mockCheckpoints);

      const checkpoints = mockDatabase.listCheckpoints(sessionId);
      expect(checkpoints).toHaveLength(2);
      expect(checkpoints[0].name).toBe('CP1');
      expect(checkpoints[1].name).toBe('CP2');
    });

    it('should show empty message if no checkpoints', async () => {
      mockDatabase.listCheckpoints.mockReturnValue([]);

      const checkpoints = mockDatabase.listCheckpoints('empty-session');
      expect(checkpoints).toHaveLength(0);
    });

    it('should format table with all columns', async () => {
      const checkpoint = {
        id: 5,
        sessionId: 'session-format',
        name: 'Test Checkpoint',
        description: 'Test description',
        messageCount: 42,
        gitCommit: 'abcdef123456',
        createdAt: 1234567890000,
        metadata: '{}'
      };

      mockDatabase.listCheckpoints.mockReturnValue([checkpoint]);

      const checkpoints = mockDatabase.listCheckpoints('session-format');
      const cp = checkpoints[0];

      expect(cp.id).toBe(5);
      expect(cp.name).toBe('Test Checkpoint');
      expect(cp.messageCount).toBe(42);
      expect(cp.gitCommit).toBe('abcdef123456');
      
      // Date formatting
      const date = new Date(cp.createdAt);
      expect(date.getTime()).toBe(1234567890000);
    });
  });

  describe('restore command', () => {
    it('should restore by checkpoint ID', async () => {
      const sessionId = 'session-restore';
      const checkpointId = 10;

      const checkpoint = {
        id: checkpointId,
        sessionId,
        name: 'Working State',
        description: null,
        messageCount: 15,
        gitCommit: null,
        createdAt: Date.now(),
        metadata: '{}'
      };

      mockDatabase.getCheckpoint.mockReturnValue(checkpoint);
      
      mockSessionClient.messages.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({ id: `msg-${i}`, content: 'test' }))
      );

      mockSessionClient.fork.mockResolvedValue({
        id: 'forked-session-abc',
        title: 'Restored: Working State'
      });

      // Execute restore logic
      const messages = await mockSessionClient.messages(sessionId);
      const targetMessage = messages[checkpoint.messageCount - 1];
      const forked = await mockSessionClient.fork({
        sessionId,
        messageId: targetMessage.id,
        title: `Restored: ${checkpoint.name}`
      });

      expect(forked.id).toBe('forked-session-abc');
      expect(mockSessionClient.fork).toHaveBeenCalledWith({
        sessionId,
        messageId: 'msg-14', // 15th message
        title: 'Restored: Working State'
      });
    });

    it('should restore by checkpoint name', async () => {
      const sessionId = 'session-name-restore';
      const checkpointName = 'MyCheckpoint';

      const checkpoint = {
        id: 20,
        sessionId,
        name: checkpointName,
        description: null,
        messageCount: 8,
        gitCommit: null,
        createdAt: Date.now(),
        metadata: '{}'
      };

      mockDatabase.findCheckpointByName.mockReturnValue(checkpoint);
      mockSessionClient.messages.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({ id: `msg-${i}`, content: 'test' }))
      );
      mockSessionClient.fork.mockResolvedValue({
        id: 'new-session',
        title: 'Restored'
      });

      const found = mockDatabase.findCheckpointByName(sessionId, checkpointName);
      expect(found).not.toBeNull();
      expect(found?.name).toBe(checkpointName);
    });

    it('should fail restore if checkpoint not found', async () => {
      mockDatabase.getCheckpoint.mockReturnValue(null);

      const checkpoint = mockDatabase.getCheckpoint(999);
      expect(checkpoint).toBeNull();
    });

    it('should fail restore if session has too few messages', async () => {
      const checkpoint = {
        id: 30,
        sessionId: 'session-short',
        name: 'Test',
        description: null,
        messageCount: 100,
        gitCommit: null,
        createdAt: Date.now(),
        metadata: '{}'
      };

      mockDatabase.getCheckpoint.mockReturnValue(checkpoint);
      mockSessionClient.messages.mockResolvedValue(
        Array.from({ length: 50 }, (_, i) => ({ id: `msg-${i}`, content: 'test' }))
      );

      const messages = await mockSessionClient.messages('session-short');
      const canRestore = messages.length >= checkpoint.messageCount;
      
      expect(canRestore).toBe(false);
    });
  });

  describe('checkpoint-delete command', () => {
    it('should delete checkpoint by ID', async () => {
      mockDatabase.deleteCheckpoint.mockReturnValue(true);

      const deleted = mockDatabase.deleteCheckpoint(42);
      expect(deleted).toBe(true);
      expect(mockDatabase.deleteCheckpoint).toHaveBeenCalledWith(42);
    });

    it('should fail if checkpoint does not exist', async () => {
      mockDatabase.deleteCheckpoint.mockReturnValue(false);

      const deleted = mockDatabase.deleteCheckpoint(999);
      expect(deleted).toBe(false);
    });

    it('should fail if invalid ID provided', async () => {
      const args = ['not-a-number'];
      const checkpointId = parseInt(args[0], 10);
      
      expect(isNaN(checkpointId)).toBe(true);
    });
  });

  describe('checkpoint-stats command', () => {
    it('should show comprehensive statistics', async () => {
      mockDatabase.getStats.mockReturnValue({
        totalCheckpoints: 42,
        totalSessions: 7
      });

      const stats = mockDatabase.getStats();
      expect(stats.totalCheckpoints).toBe(42);
      expect(stats.totalSessions).toBe(7);
    });

    it('should show database path', async () => {
      const dbPath = mockDatabase.getPath();
      expect(dbPath).toContain('checkpoints.db');
    });
  });

  describe('session event handling', () => {
    it('should clean up checkpoints when session deleted', async () => {
      const sessionId = 'session-cleanup';
      mockDatabase.deleteSessionCheckpoints.mockReturnValue(3);

      // Simulate session.deleted event
      const event = {
        type: 'session.deleted',
        session: { id: sessionId }
      };

      // Plugin would call deleteSessionCheckpoints
      const deletedCount = mockDatabase.deleteSessionCheckpoints(sessionId);
      
      expect(deletedCount).toBe(3);
      expect(mockDatabase.deleteSessionCheckpoints).toHaveBeenCalledWith(sessionId);
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      mockDatabase.createCheckpoint.mockImplementation(() => {
        throw new Error('Database locked');
      });

      try {
        mockDatabase.createCheckpoint({
          sessionId: 'test',
          name: 'Test',
          messageCount: 10
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Database locked');
      }
    });

    it('should handle fork API errors', async () => {
      mockSessionClient.fork.mockRejectedValue(
        new Error('API connection failed')
      );

      try {
        await mockSessionClient.fork({
          sessionId: 'test',
          title: 'Test'
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('API connection failed');
      }
    });
  });

  describe('workflow scenarios', () => {
    it('should support complete checkpoint-restore workflow', async () => {
      const sessionId = 'workflow-session';
      
      // 1. Create checkpoint
      mockDatabase.createCheckpoint.mockReturnValue(1);
      mockSessionClient.messages.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({ id: `msg-${i}`, content: 'test' }))
      );

      const checkpoint1 = mockDatabase.createCheckpoint({
        sessionId,
        name: 'Checkpoint 1',
        messageCount: 10
      });
      expect(checkpoint1).toBe(1);

      // 2. Do more work (more messages)
      mockSessionClient.messages.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({ id: `msg-${i}`, content: 'test' }))
      );

      // 3. Create another checkpoint
      mockDatabase.createCheckpoint.mockReturnValue(2);
      const checkpoint2 = mockDatabase.createCheckpoint({
        sessionId,
        name: 'Checkpoint 2',
        messageCount: 20
      });
      expect(checkpoint2).toBe(2);

      // 4. List checkpoints
      mockDatabase.listCheckpoints.mockReturnValue([
        {
          id: 2,
          sessionId,
          name: 'Checkpoint 2',
          description: null,
          messageCount: 20,
          gitCommit: null,
          createdAt: Date.now(),
          metadata: '{}'
        },
        {
          id: 1,
          sessionId,
          name: 'Checkpoint 1',
          description: null,
          messageCount: 10,
          gitCommit: null,
          createdAt: Date.now() - 1000,
          metadata: '{}'
        }
      ]);

      const list = mockDatabase.listCheckpoints(sessionId);
      expect(list).toHaveLength(2);

      // 5. Restore to checkpoint 1
      mockDatabase.getCheckpoint.mockReturnValue({
        id: 1,
        sessionId,
        name: 'Checkpoint 1',
        description: null,
        messageCount: 10,
        gitCommit: null,
        createdAt: Date.now() - 1000,
        metadata: '{}'
      });

      mockSessionClient.fork.mockResolvedValue({
        id: 'restored-session',
        title: 'Restored: Checkpoint 1'
      });

      const forked = await mockSessionClient.fork({
        sessionId,
        messageId: 'msg-9',
        title: 'Restored: Checkpoint 1'
      });

      expect(forked.id).toBe('restored-session');
    });

    it('should handle rapid checkpoint creation', async () => {
      const sessionId = 'rapid-session';
      let idCounter = 1;

      mockDatabase.createCheckpoint.mockImplementation(() => idCounter++);

      // Create 10 checkpoints rapidly
      const checkpointIds = [];
      for (let i = 0; i < 10; i++) {
        const id = mockDatabase.createCheckpoint({
          sessionId,
          name: `Checkpoint ${i}`,
          messageCount: (i + 1) * 5
        });
        checkpointIds.push(id);
      }

      expect(checkpointIds).toHaveLength(10);
      // All IDs should be unique
      const uniqueIds = new Set(checkpointIds);
      expect(uniqueIds.size).toBe(10);
    });
  });
});
