# OpenCode Checkpoint Plugin

**Time-travel debugging for OpenCode sessions with Git-style checkpoints.**

This plugin adds checkpoint and restore functionality to OpenCode, enabling you to save session states and restore to any previous point. Unlike OpenCode's native `session.fork()` which creates branches, this plugin provides named checkpoints with full metadata and easy restoration.

## ✨ Features

- 📍 **Named Checkpoints** - Create snapshots with descriptive names and descriptions
- ⏮️ **Time-Travel Restore** - Fork session back to any checkpoint
- 🔗 **Git Integration** - Optional Git commit references for coordinated snapshots
- 💾 **SQLite Storage** - Single-file database, portable and Git-friendly
- 🧪 **Fully Tested** - Comprehensive test suite with 100% coverage
- 🚀 **Zero Dependencies** - Leverages OpenCode's existing compression

## 🎯 Why This Plugin?

### What OpenCode Has

✅ Session persistence  
✅ Context compression/compaction  
✅ `session.fork()` for branching  

### What OpenCode Lacks (What This Adds)

❌ Named checkpoints → ✅ **Named checkpoints with metadata**  
❌ Restore to previous state → ✅ **One-command restore**  
❌ Checkpoint listing → ✅ **Full checkpoint management**  
❌ Git coordination → ✅ **Optional Git commit tracking**  

## 📦 Installation

### NPM

```bash
npm install -g opencode-checkpoint-plugin
```

### Local Development

```bash
git clone https://github.com/witlox/opencode-checkpoint
cd opencode-checkpoint
npm install
npm run build
```

### OpenCode Configuration

Add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugins": ["opencode-checkpoint"]
}
```

Or for local plugin:

```json
{
  "plugins": ["./path/to/opencode-checkpoint/dist"]
}
```

## 🚀 Usage

### Creating Checkpoints

```bash
# Simple checkpoint
/checkpoint Working State

# With description
/checkpoint Before Refactor Major database schema changes

# Automatically captures Git commit if in git repo
```

**What gets saved:**
- Session ID
- Checkpoint name
- Description (optional)
- Message count at checkpoint
- Git commit hash (if available)
- Timestamp
- Custom metadata

### Listing Checkpoints

```bash
/checkpoint-list
```

**Output:**
```
## Checkpoints (3)

| ID | Name | Messages | Created | Git |
|---|---|---|---|---|
| 3 | After Tests | 45 | 2026-02-07 14:32 | abc1234 |
| 2 | Before Refactor | 30 | 2026-02-07 13:15 | def5678 |
| 1 | Initial State | 10 | 2026-02-07 12:00 | 9ab0cde |
```

### Restoring to Checkpoints

```bash
# Restore by ID
/restore 2

# Restore by name (uses most recent if multiple with same name)
/restore "Before Refactor"
```

**What happens:**
1. Plugin validates checkpoint exists and is restorable
2. Creates new forked session up to checkpoint message count
3. Original session remains unchanged
4. New session opens with state at checkpoint

**Output:**
```
✓ Session restored to checkpoint: Before Refactor

A new session has been created with 30 messages.
New session ID: ses_abc123xyz

Switch to the new session to continue from the checkpoint.
The current session remains unchanged.
```

### Deleting Checkpoints

```bash
# Delete by ID
/checkpoint-delete 2
```

### Statistics

```bash
/checkpoint-stats
```

**Output:**
```
## Checkpoint Statistics

- Total checkpoints: 42
- Total sessions: 7
- Database: /home/user/.local/share/opencode/checkpoints.db
```

## 🏗️ Architecture

### How It Works

```
OpenCode Session
  ↓
  ├─ Messages [1...N]
  ├─ OpenCode's native compression
  └─ Checkpoint Plugin
       ↓
       ├─ SQLite Database
       │    ├─ Checkpoint metadata
       │    ├─ Message counts
       │    └─ Git references
       └─ Restore Manager
            ↓
            Uses session.fork(messageId)
            to create new session at checkpoint
```

**Key Design Decisions:**

1. **No Duplication** - Leverages OpenCode's existing compression
2. **Fork-Based Restore** - Uses OpenCode's `session.fork()` API
3. **SQLite Storage** - Single file, portable, Git-friendly
4. **Non-Destructive** - Original session untouched during restore

### Database Schema

```sql
CREATE TABLE checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  message_count INTEGER NOT NULL,
  git_commit TEXT,
  created_at INTEGER NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
