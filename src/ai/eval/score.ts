/**
 * Scoring for the interpretation eval harness (audit F8c).
 *
 * Every prompt change until now was judged by re-testing a handful of
 * utterances by hand on the phone, which is slow enough that most changes were
 * never really measured at all — a fix for one failure could quietly undo
 * another, and the only evidence was whether the next spoken sentence happened
 * to work.
 *
 * This runs a whole corpus through the REAL pipeline —
 * `validate → resolve → gate` — and reports, per case, exactly which
 * expectation broke. It is pure: the model output comes in as data, so the
 * same scorer serves the hermetic replay in `eval.test.ts` and the live
 * against-Gemini run in `liveEval.test.ts`.
 *
 * What it deliberately does NOT check: names, evidence spans, wording. Those
 * are presentation. The corpus asserts the things that would corrupt a ledger —
 * how many operations, of what type, for how much, against which entities, and
 * whether the gate would let them through.
 */
import { evaluateApproval } from '@/ai/interpretation/gate';
import {
  resolveCandidate,
  resolveSpecialized,
  resolveUnqualified,
  type ResolveContext,
} from '@/ai/interpretation/resolve';
import type {
  ConflictKind,
  LendingDirection,
  OrdinaryKind,
  ResolvedOperation,
} from '@/ai/interpretation/types';
import { validateInterpretation } from '@/ai/interpretation/validate';

export interface ExpectedOperation {
  operation: OrdinaryKind;
  /** 'bill_split' / 'recurring' when the utterance must produce a specialized op. */
  kind?: ResolvedOperation['kind'];
  /** Minor units, or null for "must be queued WITHOUT an amount" (audit F3). */
  amountMinor: number | null;
  /** Expected RESOLVED entity names. `null` asserts "must not be resolved". */
  account?: string | null;
  category?: string | null;
  person?: string | null;
  direction?: LendingDirection;
  /** Whether the safety gate should let this through as-is. */
  approvable?: boolean;
  /** Conflict kinds that must be present. */
  conflicts?: ConflictKind[];
}

export interface EvalCase {
  id: string;
  /** The logged test case or audit finding this defends, if any. */
  origin?: string;
  what: string;
  utterance: string;
  /** A recorded model response, for the hermetic replay. */
  modelOutput: unknown;
  expect: {
    operations: ExpectedOperation[];
    /** Asserts the count exactly, unless `atLeast` is set. */
    atLeast?: boolean;
  };
}

export interface CaseResult {
  id: string;
  what: string;
  passed: boolean;
  failures: string[];
}

export interface EvalReport {
  total: number;
  passed: number;
  results: CaseResult[];
}

function describe(op: ResolvedOperation): string {
  const amount = op.amountMinor === null ? 'no amount' : `${(op.amountMinor / 100).toFixed(2)}`;
  return `${op.kind}/${amount}`;
}

/** Run one model output through the pipeline exactly as the app would. */
export function pipelineOperations(modelOutput: unknown, ctx: ResolveContext, now: Date): ResolvedOperation[] {
  const validated = validateInterpretation(modelOutput, { now });
  return [
    ...validated.candidates.map((c) => resolveCandidate(c, ctx)),
    ...validated.specializedOperations.map((s) => resolveSpecialized(s, ctx)),
    ...validated.unqualifiedIntents.map((u) => resolveUnqualified(u, ctx)),
  ];
}

function matches(op: ResolvedOperation, want: ExpectedOperation): boolean {
  if (op.operation !== want.operation) return false;
  if (op.amountMinor !== want.amountMinor) return false;
  if (want.kind && op.kind !== want.kind) return false;
  return true;
}

function checkOperation(op: ResolvedOperation, want: ExpectedOperation): string[] {
  const failures: string[] = [];
  const label = describe(op);

  const entity = (
    field: 'account' | 'category' | 'person',
    expected: string | null | undefined,
  ) => {
    if (expected === undefined) return;
    const ref = op[field];
    const actual = ref && ref.status === 'resolved' ? ref.reference : null;
    if (expected === null) {
      if (actual !== null) failures.push(`${label}: ${field} should NOT resolve, but resolved to "${actual}"`);
      return;
    }
    if (actual?.toLowerCase() !== expected.toLowerCase()) {
      failures.push(`${label}: expected ${field} "${expected}", got ${actual === null ? 'unresolved' : `"${actual}"`}`);
    }
  };

  entity('account', want.account);
  entity('category', want.category);
  entity('person', want.person);

  if (want.direction && op.direction !== want.direction) {
    failures.push(`${label}: expected direction "${want.direction}", got "${op.direction ?? 'none'}"`);
  }

  for (const kind of want.conflicts ?? []) {
    if (!op.conflicts.some((c) => c.kind === kind)) {
      failures.push(`${label}: expected a "${kind}" conflict, got [${op.conflicts.map((c) => c.kind).join(', ') || 'none'}]`);
    }
  }

  if (want.approvable !== undefined) {
    const gate = evaluateApproval(op);
    if (gate.approvable !== want.approvable) {
      failures.push(
        want.approvable
          ? `${label}: should be approvable, blocked by [${gate.blockers.map((b) => b.code).join(', ')}]`
          : `${label}: should NOT be approvable, but the gate passed it`,
      );
    }
  }

  return failures;
}

/** Score one case against one model output. */
export function scoreCase(testCase: EvalCase, modelOutput: unknown, ctx: ResolveContext, now: Date): CaseResult {
  const failures: string[] = [];
  let operations: ResolvedOperation[];
  try {
    operations = pipelineOperations(modelOutput, ctx, now);
  } catch (error) {
    return {
      id: testCase.id,
      what: testCase.what,
      passed: false,
      failures: [`pipeline threw: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const wanted = testCase.expect.operations;
  if (testCase.expect.atLeast ? operations.length < wanted.length : operations.length !== wanted.length) {
    failures.push(
      `expected ${testCase.expect.atLeast ? 'at least ' : ''}${wanted.length} operation(s), got ${operations.length} [${operations
        .map(describe)
        .join(', ')}]`,
    );
  }

  // Greedy match: each expectation consumes one actual operation.
  const unclaimed = [...operations];
  for (const want of wanted) {
    const index = unclaimed.findIndex((op) => matches(op, want));
    if (index === -1) {
      const amount = want.amountMinor === null ? 'no amount' : (want.amountMinor / 100).toFixed(2);
      failures.push(`missing expected operation ${want.kind ?? want.operation}/${amount}`);
      continue;
    }
    failures.push(...checkOperation(unclaimed[index]!, want));
    unclaimed.splice(index, 1);
  }
  for (const extra of unclaimed) {
    failures.push(`unexpected extra operation ${describe(extra)}`);
  }

  return { id: testCase.id, what: testCase.what, passed: failures.length === 0, failures };
}

export function summarise(results: CaseResult[]): EvalReport {
  return { total: results.length, passed: results.filter((r) => r.passed).length, results };
}

/** A human-readable per-case report, printed when the corpus is not all-green. */
export function formatReport(report: EvalReport): string {
  const lines = [`${report.passed}/${report.total} cases passed`, ''];
  for (const result of report.results) {
    lines.push(`${result.passed ? 'PASS' : 'FAIL'}  ${result.id}  ${result.what}`);
    for (const failure of result.failures) lines.push(`        ${failure}`);
  }
  return lines.join('\n');
}
