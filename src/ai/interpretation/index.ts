/** Transaction AI V1 interpretation core — public surface. */
export * from './types';
export { validateInterpretation, type ValidateOptions } from './validate';
export {
  resolveRef,
  resolveCandidate,
  resolveSpecialized,
  type EntityLite,
  type ResolveContext,
} from './resolve';
export { evaluateApproval, type Blocker, type BlockerCode, type GateResult } from './gate';
