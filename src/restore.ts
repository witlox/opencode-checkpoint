/**
 * restore.ts - Checkpoint restore logic using OpenCode's session.fork()
 * 
 * Strategy: Use OpenCode's native session.fork() to create a copy up to checkpoint message.
 * This is cleaner than deleting messages (which OpenCode's API doesn't expose anyway).
 */

import type { CheckpointDatabase, Checkpoint } from './database.js';

export interface RestoreResult {
  success: boolean;
  checkpointId: number;
  checkpointName: string;
  newSessionId: string;
  messageCount: number;
  error?: string;
}

export interface SessionForkOptions {
  sessionId: string;
  messageId?: string;
  title?: string;
}

/**
 * Interface for OpenCode's session client
 * (This matches OpenCode's actual API from their SDK)
 */
export interface OpenCodeSessionClient {
  fork(options: SessionForkOptions): Promise<{ id: string; title: string }>;
  messages(sessionId: string): Promise<Array<{ id: string; content: any }>>;
}

export class RestoreManager {
  constructor(
    private db: CheckpointDatabase,
    private sessionClient: OpenCodeSessionClient
  ) {}

  /**
   * Restore session to a checkpoint by forking
   * 
   * @param sessionId - Current session ID
   * @param checkpointId - Checkpoint to restore to
   * @returns RestoreResult with new forked session
   */
  async restore(sessionId: string, checkpointId: number): Promise<RestoreResult> {
    // 1. Get checkpoint details
    const checkpoint = this.db.getCheckpoint(checkpointId);
    if (!checkpoint) {
      return {
        success: false,
        checkpointId,
        checkpointName: 'unknown',
        newSessionId: '',
        messageCount: 0,
        error: `Checkpoint ${checkpointId} not found`
      };
    }

    if (checkpoint.sessionId !== sessionId) {
      return {
        success: false,
        checkpointId,
        checkpointName: checkpoint.name,
        newSessionId: '',
        messageCount: 0,
        error: `Checkpoint belongs to different session (${checkpoint.sessionId})`
      };
    }

    try {
      // 2. Get messages to find the message ID at checkpoint
      const messages = await this.sessionClient.messages(sessionId);
      
      if (messages.length < checkpoint.messageCount) {
        return {
          success: false,
          checkpointId,
          checkpointName: checkpoint.name,
          newSessionId: '',
          messageCount: messages.length,
          error: `Current session has ${messages.length} messages, checkpoint expects ${checkpoint.messageCount}`
        };
      }

      // 3. Get the message ID at checkpoint position
      const targetMessage = messages[checkpoint.messageCount - 1];
      if (!targetMessage) {
        return {
          success: false,
          checkpointId,
          checkpointName: checkpoint.name,
          newSessionId: '',
          messageCount: 0,
          error: `Could not find message at position ${checkpoint.messageCount}`
        };
      }

      // 4. Fork session up to that message
      const forked = await this.sessionClient.fork({
        sessionId,
        messageId: targetMessage.id,
        title: `Restored: ${checkpoint.name}`
      });

      return {
        success: true,
        checkpointId,
        checkpointName: checkpoint.name,
        newSessionId: forked.id,
        messageCount: checkpoint.messageCount
      };

    } catch (error) {
      return {
        success: false,
        checkpointId,
        checkpointName: checkpoint.name,
        newSessionId: '',
        messageCount: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Restore by checkpoint name (uses most recent if multiple)
   */
  async restoreByName(sessionId: string, checkpointName: string): Promise<RestoreResult> {
    const checkpoint = this.db.findCheckpointByName(sessionId, checkpointName);
    if (!checkpoint) {
      return {
        success: false,
        checkpointId: 0,
        checkpointName,
        newSessionId: '',
        messageCount: 0,
        error: `No checkpoint named "${checkpointName}" found for session`
      };
    }

    return this.restore(sessionId, checkpoint.id);
  }

  /**
   * Validate that a checkpoint can be restored
   */
  async canRestore(sessionId: string, checkpointId: number): Promise<{
    valid: boolean;
    reason?: string;
  }> {
    const checkpoint = this.db.getCheckpoint(checkpointId);
    if (!checkpoint) {
      return { valid: false, reason: 'Checkpoint not found' };
    }

    if (checkpoint.sessionId !== sessionId) {
      return { valid: false, reason: 'Checkpoint belongs to different session' };
    }

    try {
      const messages = await this.sessionClient.messages(sessionId);
      if (messages.length < checkpoint.messageCount) {
        return {
          valid: false,
          reason: `Session has ${messages.length} messages, checkpoint requires ${checkpoint.messageCount}`
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        reason: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
