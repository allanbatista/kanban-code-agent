# Persistence Layer for Swarm System

Date: 2026-06-16

## Changed

- Created append-only event store with JSONL log and crash resilience
- Created snapshot store with atomic write + backup for full state serialization
- Created per-task file store with YAML/JSONL/attachment management
- All stores use PathSandbox for path validation and AtomicWriter for crash-safe writes

## Files

- `src/infrastructure/persistence/event-store.ts`: EventStore with append/loadAll/getByTaskId/getLatestByTaskId/count
- `src/infrastructure/persistence/snapshot-store.ts`: SnapshotStore with saveSnapshot/loadSnapshot/backup + SnapshotData interface
- `src/infrastructure/persistence/task-file-store.ts`: TaskFileStore with saveTaskYaml/loadTaskYaml/saveChat/loadChat/saveSession/saveArtifacts/copyAttachment/ensureTaskDir

## Validation

- `npx tsc --noEmit` passes with zero errors
- Graphify updated: 1148 nodes, 1554 edges, 126 communities
