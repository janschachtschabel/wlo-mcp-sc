/**
 * services/bapi/jobs.ts – Kestra flows of the b-api, reached through the
 * REPOSITORY's b-api proxy (`{repository}/rest/bapi/**`), as the signed-in
 * person (plan 2026-11-17, chatbot team's wishes W1–W4, W6).
 *
 * Why through the repository: since 2026-11-10 the b-api takes a person only
 * when the repository vouches for her. Its proxy strips what a caller claims
 * (`x-edu-*`, `x-api-key`), sets its own key and a signed assertion of the
 * person it authenticated — with OUR request's login. So the call carries the
 * person's own repository login (session, ticket or Basic, `wloFetch` attaches it
 * to the repository host and nowhere else), never the service account and never
 * nobody: without a person the flow list comes back EMPTY with 200 (measured
 * 2026-11-17), which would read as "nothing released".
 *
 * Off unless `WLO_BAPI_VIA_REPOSITORY` is set; which flows may be started is
 * the operator's list `WLO_BAPI_FLOWS`. Only the four paths of the job surface
 * are ever called — a fixed shape checked here, before any request.
 */

import { currentCredential } from '../../auth/credential.js';
import { isEnabledFlag } from '../write/credential-gate.js';
import { wloFetch } from '../../wlo-fetch.js';
import { WLO_REPOSITORY_URL } from '../../wlo-config.js';
import { wroteNothing } from '../../upstream-error.js';

/** `WLO_BAPI_VIA_REPOSITORY` — read per call so the switch is testable; the operator sets it once. */
export function bapiViaRepositoryEnabled(): boolean {
  return isEnabledFlag(process.env['WLO_BAPI_VIA_REPOSITORY']);
}

/**
 * `namespace/id` — the b-api's names: letters, digits and `_.-`, each part
 * starting with a letter, a digit, `_` or `-`. Never a part of dots alone and
 * never `..` anywhere: such a part in a PATH is a step out of the job surface
 * once the URL is normalised (review 2026-11-17).
 */
