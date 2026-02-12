/**
 * index.ts - OpenCode checkpoint plugin
 *
 * Adds checkpoint and restore tools to OpenCode.
 * Leverages OpenCode's existing compression, adds time-travel via session.fork().
 */

import type { Plugin } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { CheckpointDatabase } from './database.js';
import { RestoreManager, type OpenCodeSessionClient } from './restore.js';
import { execSync } from 'child_process';

const plugin: Plugin = async ({ client, directory }) => {
  const db = new CheckpointDatabase();

  // Adapter: wrap the SDK client into the simpler interface RestoreManager expects
  const sessionClient: OpenCodeSessionClient = {
    async fork(options) {
      const result = await client.session.fork({
        path: { id: options.sessionId },
        body: { messageID: options.messageId },
      });
      if (result.error || !result.data) {
        throw new Error(`Fork failed: ${JSON.stringify(result.error)}`);
      }
      return { id: result.data.id, title: result.data.title };
    },
    async messages(sessionId) {
      const result = await client.session.messages({
        path: { id: sessionId },
      });
      if (result.error || !result.data) {
        throw new Error(`Messages fetch failed: ${JSON.stringify(result.error)}`);
      }
      return result.data.map((m) => ({ id: m.info.id, content: m.parts }));
    },
  };

  const restoreManager = new RestoreManager(db, sessionClient);

  // Helper: Get current git commit
  const getCurrentGitCommit = (): string | undefined => {
    try {
      return execSync('git rev-parse HEAD', {
        cwd: directory,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return undefined;
    }
  };

  // Helper: Count messages in current session
  const getMessageCount = async (sessionId: string): Promise<number> => {
    try {
      const messages = await sessionClient.messages(sessionId);
      return messages.length;
    } catch {
      return 0;
    }
  };

  return {
    // Clean up checkpoints when session is deleted
    event: async ({ event }) => {
      if (event.type === 'session.deleted') {
        const sessionId = event.properties.info.id;
        if (sessionId) {
          db.deleteSessionCheckpoints(sessionId);
        }
      }
    },

    tool: {
      checkpoint_create: tool({
        description: 'Create a checkpoint of the current session state',
        args: {
          name: tool.schema.string().describe('Checkpoint name'),
          description: tool.schema
            .string()
            .optional()
            .describe('Optional description'),
        },
        async execute(args, context) {
          const messageCount = await getMessageCount(context.sessionID);
          const gitCommit = getCurrentGitCommit();

          const checkpointId = db.createCheckpoint({
            sessionId: context.sessionID,
            name: args.name,
            description: args.description,
            messageCount,
            gitCommit,
            metadata: {
              directory,
              timestamp: Date.now(),
            },
          });

          let response = `Checkpoint created: ${args.name}\n`;
          response += `  ID: ${checkpointId}\n`;
          response += `  Messages: ${messageCount}\n`;
          if (gitCommit) {
            response += `  Git commit: ${gitCommit.slice(0, 8)}\n`;
          }
          if (args.description) {
            response += `  Description: ${args.description}\n`;
          }
          return response;
        },
      }),

      checkpoint_list: tool({
        description: 'List all checkpoints for the current session',
        args: {},
        async execute(_args, context) {
          const checkpoints = db.listCheckpoints(context.sessionID);

          if (checkpoints.length === 0) {
            return 'No checkpoints found for this session.';
          }

          let response = `Checkpoints (${checkpoints.length}):\n\n`;
          response += '| ID | Name | Messages | Created | Git |\n';
          response += '|---|---|---|---|---|\n';

          for (const cp of checkpoints) {
            const date = new Date(cp.createdAt).toLocaleString();
            const git = cp.gitCommit ? cp.gitCommit.slice(0, 8) : '-';
            response += `| ${cp.id} | ${cp.name} | ${cp.messageCount} | ${date} | ${git} |\n`;
          }

          return response;
        },
      }),

      checkpoint_restore: tool({
        description:
          'Restore session to a checkpoint (creates a new forked session)',
        args: {
          checkpoint: tool.schema
            .string()
            .describe('Checkpoint ID or name'),
        },
        async execute(args, context) {
          let result;
          const checkpointId = parseInt(args.checkpoint, 10);

          if (!isNaN(checkpointId)) {
            result = await restoreManager.restore(
              context.sessionID,
              checkpointId,
            );
          } else {
            result = await restoreManager.restoreByName(
              context.sessionID,
              args.checkpoint,
            );
          }

          if (!result.success) {
            return `Restore failed: ${result.error}`;
          }

          let response = `Session restored to checkpoint: ${result.checkpointName}\n\n`;
          response += `A new session has been created with ${result.messageCount} messages.\n`;
          response += `New session ID: ${result.newSessionId}\n\n`;
          response += `Switch to the new session to continue from the checkpoint.\n`;
          response += `The current session remains unchanged.`;

          return response;
        },
      }),

      checkpoint_delete: tool({
        description: 'Delete a checkpoint',
        args: {
          id: tool.schema.string().describe('Checkpoint ID'),
        },
        async execute(args) {
          const checkpointId = parseInt(args.id, 10);
          if (isNaN(checkpointId)) {
            return 'Error: Valid checkpoint ID required.';
          }

          const deleted = db.deleteCheckpoint(checkpointId);
          if (deleted) {
            return `Checkpoint ${checkpointId} deleted`;
          } else {
            return `Checkpoint ${checkpointId} not found`;
          }
        },
      }),

      checkpoint_stats: tool({
        description: 'Show checkpoint statistics',
        args: {},
        async execute() {
          const stats = db.getStats();
          let response = `Checkpoint Statistics:\n`;
          response += `  Total checkpoints: ${stats.totalCheckpoints}\n`;
          response += `  Total sessions: ${stats.totalSessions}\n`;
          response += `  Database: ${db.getPath()}`;
          return response;
        },
      }),
    },
  };
};

export default plugin;
