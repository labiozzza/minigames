// §16 developer diagnostics + replay. Dev/test only: this module must never be
// referenced from the production game path (the panel is mounted behind
// `import.meta.env.DEV || __TEST_HOOKS__`, and release builds are checked by
// tools/check-no-testhooks.mjs).
//
// The dump is a single versioned JSON: the starting LevelDefinition, the exact
// command log with tick stamps, per-step checksums, the final outcome and
// metrics. It never contains email/token/PII — `sanitizeDump` strips anything
// that looks like a secret and `assertNoPii` guards the export.
import {
  applyCommand,
  createRuntime,
  checksum,
  restore,
  runToEnd,
  snapshot,
  type LevelDefinition,
  type PlumberCommand,
  type Phase,
  type Snapshot,
  RULESET_VERSION,
  GENERATOR_VERSION,
} from '../domain/model';
import { certifyReport } from '../domain/generator';

export const DUMP_SCHEMA = 'plumber-diag/1';

export interface RecEntry {
  tick: number;
  cmd?: PlumberCommand;
  snap?: Snapshot;
  phase: Phase;
  checksum: string;
}

export interface DiagMetrics {
  attempts?: number;
  hints?: number;
  playerRotations?: number;
  wallMs?: number;
  fps?: number | null;
}

export interface DiagDump {
  schema: typeof DUMP_SCHEMA;
  puzzleId: string;
  seed: number;
  rulesetVersion: string;
  generatorVersion: string;
  configRevision?: number;
  configChecksum?: string;
  startDef: LevelDefinition;
  entries: RecEntry[];
  final: { phase: Phase; checksum: string };
  error: { kind: string | null; cell: number | null } | null;
  metrics: DiagMetrics;
  createdAt: number;
}

const SECRET_KEY = /pass(word)?|token|secret|authorization|cookie|email|phone|apikey|api_key/i;

/** Recursively drop any key that could carry credentials or personal data. */
export function sanitizeDump<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (SECRET_KEY.test(k)) continue;
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

export function assertNoPii(dump: DiagDump): void {
  const json = JSON.stringify(dump);
  if (SECRET_KEY.test(json)) throw new Error('dump contains PII-like content');
}

/** Deterministic re-runner that records every command/snapshot with a checksum. */
export class DiagRecorder {
  private entries: RecEntry[] = [];
  private lastLen = 0;
  private lastChecksum = '';
  constructor(private def: LevelDefinition) {
    this.lastChecksum = checksum(createRuntime(def));
  }

  reset(def: LevelDefinition): void {
    this.def = def;
    this.entries = [];
    this.lastLen = 0;
    this.lastChecksum = checksum(createRuntime(def));
  }

  /** Called at the end of each player handler; diffs the model log / state. */
  sync(state: ReturnType<typeof createRuntime>): void {
    if (state.log.length > this.lastLen) {
      for (let i = this.lastLen; i < state.log.length; i += 1) {
        this.entries.push({ tick: state.tick, cmd: state.log[i], phase: state.phase, checksum: checksum(state) });
      }
    } else {
      const sum = checksum(state);
      if (sum !== this.lastChecksum) this.entries.push({ tick: state.tick, snap: snapshot(state), phase: state.phase, checksum: sum });
    }
    this.lastLen = state.log.length;
    this.lastChecksum = checksum(state);
  }

  toDump(state: ReturnType<typeof createRuntime>, metrics: DiagMetrics = {}, error: DiagDump['error'] = null): DiagDump {
    const def = this.def;
    const dump: DiagDump = {
      schema: DUMP_SCHEMA,
      puzzleId: def.puzzleId,
      seed: def.seed,
      rulesetVersion: def.rulesetVersion,
      generatorVersion: def.generatorVersion,
      configRevision: def.configRevision,
      configChecksum: def.configChecksum,
      startDef: def,
      entries: this.entries.map((e) => ({ ...e })),
      final: { phase: state.phase, checksum: checksum(state) },
      error,
      metrics,
      createdAt: Date.now(),
    };
    return sanitizeDump(dump);
  }
}

export interface ReplayResult {
  ok: boolean;
  steps: number;
  phase: Phase;
  checksum: string;
  mismatchAt?: number;
  reason?: string;
}

function versionsMatch(dump: DiagDump, strict: boolean): string | null {
  if (!strict) return null;
  const def = dump.startDef;
  if (def.rulesetVersion !== RULESET_VERSION || def.rulesetVersion !== dump.rulesetVersion) return 'ruleset-version-mismatch';
  if (def.generatorVersion !== GENERATOR_VERSION || def.generatorVersion !== dump.generatorVersion) return 'generator-version-mismatch';
  return null;
}

/**
 * Replay a dump through the official model. With `strict` (default) a version
 * mismatch is refused, and every recorded step's checksum/phase must match 1:1.
 */