export const FLOW_NAME = /^(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/;
/** A job id as it may stand in a path — the same rule for one part. */
export const JOB_ID = /^(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/;

/** `WLO_BAPI_FLOWS`: the flows this server may start, comma-separated. Empty = none. */
export function allowedFlows(): ReadonlySet<string> {
  return new Set((process.env['WLO_BAPI_FLOWS'] ?? '').split(',').map(f => f.trim()).filter(f => FLOW_NAME.test(f)));
}

/** The JSON of a flow's inputs may not be larger than this. */
export const MAX_INPUT_BYTES = 64 * 1024;
/** Outputs larger than this are left out of the answer, with `truncated`. */
export const MAX_OUTPUT_BYTES = 1024 * 1024;
const CALL_TIMEOUT_MS = 30_000;

export type BapiReason =
  | 'login_required' | 'edu_user_required' | 'rejected' | 'bad_inputs' | 'rate_limited'
  | 'unknown_job' | 'not_allowed' | 'upstream_error';

export interface BapiFailure {
  ok: false;
  reason: BapiReason;
  /** The b-api's own code, when it named one (`EDU_USER_NOT_VERIFIED`, `LEGACY_HEADERS` …). Foreign text: short, as given. */
  code?: string;
  retryAfter?: number;
  status?: number;
}

/** Only a person's own login may start or watch a flow — never the shared account, never nobody. */
export function personalLoginPresent(): boolean {
  return currentCredential()?.source === 'user';
}

/** The four calls of the job surface, method and path together, and nothing else. */
export function isJobPath(method: 'GET' | 'POST' | 'DELETE', path: string): boolean {
  if (path === '/api/v1/jobs/flows') return method === 'GET';
  const flow = /^\/api\/v1\/jobs\/flows\/([^/]+\/[^/]+)$/.exec(path);
  if (flow) return method === 'POST' && FLOW_NAME.test(flow[1]!);
  const job = /^\/api\/v1\/jobs\/([^/?]+)(\?details=true)?$/.exec(path);
  if (!job || job[1] === 'flows' || !JOB_ID.test(job[1]!)) return false;
  return job[2] ? method === 'GET' : method === 'GET' || method === 'DELETE';
}

interface BapiAnswer { status: number; body: unknown; retryAfter?: number }

/**
 * One call to the repository's b-api proxy, as the person in scope. Throws on
 * an abort or a network failure — for a START that is an open outcome, which
 * the caller decides; it never becomes a status here.
 */
async function bapiFetch(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<BapiAnswer> {
  if (!isJobPath(method, path)) throw new Error(`not a job call: ${method} ${path}`);
  if (!personalLoginPresent()) throw new Error('b-api call without a personal login');
  const url = `${WLO_REPOSITORY_URL}/rest/bapi${path}`;
  const res = await wloFetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      // A login the repository no longer accepts must not continue as the guest:
      // the proxy would then answer the flow list EMPTY instead of refusing.
      DisableGuest: 'true',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  const ra = Number(res.headers.get('retry-after'));
  return { status: res.status, body: parsed, ...(Number.isFinite(ra) && ra > 0 ? { retryAfter: Math.ceil(ra) } : {}) };
}

/** The b-api's own error code in either of its two shapes, cut short. */
function codeOf(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const err = b['error'];
  const raw = (err && typeof err === 'object' ? (err as Record<string, unknown>)['code'] : undefined)
    ?? b['code'] ?? (typeof err === 'string' ? err : undefined);
  return typeof raw === 'string' && raw ? raw.replace(/[^\x20-\x7e]/g, '').slice(0, 80) : undefined;
}

/** A refusal of the b-api as a reason; `notFound` says what a 404 means for this call. */
export function failureFrom(answer: BapiAnswer, notFound: BapiReason): BapiFailure {
  const code = codeOf(answer.body);
  const base = { ok: false as const, status: answer.status, ...(code ? { code } : {}) };
  if (answer.status === 429) {
    return { ...base, reason: 'rate_limited', ...(answer.retryAfter ? { retryAfter: answer.retryAfter } : {}) };
  }
  if (answer.status === 400) return { ...base, reason: code === 'EDU_USER_REQUIRED' ? 'edu_user_required' : 'bad_inputs' };
  if (answer.status === 401 || answer.status === 403) return { ...base, reason: 'rejected' };
  if (answer.status === 404) return { ...base, reason: notFound };
  return { ...base, reason: 'upstream_error' };
}

const LOGIN_REQUIRED: BapiFailure = { ok: false, reason: 'login_required' };

export interface FlowInfo { flow: string; description?: string; inputSchema?: unknown }

/** The released flows the person may start, cut to `WLO_BAPI_FLOWS`. */
export async function listFlows(): Promise<{ ok: true; flows: FlowInfo[] } | BapiFailure> {
  if (!personalLoginPresent()) return LOGIN_REQUIRED;
  const answer = await bapiFetch('GET', '/api/v1/jobs/flows');
  if (answer.status !== 200) return failureFrom(answer, 'upstream_error');
  // Another shape than a list says nothing about what is released.
  if (!Array.isArray(answer.body)) return { ok: false, reason: 'upstream_error', status: 200 };
  const list = answer.body;
  const allowed = allowedFlows();
  const flows: FlowInfo[] = [];
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const e = f as Record<string, unknown>;
    const name = `${String(e['namespace'] ?? '')}/${String(e['flowId'] ?? '')}`;
    if (!allowed.has(name) || e['active'] === false) continue;
    flows.push({
      flow: name,
      ...(typeof e['description'] === 'string' ? { description: e['description'] } : {}),
      ...(e['inputSchema'] && typeof e['inputSchema'] === 'object' ? { inputSchema: e['inputSchema'] } : {}),
    });
  }
  return { ok: true, flows };
}

/**
 * Start a flow. 202 (or 200) with a usable `jobId` is the only success. Whether a
 * refusal started nothing is `wroteNothing`'s call, the one reading for every
 * write: a 4xx but 429 did; a 429 (busy, no verdict), a 5xx or an answer without
 * a `jobId` leaves it OPEN whether a job runs — the caller says so, it is not a
 * failure. An abort throws (open as well).
 */
export async function startFlow(flow: string, inputs: unknown): Promise<
  { ok: true; jobId: string } | (BapiFailure & { open?: true })
> {
  if (!personalLoginPresent()) return LOGIN_REQUIRED;
  const answer = await bapiFetch('POST', `/api/v1/jobs/flows/${flow}`, inputs);
  const jobId = answer.body && typeof answer.body === 'object' ? (answer.body as Record<string, unknown>)['jobId'] : undefined;
  if ((answer.status === 202 || answer.status === 200) && typeof jobId === 'string' && JOB_ID.test(jobId)) {
    return { ok: true, jobId };
  }
  const failure = failureFrom(answer, 'not_allowed');
  if (wroteNothing(answer.status)) return failure;
  // Accepted without a usable id, busy, or the b-api failed: a job may exist. A 429 keeps its reason and wait.
  return { ...failure, ...(answer.status === 429 ? {} : { reason: 'upstream_error' as const }), open: true };
}

export type JobState = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';

/** The b-api's raw job status as one of five; one it does not document reads `unknown`, never "running". */
export function mapJobStatus(raw: string): JobState {
  const s = raw.toUpperCase();
  // KILLING is Kestra on its way to KILLED: not over yet.
  if (['QUEUED', 'RUNNING', 'CREATED', 'PAUSED', 'RESTARTED', 'RETRYING', 'KILLING'].includes(s)) return 'running';
  if (['SUCCEEDED', 'SUCCESS', 'WARNING'].includes(s)) return 'succeeded';
  if (s === 'FAILED') return 'failed';
  if (s === 'CANCELLED' || s === 'KILLED') return 'cancelled';
  return 'unknown';
}

export interface JobFile { outputId: string; name: string; size?: number; available: boolean }
export interface JobStatus {
  ok: true;
  state: JobState;
  rawStatus: string;
  errorCode?: string;
  warnings?: boolean;
  outputs?: unknown;
  truncated?: true;
  files?: JobFile[];
  /** A flow with loops: the b-api's counters, as given. */
  progress?: JobProgress;
  /** Iterations per state, from `details=true` — numbers only, never a value or a code. */
  iterations?: Record<'running' | 'succeeded' | 'warning' | 'failed' | 'cancelled', number>;
  /** The iteration list was a sample (the b-api lists at most 200); `progress.started` is the total. */
  iterationsSampled?: true;
}

export interface JobProgress { started: number; running: number; succeeded: number; warning: number; failed: number }

const PROGRESS_KEYS = ['started', 'running', 'succeeded', 'warning', 'failed'] as const;

function progressOf(raw: unknown): JobProgress | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (!PROGRESS_KEYS.every(k => typeof r[k] === 'number' && Number.isFinite(r[k]))) return undefined;
  return Object.fromEntries(PROGRESS_KEYS.map(k => [k, r[k] as number])) as unknown as JobProgress;
}

/** Count the iteration list per state; an entry without a known state is not counted. */
function iterationCounts(raw: unknown[]): NonNullable<JobStatus['iterations']> {
  const counts = { running: 0, succeeded: 0, warning: 0, failed: 0, cancelled: 0 };
  for (const it of raw) {
    const status = it && typeof it === 'object' ? String((it as Record<string, unknown>)['status'] ?? '').toUpperCase() : '';
    if (status === 'WARNING') counts.warning += 1;
    else {
      const state = mapJobStatus(status);
      if (state !== 'unknown') counts[state] += 1;
    }
  }
  return counts;
}

/** The state of one of the person's jobs. A foreign or unknown id is `unknown_job` (the b-api says 404 to both). */
export async function flowStatus(jobId: string): Promise<JobStatus | BapiFailure> {
  if (!personalLoginPresent()) return LOGIN_REQUIRED;
  if (!JOB_ID.test(jobId)) return { ok: false, reason: 'unknown_job' };
  const answer = await bapiFetch('GET', `/api/v1/jobs/${jobId}?details=true`);
  if (answer.status !== 200 || !answer.body || typeof answer.body !== 'object') return failureFrom(answer, 'unknown_job');
  const b = answer.body as Record<string, unknown>;
  const rawStatus = typeof b['status'] === 'string' ? b['status'].replace(/[^A-Za-z_]/g, '').slice(0, 40) : '';
  const state = mapJobStatus(rawStatus);
  const errorCode = codeOf({ error: b['error'] });
  const out: JobStatus = { ok: true, state, rawStatus, ...(errorCode ? { errorCode } : {}) };
  if (typeof b['warnings'] === 'boolean') out.warnings = b['warnings'];
  // Outputs only for a finished success (the b-api has none before), bounded.
  if (state === 'succeeded' && b['outputs'] !== undefined) {
    const size = Buffer.byteLength(JSON.stringify(b['outputs']), 'utf8');
    if (size <= MAX_OUTPUT_BYTES) out.outputs = b['outputs'];
    else out.truncated = true;
  }
  const progress = progressOf(b['progress']);
  if (progress) out.progress = progress;
  if (Array.isArray(b['iterations'])) {
    out.iterations = iterationCounts(b['iterations']);
    const listed = Object.values(out.iterations).reduce((a, n) => a + n, 0);
    if (progress && progress.started > b['iterations'].length && listed > 0) out.iterationsSampled = true;
  }
  if (Array.isArray(b['files'])) {
    // Never a `downloadUrl`: it opens with the login. Name, size, id and whether it is still there.
    out.files = b['files'].flatMap((f): JobFile[] => {
      if (!f || typeof f !== 'object') return [];
      const e = f as Record<string, unknown>;
      if (typeof e['outputId'] !== 'string') return [];
      return [{
        outputId: e['outputId'].slice(0, 128), name: String(e['name'] ?? '').slice(0, 200),
        ...(typeof e['size'] === 'number' ? { size: e['size'] } : {}), available: e['available'] !== false,
      }];
    });
  }
  return out;
}

/** End one of the person's jobs. 409 = it had already finished; 404 = not hers, or unknown. */
export async function cancelFlow(jobId: string): Promise<
  { ok: true; outcome: 'cancelled' | 'already_finished' | 'unknown_job' } | BapiFailure
> {
  if (!personalLoginPresent()) return LOGIN_REQUIRED;
  if (!JOB_ID.test(jobId)) return { ok: true, outcome: 'unknown_job' };
  const answer = await bapiFetch('DELETE', `/api/v1/jobs/${jobId}`);
  if (answer.status === 200 || answer.status === 202 || answer.status === 204) return { ok: true, outcome: 'cancelled' };
  if (answer.status === 409) return { ok: true, outcome: 'already_finished' };
  if (answer.status === 404) return { ok: true, outcome: 'unknown_job' };
  return failureFrom(answer, 'unknown_job');
}
