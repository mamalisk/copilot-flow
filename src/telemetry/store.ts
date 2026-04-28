/**
 * SQLite-backed telemetry store.
 * Records one row per agent run (via the post-task hook) and exposes
 * aggregate summary queries for the CLI and TUI dashboard.
 *
 * Uses Node.js built-in `node:sqlite` (Node 22+) — same pattern as memory/store.ts.
 */

import path from 'path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { AgentType, TelemetryRun, TelemetrySummary } from '../types.js';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id             TEXT    PRIMARY KEY,
  agent_type     TEXT    NOT NULL,
  label          TEXT    NOT NULL DEFAULT '',
  session_id     TEXT    NOT NULL DEFAULT '',
  model          TEXT    NOT NULL DEFAULT '',
  success        INTEGER NOT NULL,
  duration_ms    INTEGER NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 1,
  prompt_chars   INTEGER NOT NULL DEFAULT 0,
  response_chars INTEGER NOT NULL DEFAULT 0,
  tools_invoked  TEXT    NOT NULL DEFAULT '[]',
  error          TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_type ON runs (agent_type);
CREATE INDEX IF NOT EXISTS idx_created_at ON runs (created_at DESC);
`;

const TOKEN_COLUMNS = [
  'ALTER TABLE runs ADD COLUMN input_tokens       INTEGER DEFAULT 0',
  'ALTER TABLE runs ADD COLUMN output_tokens      INTEGER DEFAULT 0',
  'ALTER TABLE runs ADD COLUMN cache_read_tokens  INTEGER DEFAULT 0',
  'ALTER TABLE runs ADD COLUMN cache_write_tokens INTEGER DEFAULT 0',
  'ALTER TABLE runs ADD COLUMN reasoning_tokens   INTEGER DEFAULT 0',
];

export class TelemetryStore {
  private db: InstanceType<typeof DatabaseSyncType>;

  constructor(dbPath = path.join('.copilot-flow', 'telemetry.db')) {
    const absPath = path.resolve(dbPath);
    const dir = path.dirname(absPath);
    const { mkdirSync, existsSync } = require('fs') as typeof import('fs');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new DatabaseSync(absPath);
    this.db.exec(SCHEMA);
    this.db.exec('PRAGMA journal_mode = WAL');

    // Migrate existing DB to add token columns (idempotent — skip if already present).
    const cols = new Set(
      (this.db.prepare('PRAGMA table_info(runs)').all() as { name: string }[]).map(r => r.name)
    );
    if (!cols.has('input_tokens')) {
      for (const stmt of TOKEN_COLUMNS) {
        this.db.exec(stmt + ';');
      }
    }
  }

  /** Insert a new run record. */
  record(run: TelemetryRun): void {
    const stmt = this.db.prepare(`
      INSERT INTO runs
        (id, agent_type, label, session_id, model, success, duration_ms, attempts,
         prompt_chars, response_chars, tools_invoked, error, created_at,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      run.id,
      run.agentType,
      run.label,
      run.sessionId,
      run.model,
      run.success ? 1 : 0,
      run.durationMs,
      run.attempts,
      run.promptChars,
      run.responseChars,
      JSON.stringify(run.toolsInvoked),
      run.error ?? null,
      run.createdAt,
      run.inputTokens      ?? 0,
      run.outputTokens     ?? 0,
      run.cacheReadTokens  ?? 0,
      run.cacheWriteTokens ?? 0,
      run.reasoningTokens  ?? 0,
    );
  }

  /** List recent runs, optionally filtered by agent type. */
  list(opts: { agentType?: AgentType; limit?: number } = {}): TelemetryRun[] {
    const limit = opts.limit ?? 20;
    const rows = opts.agentType
      ? (this.db.prepare(
          'SELECT * FROM runs WHERE agent_type = ? ORDER BY created_at DESC LIMIT ?'
        ).all(opts.agentType, limit) as Record<string, unknown>[])
      : (this.db.prepare(
          'SELECT * FROM runs ORDER BY created_at DESC LIMIT ?'
        ).all(limit) as Record<string, unknown>[]);

    return rows.map(this._toRun);
  }

  /** Aggregate summary across all runs. */
  summary(): TelemetrySummary {
    const totalRow = this.db.prepare(
      `SELECT COUNT(*) AS total,
              AVG(CAST(success AS REAL)) AS successRate,
              AVG(duration_ms) AS avgDuration,
              AVG(prompt_chars) AS avgPrompt,
              AVG(response_chars) AS avgResponse,
              SUM(input_tokens)  AS totalInputTokens,
              SUM(output_tokens) AS totalOutputTokens,
              AVG(input_tokens)  AS avgInputTokens,
              AVG(output_tokens) AS avgOutputTokens
       FROM runs`
    ).get() as Record<string, number | null>;

    const total = Number(totalRow.total ?? 0);
    if (total === 0) {
      return {
        totalRuns: 0, successRate: 0, avgDurationMs: 0,
        avgPromptChars: 0, avgResponseChars: 0, byAgentType: {}, topTools: [],
        totalInputTokens: 0, totalOutputTokens: 0, avgInputTokens: 0, avgOutputTokens: 0,
      };
    }

    // Per-agent-type breakdown
    const agentRows = this.db.prepare(
      `SELECT agent_type,
              COUNT(*) AS runs,
              AVG(CAST(success AS REAL)) AS successRate,
              AVG(duration_ms) AS avgDuration
       FROM runs GROUP BY agent_type ORDER BY runs DESC`
    ).all() as Array<{ agent_type: string; runs: number; successRate: number; avgDuration: number }>;

    const byAgentType: TelemetrySummary['byAgentType'] = {};
    for (const r of agentRows) {
      byAgentType[r.agent_type] = {
        runs: r.runs,
        successRate: r.successRate,
        avgDurationMs: r.avgDuration,
      };
    }

    // Top tools — aggregate JSON arrays in JS (SQLite json_each available but keeps it simple)
    const toolRows = this.db.prepare(
      'SELECT tools_invoked FROM runs WHERE tools_invoked != \'[]\''
    ).all() as Array<{ tools_invoked: string }>;

    const toolCounts = new Map<string, number>();
    for (const row of toolRows) {
      try {
        const tools: string[] = JSON.parse(row.tools_invoked);
        for (const t of tools) {
          toolCounts.set(t, (toolCounts.get(t) ?? 0) + 1);
        }
      } catch { /* skip malformed rows */ }
    }
    const topTools = [...toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tool, count]) => ({ tool, count }));

    return {
      totalRuns: total,
      successRate: Number(totalRow.successRate ?? 0),
      avgDurationMs: Number(totalRow.avgDuration ?? 0),
      avgPromptChars: Number(totalRow.avgPrompt ?? 0),
      avgResponseChars: Number(totalRow.avgResponse ?? 0),
      byAgentType,
      topTools,
      totalInputTokens:  Number(totalRow.totalInputTokens  ?? 0),
      totalOutputTokens: Number(totalRow.totalOutputTokens ?? 0),
      avgInputTokens:    Number(totalRow.avgInputTokens    ?? 0),
      avgOutputTokens:   Number(totalRow.avgOutputTokens   ?? 0),
    };
  }

  /** Delete all rows. */
  clear(): void {
    this.db.exec('DELETE FROM runs');
  }

  close(): void {
    this.db.close();
  }

  private _toRun(row: Record<string, unknown>): TelemetryRun {
    return {
      id:               String(row.id),
      agentType:        String(row.agent_type) as AgentType,
      label:            String(row.label ?? ''),
      sessionId:        String(row.session_id ?? ''),
      model:            String(row.model ?? ''),
      success:          row.success === 1,
      durationMs:       Number(row.duration_ms),
      attempts:         Number(row.attempts ?? 1),
      promptChars:      Number(row.prompt_chars ?? 0),
      responseChars:    Number(row.response_chars ?? 0),
      toolsInvoked:     (() => { try { return JSON.parse(String(row.tools_invoked ?? '[]')); } catch { return []; } })(),
      error:            row.error != null ? String(row.error) : undefined,
      createdAt:        Number(row.created_at),
      inputTokens:      Number(row.input_tokens      ?? 0),
      outputTokens:     Number(row.output_tokens     ?? 0),
      cacheReadTokens:  Number(row.cache_read_tokens  ?? 0),
      cacheWriteTokens: Number(row.cache_write_tokens ?? 0),
      reasoningTokens:  Number(row.reasoning_tokens   ?? 0),
    };
  }
}

let _store: TelemetryStore | null = null;

export function getTelemetryStore(): TelemetryStore {
  if (!_store) _store = new TelemetryStore();
  return _store;
}