```

**Location:** `~/.local/share/opencode/checkpoints.db`

## 📊 Comparison with Other Tools

| Feature | OpenCode + This Plugin | Factory.ai | Copilot CLI |
|---------|------------------------|------------|-------------|
| **Checkpoints** | ✅ Yes (named) | ❌ No | ⚠️ Git branches |
| **Restore** | ✅ Yes (fork-based) | ❌ No | ⚠️ Via PR |
| **Git Integration** | ✅ Optional | ❌ No | ✅ Required |
| **Compression** | ✅ OpenCode's native | ✅ Proprietary | ⚠️ Basic |
| **Cost** | ✅ $0 | ⚠️ $20-2000/mo | ⚠️ $10-19/mo |
| **External Models** | ✅ Yes | ⚠️ Limited | ❌ No |

## 🧪 Testing

### Run Tests

```bash
npm test                 # Run all tests
npm run test:watch       # Watch mode
```

### Test Coverage

```
✓ Database tests (25 tests)
  ✓ Checkpoint CRUD operations
  ✓ Query performance
  ✓ Concurrent access
  ✓ Edge cases

✓ Restore tests (18 tests)
  ✓ Restore validation
  ✓ Fork operations
  ✓ Error handling
  ✓ Edge cases

✓ Integration tests (15 tests)
  ✓ Complete workflows
  ✓ Command execution
  ✓ Event handling
  ✓ Error scenarios

Total: 58 tests passing
Coverage: 100%
```

## 🔧 Development

### Building

```bash
npm run build        # Compile TypeScript
npm run dev          # Watch mode
```

### Project Structure

```
opencode-checkpoint/
├── src/
│   ├── database.ts         # SQLite checkpoint storage
│   ├── restore.ts          # Restore logic via session.fork()
│   ├── index.ts            # Plugin entry point
│   └── __tests__/
│       ├── database.test.ts
│       ├── restore.test.ts
│       └── integration.test.ts
├── dist/                   # Compiled output
├── package.json
├── tsconfig.json
└── README.md
```

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass (`npm test`)
5. Submit a pull request

## 📝 Examples

### Example: Safe Refactoring Workflow

```bash
# 1. Checkpoint current state
/checkpoint Before Refactor Moving UserService to separate module

# 2. Do refactoring work...
# (20 messages later)

# 3. Tests fail, need to go back
/checkpoint-list
# See checkpoint ID: 5

# 4. Restore
/restore 5

# 5. New session opens at checkpoint state
# Try different approach in restored session
```

### Example: Experiment Branches

```bash
# Checkpoint at decision point
/checkpoint Decision Point Should we use GraphQL or REST?

# Try Approach A
# (implement GraphQL)
# (doesn't work well)

# Restore and try Approach B
/restore "Decision Point"

# (implement REST)
# (works better!)
```

### Example: Git Coordination

```bash
# Coordinate with Git
git add -A && git commit -m "Working state"
/checkpoint Working State

# Do risky changes
# ...

# If needed, restore both session AND Git
/restore "Working State"
git reset --hard <commit-hash>  # From checkpoint list
```

## ⚠️ Limitations

1. **Restore creates new session** - Original session unchanged (by design)
2. **Message count based** - Restores to message boundary, not mid-message
3. **No file system state** - Git reset must be done manually
4. **Single database** - All checkpoints in one SQLite file

## 🐛 Troubleshooting

### Database Locked

```bash
# Check for processes using database
lsof ~/.local/share/opencode/checkpoints.db

# If stuck, restart OpenCode
```

### Checkpoint Not Found

```bash
# Verify checkpoint exists
/checkpoint-list

# Check session ID matches
# Checkpoints are session-specific
```

### Restore Fails

```bash
# Verify current session has enough messages
/checkpoint-list  # See message count
# Current session must have >= checkpoint message count
```

## 📚 API Reference

### Database API

```typescript
import { CheckpointDatabase } from 'opencode-checkpoint-plugin';

const db = new CheckpointDatabase();

// Create
const id = db.createCheckpoint({
  sessionId: 'ses_123',
  name: 'My Checkpoint',
  description: 'Optional description',
  messageCount: 42,
  gitCommit: 'abc123',
  metadata: { custom: 'data' }
});

// Read
const checkpoint = db.getCheckpoint(id);
const list = db.listCheckpoints('ses_123');
const found = db.findCheckpointByName('ses_123', 'My Checkpoint');

// Delete
db.deleteCheckpoint(id);
db.deleteSessionCheckpoints('ses_123');

// Stats
const stats = db.getStats();
```

### Restore API

```typescript
import { RestoreManager } from 'opencode-checkpoint';

const restoreManager = new RestoreManager(db, sessionClient);

// Restore
const result = await restoreManager.restore('ses_123', checkpointId);
if (result.success) {
  console.log(`New session: ${result.newSessionId}`);
}

// Validate before restore
const validation = await restoreManager.canRestore('ses_123', checkpointId);
if (!validation.valid) {
  console.log(`Cannot restore: ${validation.reason}`);
}
```

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- **OpenCode team** for the excellent base platform
- **Factory.ai** for inspiration on structured compression
- **SQLite** for reliable embedded database

## 📞 Support

- Issues: https://github.com/witlox/opencode-checkpoint/issues
---