export function replayDump(dump: DiagDump, opts: { strict?: boolean } = {}): ReplayResult {
  const strict = opts.strict !== false;
  if (dump.schema !== DUMP_SCHEMA) return { ok: false, steps: 0, phase: 'PREPARING', checksum: '', reason: 'bad-schema' };
  const vReason = versionsMatch(dump, strict);
  if (vReason) return { ok: false, steps: 0, phase: 'PREPARING', checksum: '', reason: vReason };
  const s = createRuntime(dump.startDef);
  let steps = 0;
  for (let i = 0; i < dump.entries.length; i += 1) {
    const e = dump.entries[i];
    let guard = 0;
    while (s.tick < e.tick && s.phase === 'RUNNING' && guard++ < 5000) runOne(s);
    if (e.snap) restore(s, e.snap);
    else if (e.cmd) applyCommand(s, e.cmd);
    steps += 1;
    if (strict && checksum(s) !== e.checksum) return { ok: false, steps, phase: s.phase, checksum: checksum(s), mismatchAt: i, reason: 'checksum-mismatch' };
    if (strict && s.phase !== e.phase) return { ok: false, steps, phase: s.phase, checksum: checksum(s), mismatchAt: i, reason: 'phase-mismatch' };
  }
  if (s.phase === 'RUNNING') runToEnd(s);
  if (strict && (s.phase !== dump.final.phase || checksum(s) !== dump.final.checksum)) {
    return { ok: false, steps, phase: s.phase, checksum: checksum(s), mismatchAt: dump.entries.length, reason: 'final-mismatch' };
  }
  return { ok: true, steps, phase: s.phase, checksum: checksum(s) };
}

function runOne(s: ReturnType<typeof createRuntime>): void {
  // stepTick is exported indirectly via applyCommand('step'); use it for parity.
  applyCommand(s, { type: 'step' });
}

/** Structural validation for imported dumps (arrays/shape, no execution). */
export function validateDump(value: unknown): { ok: true; dump: DiagDump } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'not-object' };
  const d = value as Partial<DiagDump>;
  if (d.schema !== DUMP_SCHEMA) return { ok: false, reason: 'bad-schema' };
  if (!d.startDef || typeof d.startDef !== 'object') return { ok: false, reason: 'missing-startDef' };
  if (!Array.isArray(d.entries)) return { ok: false, reason: 'missing-entries' };
  if (!d.final || typeof d.final !== 'object') return { ok: false, reason: 'missing-final' };
  for (const e of d.entries) {
    if (!e || typeof e !== 'object' || typeof (e as RecEntry).checksum !== 'string') return { ok: false, reason: 'bad-entry' };
  }
  return { ok: true, dump: d as DiagDump };
}

/** Parse a JSON string safely and validate it. */
export function importDump(text: string): { ok: true; dump: DiagDump } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  return validateDump(parsed);
}

// ---------- batch diagnostics ----------

export interface BatchReport {
  schema: 'plumber-batch/1';
  startedAt: number;
  total: number;
  approved: number;
  rejected: Array<{ puzzleId: string; seed: number; reason: string }>;
}

/**
 * generate → certify → report for a set of (puzzleId, seed) specs. Rejections
 * are preserved so any real bug can be turned into a fixture/regression test.
 */
export function batchDiagnose(
  specs: Array<{ puzzleId: string; seed: number; opts?: { mode?: 'child' | 'normal' | 'expert' } }>,
  generate: (puzzleId: string, seed: number, opts?: { mode?: 'child' | 'normal' | 'expert' }) => LevelDefinition,
): BatchReport {
  const startedAt = Date.now();
  const rejected: BatchReport['rejected'] = [];
  let approved = 0;
  for (const spec of specs) {
    try {
      const def = generate(spec.puzzleId, spec.seed, spec.opts);
      const rep = certifyReport(def);
      if (rep.phase === 'WON' && rep.volumeOk && !rep.trivialWin) approved += 1;
      else rejected.push({ puzzleId: spec.puzzleId, seed: spec.seed, reason: `${rep.phase}${rep.volumeOk ? '' : '/volume'}${rep.trivialWin ? '/trivial' : ''}` });
    } catch (err) {
      rejected.push({ puzzleId: spec.puzzleId, seed: spec.seed, reason: err instanceof Error ? err.message : 'throw' });
    }
  }
  return { schema: 'plumber-batch/1', startedAt, total: specs.length, approved, rejected };
}

/** Turn a rejected seed into a regression fixture payload for tests. */
export function rejectToFixture(spec: { puzzleId: string; seed: number; reason: string }): { puzzleId: string; seed: number; expectPhase: string; note: string } {
  return { puzzleId: spec.puzzleId, seed: spec.seed, expectPhase: spec.reason.split('/')[0], note: `regression: ${spec.reason}` };
}
