/**
 * index.ts - OpenCode checkpoint plugin
 * 
 * Adds checkpoint and restore commands to OpenCode.
 * Leverages OpenCode's existing compression, adds time-travel via session.fork().
 */

import type { Plugin } from '@opencode-ai/plugin';
import { CheckpointDatabase } from './database.js';
import { RestoreManager } from './restore.js';
import { execSync } from 'child_process';

const plugin: Plugin = async ({ client, $, directory }) => {
  // Initialize database
  const db = new CheckpointDatabase();
  
  // Initialize restore manager
  const restoreManager = new RestoreManager(db, client.session);

  // Helper: Get current git commit
  const getCurrentGitCommit = (): string | undefined => {
    try {
      return execSync('git rev-parse HEAD', {
        cwd: directory,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
    } catch {
      return undefined;
    }
  };

  // Helper: Count messages in current session
  const getMessageCount = async (sessionId: string): Promise<number> => {
    try {
      const messages = await client.session.messages(sessionId);
      return messages.length;
    } catch {
      return 0;
    }
  };

  return {
    // Hook into session events to track message count
    event: async ({ event }) => {
      if (event.type === 'session.deleted') {
        // Clean up checkpoints when session deleted
        const sessionId = (event as any).session?.id;
        if (sessionId) {
          db.deleteSessionCheckpoints(sessionId);
        }
      }
    },

    // Register checkpoint command
    command: {
      checkpoint: {
        description: 'Create a checkpoint of the current session state',
        parameters: [
          {
            name: 'name',
            description: 'Checkpoint name',
            required: true
          },
          {
            name: 'description',
            description: 'Optional description',
            required: false
          }
        ],
        async execute({ sessionId, args }) {
          const name = args[0];
          if (!name) {
            return {
              type: 'text',
              text: 'Error: Checkpoint name required. Usage: /checkpoint <name> [description]'
            };
          }

          const description = args.slice(1).join(' ') || undefined;
          const messageCount = await getMessageCount(sessionId);
          const gitCommit = getCurrentGitCommit();

          try {
            const checkpointId = db.createCheckpoint({
              sessionId,
              name,
              description,
              messageCount,
              gitCommit,
              metadata: {
                directory,
                timestamp: Date.now()
              }
            });

            let response = `✓ Checkpoint created: **${name}**\n`;
            response += `  - ID: ${checkpointId}\n`;
            response += `  - Messages: ${messageCount}\n`;
            if (gitCommit) {
              response += `  - Git commit: ${gitCommit.slice(0, 8)}\n`;
            }
            if (description) {
              response += `  - Description: ${description}\n`;
            }

            return {
              type: 'text',
              text: response
            };
          } catch (error) {
            return {
              type: 'text',
              text: `Error creating checkpoint: ${error instanceof Error ? error.message : String(error)}`
            };
          }
        }
      },

      'checkpoint-list': {
        description: 'List all checkpoints for the current session',
        async execute({ sessionId }) {
          try {
            const checkpoints = db.listCheckpoints(sessionId);
            
            if (checkpoints.length === 0) {
              return {
                type: 'text',
                text: 'No checkpoints found for this session.'
              };
            }

            let response = `## Checkpoints (${checkpoints.length})\n\n`;
            response += '| ID | Name | Messages | Created | Git |\n';
            response += '|---|---|---|---|---|\n';

            for (const cp of checkpoints) {
              const date = new Date(cp.createdAt).toLocaleString();
              const git = cp.gitCommit ? cp.gitCommit.slice(0, 8) : '-';
              response += `| ${cp.id} | ${cp.name} | ${cp.messageCount} | ${date} | ${git} |\n`;
            }

            return {
              type: 'text',
              text: response
            };
          } catch (error) {
            return {
              type: 'text',
              text: `Error listing checkpoints: ${error instanceof Error ? error.message : String(error)}`
            };
          }
        }
      },

      restore: {
        description: 'Restore session to a checkpoint (creates new forked session)',
        parameters: [
          {
            name: 'checkpoint',
            description: 'Checkpoint ID or name',
            required: true
          }
        ],
        async execute({ sessionId, args }) {
          const checkpointRef = args[0];
          if (!checkpointRef) {
            return {
              type: 'text',
              text: 'Error: Checkpoint ID or name required. Usage: /restore <id|name>'
            };
          }

          try {
            // Try as ID first, then as name
            let result;
            const checkpointId = parseInt(checkpointRef, 10);
            
            if (!isNaN(checkpointId)) {
              result = await restoreManager.restore(sessionId, checkpointId);
            } else {
              result = await restoreManager.restoreByName(sessionId, checkpointRef);
            }

            if (!result.success) {
              return {
                type: 'text',
                text: `✗ Restore failed: ${result.error}`
              };
            }

            let response = `✓ Session restored to checkpoint: **${result.checkpointName}**\n\n`;
            response += `A new session has been created with ${result.messageCount} messages.\n`;
            response += `New session ID: ${result.newSessionId}\n\n`;
            response += `Switch to the new session to continue from the checkpoint.\n`;
            response += `The current session remains unchanged.`;

            return {
              type: 'text',
              text: response
            };
          } catch (error) {
            return {
              type: 'text',
              text: `Error during restore: ${error instanceof Error ? error.message : String(error)}`
            };
          }
        }
      },

      'checkpoint-delete': {
        description: 'Delete a checkpoint',
        parameters: [
          {
            name: 'id',
            description: 'Checkpoint ID',
            required: true
          }
        ],
        async execute({ args }) {
          const checkpointId = parseInt(args[0], 10);
          if (isNaN(checkpointId)) {
            return {
              type: 'text',
              text: 'Error: Valid checkpoint ID required. Usage: /checkpoint-delete <id>'
            };
          }

          try {
            const deleted = db.deleteCheckpoint(checkpointId);
            if (deleted) {
              return {
                type: 'text',
                text: `✓ Checkpoint ${checkpointId} deleted`
              };
            } else {
              return {
                type: 'text',
                text: `Checkpoint ${checkpointId} not found`
              };
            }
          } catch (error) {
            return {
              type: 'text',
              text: `Error deleting checkpoint: ${error instanceof Error ? error.message : String(error)}`
            };
          }
        }
      },

      'checkpoint-stats': {
        description: 'Show checkpoint statistics',
        async execute() {
          try {
            const stats = db.getStats();
            let response = `## Checkpoint Statistics\n\n`;
            response += `- Total checkpoints: ${stats.totalCheckpoints}\n`;
            response += `- Total sessions: ${stats.totalSessions}\n`;
            response += `- Database: ${db.getPath()}`;

            return {
              type: 'text',
              text: response
            };
          } catch (error) {
            return {
              type: 'text',
              text: `Error fetching stats: ${error instanceof Error ? error.message : String(error)}`
            };
          }
        }
      }
    }
  };
};

export default plugin;
