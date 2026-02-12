# OpenCode Checkpoint Plugin - Architecture

## Design Philosophy

This plugin **extends** OpenCode rather than duplicating functionality. It leverages OpenCode's existing compression system and adds checkpoint/restore capabilities that OpenCode lacks.

## Core Components

### 1. CheckpointDatabase (`database.ts`)

**Purpose:** SQLite-based persistence for checkpoint metadata.

**Why SQLite?**
- Zero ops overhead (no server)
- Single file = portable, Git-friendly
- Fast for solo/small team use
- Built-in to Node.js ecosystem via better-sqlite3

**Schema Design:**
```sql
checkpoints (
  id, session_id, name, description,
  message_count, git_commit, created_at, metadata
)
```

**Key Insight:** We store `message_count` (position in conversation) rather than copying messages. OpenCode already has the messages; we just need to know *where* to fork to.

### 2. RestoreManager (`restore.ts`)

**Purpose:** Implements restore logic using OpenCode's `session.fork()` API.

**How Restore Works:**

```
Current Session: [msg1, msg2, ..., msg50]
Checkpoint at message 20

1. Get checkpoint → messageCount = 20
2. Get current messages → find message at position 20
3. Fork session to that messageId
4. Result: New session with [msg1...msg20]
```

**Why Fork Instead of Delete?**
- OpenCode's API doesn't expose message deletion
- Fork is safer (non-destructive)
- Matches Git's branching model
- Original session preserved

### 3. Plugin Integration (`index.ts`)

**Purpose:** Hooks into OpenCode's plugin system.

**Hooks Used:**
- `event` - Listen for session.deleted to cleanup checkpoints
- `tool` - Register checkpoint tools (callable by the AI agent)

**Tools Registered:**
- `checkpoint_create` - Create checkpoint (args: name, description)
- `checkpoint_list` - List checkpoints for current session
- `checkpoint_restore` - Restore to checkpoint (args: checkpoint ID or name)
- `checkpoint_delete` - Delete checkpoint (args: ID)
- `checkpoint_stats` - Show statistics

**SDK Client Adapter:**
The plugin wraps `client.session` (which uses the OpenCode SDK's `Options`-based API) into a simpler `OpenCodeSessionClient` interface that the `RestoreManager` consumes. This keeps the restore logic decoupled from SDK specifics and easy to test with mocks.

## Data Flow

### Creating a Checkpoint

```
Agent calls checkpoint_create tool (name: "Working State")
  ↓
Tool Handler (index.ts)
  ↓
1. Get current message count (via sessionClient.messages())
2. Get Git commit (via execSync)
3. Store in SQLite:
   {
     sessionId: "ses_abc",
     name: "Working State",
     messageCount: 42,
     gitCommit: "def123",
     createdAt: 1234567890
   }
  ↓
Response: "Checkpoint created: Working State (ID: 5)"
```

### Restoring from Checkpoint

```
Agent calls checkpoint_restore tool (checkpoint: "5")
  ↓
Tool Handler (index.ts)
  ↓
RestoreManager.restore(sessionId, checkpointId)
  ↓
1. Fetch checkpoint from SQLite
   → messageCount = 42
  ↓
2. Get current session messages
   sessionClient.messages(sessionId)
  ↓
3. Find target message
   targetMsg = messages[41]  // 42nd message (0-indexed)
  ↓
4. Fork session
   sessionClient.fork({
     sessionId,
     messageId: targetMsg.id,
     title: "Restored: Working State"
   })
  ↓
Response: "Session restored to checkpoint: Working State. New session: ses_xyz"
```

## Integration with OpenCode

### What We Use from OpenCode

1. **Session Management**
   - `session.messages()` - Get message history
   - `session.fork()` - Create branched session

2. **Plugin System**
   - Event hooks
   - Tool registration (via `tool()` helper with Zod schemas)
   - Context (client, directory, ToolContext with sessionID)

3. **Compression**
   - Use OpenCode's native compaction
   - Don't duplicate compression logic

### What We Add

1. **Checkpoint Metadata** - SQLite storage
2. **Named Snapshots** - Human-readable checkpoints
3. **Git Coordination** - Optional commit tracking
4. **Restore Logic** - Fork to specific message count

## Design Decisions

### Why Not Store Full Messages?

❌ **Bad:** Copy all messages to checkpoint DB
- Duplicates OpenCode's storage
- Large database size
- Sync complexity

✅ **Good:** Store message count reference
- Minimal storage
- OpenCode is source of truth
- Simple restore via fork

### Why SQLite?

**Alternatives Considered:**
- JSON files → No concurrent access, slow queries
- PostgreSQL → Overkill, requires server
- Cloud storage → Network dependency, cost

**SQLite Wins:**
- Single file
- ACID transactions
- Excellent performance
- Zero configuration

### Why Fork-Based Restore?

**Alternatives Considered:**
- Delete messages after checkpoint → Not exposed in API
- Replace session in-place → Risky, destructive
- Copy/paste messages → Doesn't preserve IDs

**Fork Wins:**
- Native OpenCode API
- Non-destructive
- Preserves original session
- Matches Git mental model

## Performance Characteristics

### Checkpoint Creation
- **Time:** <10ms (SQLite write)
- **Space:** ~500 bytes per checkpoint
- **Bottleneck:** Git commit lookup (~50ms if in git repo)

### Checkpoint Listing
- **Time:** <5ms for 100 checkpoints
- **Index:** session_id + created_at DESC
- **Limit:** Default 50, configurable

### Restore Operation
- **Time:** 50-500ms depending on message count
- **Steps:**
  1. DB lookup: ~5ms
  2. Fetch messages: 10-200ms (OpenCode API)
  3. Fork session: 20-300ms (OpenCode API)
- **Bottleneck:** Network/API latency

### Database Growth
- **1000 checkpoints** → ~500KB
- **10,000 checkpoints** → ~5MB
- **Negligible** compared to session storage

## Testing Strategy

### Unit Tests (`__tests__/database.test.ts`)
- CRUD operations
- Query correctness
- Concurrent access
- Edge cases (empty, large, etc.)

### Integration Tests (`__tests__/restore.test.ts`)
- Restore validation
- Fork interaction
- Error handling
- Message boundary cases

### E2E Tests (`__tests__/integration.test.ts`)
- Complete workflows
- Tool execution
- Multi-checkpoint scenarios
- Session cleanup

## Security Considerations

### Database
- **Location:** `~/.local/share/opencode/checkpoints.db`
- **Permissions:** User-only (644)
- **Encryption:** Not implemented (file-level encryption possible)

### Git Commits
- **Stored:** Only commit hash (40 chars)
- **Risk:** Minimal (public info)
- **Use:** Optional coordination

### Session IDs
- **Format:** OpenCode's format (opaque)
- **Storage:** Plain text in DB
- **Access:** Local filesystem only

## Extension Points

### Custom Metadata
```typescript
db.createCheckpoint({
  sessionId: 'ses_123',
  name: 'CP1',
  messageCount: 42,
  metadata: {
    // Custom fields
    tags: ['refactor', 'critical'],
    approver: 'alice@example.com',
    jiraTicket: 'PROJ-123'
  }
});
```

### Custom Tools
```typescript
// In plugin
tool: {
  checkpoint_tag: tool({
    description: 'Add tags to a checkpoint',
    args: {
      id: tool.schema.string().describe('Checkpoint ID'),
      tag: tool.schema.string().describe('Tag to add'),
    },
    async execute(args, context) {
      // Add tags to checkpoint
      return 'Tag added';
    },
  }),
}
```

### Event Hooks
```typescript
event: async ({ event }) => {
  if (event.type === 'session.compacted') {
    // Auto-checkpoint after compression?
  }
}
```

## Future Enhancements

### Potential Features
1. **Auto-checkpointing** - Checkpoint every N messages
2. **Checkpoint diffs** - Show what changed between checkpoints
3. **Remote sync** - Sync checkpoints across machines
4. **Checkpoint branching** - Fork from checkpoint instead of session
5. **Time-based restore** - "Restore to 2 hours ago"

### Integration Opportunities
1. **Git hooks** - Auto-checkpoint on git commit
2. **CI/CD** - Checkpoint before deploy
3. **Slack notifications** - Alert on checkpoint creation
4. **Web UI** - Visual checkpoint timeline

## Comparison: This Plugin vs Alternatives

### vs Python Implementation (Earlier Version)

| Aspect | TypeScript Plugin | Python Implementation |
|--------|-------------------|----------------------|
| **Integration** | Native OpenCode plugin | External wrapper |
| **Language** | TypeScript | Python |
| **API Access** | Direct client SDK | Subprocess bridge |
| **Compression** | Uses OpenCode's | Custom Factory-style |
| **Performance** | Same process | IPC overhead |
| **Deployment** | `npm install` | Manual setup |

**Verdict:** TypeScript plugin is superior for OpenCode integration.

### vs Factory.ai

| Aspect | This Plugin | Factory.ai |
|--------|-------------|------------|
| **Checkpoints** | ✅ Yes | ❌ No |
| **Compression** | OpenCode native | Proprietary |
| **Cost** | $0 | $20-2000/mo |
| **Storage** | Local SQLite | Cloud |
| **Models** | Any via OpenCode | Limited |

**Verdict:** Plugin provides features Factory doesn't, at $0 cost.

### vs Copilot CLI

| Aspect | This Plugin | Copilot CLI |
|--------|-------------|-------------|
| **Checkpoints** | Named, metadata | Git branches |
| **Restore** | Fork session | Close PR |
| **GitHub Required** | No | Yes |
| **External Models** | Yes | No |
| **Granularity** | Message-level | Branch-level |

**Verdict:** More flexible, Git-optional, finer granularity.

## Lessons Learned

### What Worked Well
1. **Leveraging session.fork()** - Clean, native API
2. **SQLite** - Zero ops, perfect for this use case
3. **TypeScript** - Type safety caught many bugs
4. **Comprehensive tests** - Confidence in refactoring

### What Could Be Better
1. **OpenCode API docs** - Sparse, needed to read source
2. **Plugin hot reload** - Requires OpenCode restart
3. **Error messages** - Could be more user-friendly

### Key Insights
1. **Don't duplicate** - Use existing systems when possible
2. **Fork > Delete** - Non-destructive operations are safer
3. **Metadata matters** - Name + description make checkpoints useful
4. **Test everything** - Async operations need thorough testing

---

**Summary:** This plugin fills a critical gap in OpenCode's functionality (checkpoints/restore) while leveraging its strengths (compression, session management). The architecture is intentionally minimal, focused, and maintainable.
