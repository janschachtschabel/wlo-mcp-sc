/**
 * tools/curation-batch.ts – MA-3/MA-4: filing a batch of files into the person's personal area.
 *
 * Three tools, all through `registerCurationTool` (oauth2 + write gate), registered only with
 * `WLO_BATCH_UPLOAD_ENABLED` (`server.ts` calls the registration unconditionally; it checks). Meant
 * for the chatbot's upload module, not for a model: the module shows the preview and the person
 * clicks "Jetzt übertragen" (the chatbot never offers these to its agent).
 *
 *  1. `wlo_prepare_file_batch` — the plan → preview + ONE `batchToken` (MA-3). The preview names
 *     everything the later calls will create: target, folder (or flat), each file with title, type,
 *     size and record name, and the closing `vorgang.json` built from exactly this plan.
 *     `structuredContent` carries the normalised plan, so the module shows what the server will
 *     file. Personal login only: a service account is refused, never used.
 *  2. `wlo_store_batch_file {batchToken, index, ref}` — the file the chatbot put into an upload slot
 *     (`POST /api/uploads`, MA-2) is filed as entry `index`. Bytes must match the approved checksum
 *     and type (else nothing is created and the index stays redeemable). The first file creates the
 *     folder; ONLY a refused folder (403) continues flat (`folderDenied`), any other failure fails the
 *     file and is retried with the next one.
 *  3. `wlo_store_batch_manifest {batchToken}` — `vorgang.json` (`MANIFEST_FORMAT`, `@2` with each entry's
 *     role since 2026-11-08), built by the
 *     SERVER from the plan and the results (the caller sends no content), once per batch, only after
 *     at least one stored file.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { currentCredential } from '../auth/credential.js';
import {
  BATCH_TTL_MS, BatchConfirmations, batchOwner, type BatchPlan, type FolderChoice, type StoreResult, TooManyBatches } from '../services/write/batch-confirm.js';
import { createBatchFolder, fileBatchEntry, fileManifest, folderLayout } from '../services/write/batch-filing.js';
import { BATCH_ROLES, MANIFEST_FORMAT, type BatchRole } from '../services/write/batch-manifest.js';
import { fileNameFrom } from '../services/write/content-source.js';
import { requireWrite, writeMode } from '../services/write/credential-gate.js';
import { batchUploadEnabled, sharedUploadSlots, slotIdentity } from '../services/write/upload-slot.js';
import { flattenText } from '../text-sanitize.js';
import type { WloToolResult } from '../apps/register.js';
import { registerCurationTool, codedError, isOutcomeOpen, timeoutOrError, type WriteAuthChallenge } from './curation-shared.js';
import { registerMyBatchesTool } from './curation-batch-list.js';

const EXT = ['pdf', 'docx', 'pptx', 'xlsx', 'odt', 'ods', 'odp', 'png', 'jpg', 'gif', 'webp', 'mp3', 'mp4',
  'txt', 'md'] as const;
const MAX_ENTRIES = 200;

const batches = new BatchConfirmations();

/** Test seam: the approvals live for the process, the tests of one file must not inherit each other's. */
export function resetBatchesForTest(): void {
  batches.resetForTest();
}

/**
 * A refusal keeps its established fields (`status`, `reason`) AND carries the
 * `error {code, message}` every other tool answers with — a client must not need
 * a second error shape for four tools. The code is the `reason`; a failed file
 * without one is an upstream failure.
 */
function result(text: string, structured: Record<string, unknown>, isError = false, outcomeOpen?: boolean): WloToolResult {
  const code = typeof structured['reason'] === 'string' ? structured['reason'] : 'upstream_error';
  // `outcomeOpen` like every other curation error (audit 2026-11-12, K-7). The
  // SERVICE says when a failed step may have created something all the same
  // (`open`: a 5xx, an answer without an id) — an id in the answer does not
  // tell, a failed step never carries one. `open` itself is not part of the
  // answer; it becomes `error.outcomeOpen`.
  const { open: serviceSaysOpen, ...shown } = structured;
  const open = outcomeOpen ?? serviceSaysOpen === true;
  return { content: [{ type: 'text' as const, text }],
    structuredContent: isError
      ? { ...shown, error: { code, message: text, outcomeOpen: open, ...(typeof shown['scope'] === 'string' ? { scope: shown['scope'] } : {}) } }
      : shown,
    ...(isError ? { isError: true } : {}) };
}

/** Every error of the batch tools carries `outcomeOpen` — also one that came through `timeoutOrError`'s plain branch. */
function withOpen(reply: WloToolResult, open: boolean): WloToolResult {
  const sc = reply.structuredContent as { error?: Record<string, unknown> } | undefined;
  if (!sc?.error || typeof sc.error['outcomeOpen'] === 'boolean' && sc.error['outcomeOpen'] === open) return reply;
  return { ...reply, structuredContent: { ...sc, error: { ...sc.error, outcomeOpen: sc.error['outcomeOpen'] === true || open } } };
}

interface Person { owner: string; slotIdentity: string }

/**
 * Owner and slot identity of a personal login, or a refusal (none, anonymous,
 * service account). The refusal carries the sign-in challenge like the curation
 * gate does: it fires when the operator allows service-account writes, the gate
 * lets that account through, and only a personal login can go on.
 */
function personal(challenge: WriteAuthChallenge): Person | { refusal: WloToolResult } {
  requireWrite();
  const cred = currentCredential();
  const owner = writeMode() === 'user' ? batchOwner(cred) : null;
  const slot = slotIdentity(cred);
  if (!owner || !slot) {
    const refusal = codedError('login_required', 'Die Ablage in den persönlichen Bereich geht nur mit der eigenen WLO-Anmeldung — ' +
      'nicht über ein gemeinsames Konto.');
    return { refusal: { ...refusal, _meta: { 'mcp/www_authenticate': [challenge] } } };
  }
  return { owner, slotIdentity: slot };
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

function chooseFolder(token: string, plan: BatchPlan): Promise<FolderChoice> {
  if (plan.layout === 'flat') return Promise.resolve({ ok: true, parent: '-userhome-', denied: false });
  return batches.folder(token, async () => {
    const f = await createBatchFolder(plan.folderName);
    if (f.status === 'created') return { ok: true, parent: f.nodeId, denied: false };
    // Only a refusal of the permission is the sanctioned fall-back to flat (plan E-3a).
    if (f.status === 'denied') return { ok: true, parent: '-userhome-', denied: true };
    return { ok: false, detail: f.detail, ...(f.open ? { open: true as const } : {}) };
  });
}

function refusedToken(outcome: 'unknown' | 'expired' | 'mismatch'): WloToolResult {
  const warum = { unknown: 'unbekannt', expired: 'abgelaufen', mismatch: 'gehört zu einer anderen Anmeldung' }[outcome];
  // An unknown or expired approval may have filed files BEFORE it was lost — a
  // restart forgets every approval, not what was stored under it. Only a
  // mismatch (another login) says nothing about this caller's batch.
  const mayHaveFiled = outcome !== 'mismatch';
  return result(`Die Freigabe ist ${warum}. Dieser Aufruf hat nichts abgelegt`
    + (mayHaveFiled ? '; unter dieser Freigabe früher abgelegte Dateien bleiben bestehen — wlo_list_my_batches zeigt sie' : '')
    + '. Bitte den Stapel neu vorbereiten.', { status: 'failed', reason: `batch_${outcome}` }, true, mayHaveFiled);
}

export function registerCurationBatchTools(server: McpServer, challenge: WriteAuthChallenge): void {
  if (!batchUploadEnabled()) return;
  // Item 9 belongs to the batch surface: same switch, same personal-login rule.
  registerMyBatchesTool(server, challenge, () => {
    const p = personal(challenge);
    return 'refusal' in p ? p.refusal : null;
  });

  registerCurationTool(server, challenge, {
    name: 'wlo_prepare_file_batch',
    title: 'WLO Stapel-Ablage vorbereiten',
    description:
      'Bereite die Ablage mehrerer Dateien in den PERSÖNLICHEN Bereich der angemeldeten Person vor: ' +
      'Vorschau (Ziel, Ordner, jede Datei, abschließend vorgang.json) und ein Freigabe-Schlüssel für genau ' +
      'diese Liste. Legt noch nichts an. Für das Upload-Modul des Chatbots; erfordert die eigene WLO-Anmeldung.',
    inputSchema: {
      target: z.enum(['home']).describe('Ziel: der persönliche Bereich (andere Ziele sind nicht freigeschaltet).'),
      folderName: z.string().min(1).max(120).describe('Name des Vorgangs-Ordners.'),
      entries: z.array(z.object({
        title: z.string().min(1).max(200),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        size: z.number().int().positive(),
        ext: z.enum(EXT),
        role: z.enum(BATCH_ROLES as [BatchRole, ...BatchRole[]]).optional()
          .describe('structure = das Strukturdokument des Vorgangs, content = ein Inhalt (Vorgabe).'),
      })).min(1).max(MAX_ENTRIES),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: async (params) => {
      const wer = personal(challenge);
      if ('refusal' in wer) return wer.refusal;
      const entries = (params['entries'] as Array<Record<string, unknown>>).map((e, index) => {
        // Flattened, NOT capped: `sanitizeText` cuts at 120 characters, the schema
        // allows 200, and this string becomes the record's title — a title
        // silently shortened on the way from the list to the record (K-14).
        const title = flattenText(String(e['title'])).slice(0, 200).trim();
        const ext = String(e['ext']);
        const role: BatchRole = e['role'] === 'structure' ? 'structure' : 'content';
        return { index, title, sha256: String(e['sha256']), size: Number(e['size']), ext,
          fileName: fileNameFrom(title, ext), role };
      });
      const layout = await folderLayout();
      const plan: BatchPlan = { target: 'home', folderName: flattenText(String(params['folderName']))
        .slice(0, 120).trim(), layout, entries };
      // Read BEFORE minting, so the stated expiry is never later than the real one.
      const mintedAt = Date.now();
      let token: string;
      try {
        token = batches.mint(wer.owner, plan);
      } catch (err) {
        if (!(err instanceof TooManyBatches)) throw err;
        // Nothing was prepared and nothing touched: a running batch is not given up for a new one.
        return result(err.scope === 'owner'
          ? 'Es sind bereits mehrere Stapel dieser Anmeldung in Arbeit. Bitte erst einen davon abschließen '
            + '(wlo_store_batch_manifest) oder auslaufen lassen (30 Minuten) — sonst ginge dessen Freigabe verloren.'
          : 'Der Server hält gerade zu viele laufende Stapel. Bitte in einigen Minuten erneut versuchen.',
          // `scope`: whose limit — `owner` can finish a batch of their own, `server` can only wait (D4).
          { status: 'failed', reason: 'too_many_batches', scope: err.scope }, true, false);
      }
      const total = entries.reduce((n, e) => n + e.size, 0);
      const zeile = (e: typeof entries[number]) =>
        `- ${e.title} (${e.ext}, ${megabytes(e.size)}, als „${e.fileName}“)${e.role === 'structure' ? ' — Strukturdokument' : ''}`;
      // EVERY file: the approval covers the whole list, so the preview shows the
      // whole list — twenty of two hundred was consent to 180 lines nobody saw
      // (audit 2026-11-12, S-5). Bounded by MAX_ENTRIES and the title cap.
      const zeilen = entries.map(zeile);
      const ziel = layout === 'folder'
        ? `in einen neuen Ordner „${plan.folderName}“ in deinem persönlichen Bereich`
        : 'direkt in deinen persönlichen Bereich (ein eigener Ordner ist für dein Konto nicht freigeschaltet)';
      return result(
        [`Vorschau — ${entries.length} Dateien (${megabytes(total)}) ${ziel}:`, ...zeilen,
          'Zum Schluss kommt vorgang.json dazu: Titel, Art, Größe, Prüfsumme, Rolle, Ablageort und Stand jeder Datei ' +
          'dieser Liste (vom Server gebaut, nichts anderes). Titel, Kennung, Stand und Rolle (wo Strukturdokument) jeder Datei stehen zusätzlich ' +
          'in der Beschreibung des Datensatzes (cm:description) — darüber findet wlo_list_my_batches die Ablage wieder.',
          'Es ist noch nichts angelegt. Mit dem Freigabe-Schlüssel wird jede Datei einzeln abgelegt (30 Minuten gültig).']
          .join('\n'),
        { batchToken: token, layout, count: entries.length, totalBytes: total, folderName: plan.folderName,
          entries: entries.map(({ index, title, ext, size, fileName, role }) => ({ index, title, ext, size, fileName, role })),
          // The same shape every other write's preview carries (12a); `batchToken`
          // stays for existing callers. `tool` is stamped by `registerCurationTool`.
          confirm: {
            token,
            expiresAt: new Date(mintedAt + BATCH_TTL_MS).toISOString(),
            preview: {
              action: 'change',
              target: { kind: 'home', title: plan.folderName },
              statement: `Legt ${entries.length} Dateien im persönlichen Bereich ab, dazu vorgang.json.`,
              fields: [],
            },
          } });
    },
  });

  registerCurationTool(server, challenge, {
    name: 'wlo_store_batch_file',
    title: 'WLO Datei aus dem Stapel ablegen',
    description:
      'Lege eine Datei eines freigegebenen Stapels ab (Index aus der Vorschau, ref aus POST /api/uploads). ' +
      'Jeder Index nur einmal; die Datei muss zur Freigabe passen. Für das Upload-Modul des Chatbots.',
    inputSchema: {
      batchToken: z.string().min(10).max(200),
      index: z.number().int().min(0).max(MAX_ENTRIES - 1),
      ref: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: async (params) => {
      const wer = personal(challenge);
      if ('refusal' in wer) return wer.refusal;
      const token = String(params['batchToken']);
      const index = Number(params['index']);
      const r = batches.redeem(token, wer.owner, index);
      // A refused token leaves the slot alone (chatbot feedback 2026-11-07): the
      // same upload can be filed under a freshly prepared batch instead of being
      // sent again. Memory stays bounded by the slot caps and its 30-minute life.
      if (r.outcome !== 'ok' && r.outcome !== 'already') return refusedToken(r.outcome);
      // From here the slot is TAKEN: on every path below it is either filed or
      // dropped — an "already" must not leave surplus bytes in memory.
      const slot = sharedUploadSlots().take(String(params['ref']), wer.slotIdentity);
      if (r.outcome === 'already') return result(`Datei ${index} wurde schon behandelt.`, { ...r.result, already: true });
      if (!slot) {
        batches.abandon(token, index);
        return result('Die hochgeladene Datei ist nicht (mehr) da — bitte erneut hochladen.', { status: 'failed', reason: 'slot_missing' }, true);
      }
      if (slot.sha256 !== r.entry.sha256 || slot.type.ext !== r.entry.ext) {
        batches.abandon(token, index);   // nothing created: the index stays redeemable
        return result(`Datei ${index} passt nicht zur Freigabe (Prüfsumme oder Art) — nichts abgelegt.`,
          { status: 'failed', reason: 'mismatch_bytes' }, true);
      }
      let choice: FolderChoice;
      try {
        choice = await chooseFolder(token, r.plan);
      } catch (err) {
        batches.abandon(token, index);
        return withOpen(timeoutOrError('Der Ordner konnte nicht angelegt werden', err, 'Ein Ordner kann angelegt sein'), isOutcomeOpen(err));
      }
      if (!choice.ok) {
        batches.abandon(token, index);
        // "Erneut senden" only where nothing can exist: with `renameIfExists` a
        // second try after a create that DID land makes a second folder.
        return result(choice.open
          // Not "send the file again": the open choice is kept, so every further
          // file of THIS batch gets the same answer. The way on is a new batch.
          ? 'Der Ordner wurde möglicherweise angelegt, die Antwort war aber nicht verwertbar. Für diesen Stapel wird '
            + 'kein zweiter Ordner angelegt und keine weitere Datei abgelegt — bitte im persönlichen Bereich nachsehen '
            + 'und den Stapel NEU vorbereiten (wlo_prepare_file_batch).'
          : 'Der Ordner konnte nicht angelegt werden — die Datei bitte erneut senden.',
          { status: 'failed', reason: 'folder_failed', detail: choice.detail }, true, choice.open === true);
      }
      let stored: StoreResult;
      try {
        stored = await fileBatchEntry(choice.parent, r.entry, slot);
      } catch (err) {
        // A record may exist (an abort hits the answer, not the work): recorded as OPEN, so a retry
        // reports it instead of filing a second one — and the index never stays "in flight".
        batches.record(token, index, { status: 'unverified',
          detail: 'Beim Ablegen kam keine Antwort — bitte im persönlichen Bereich nachsehen.' });
        // Recorded as `unverified` above — the answer must not say less than the record does.
        return withOpen(timeoutOrError('Die Datei konnte nicht abgelegt werden', err, `Ob Datei ${index} angelegt wurde, ist offen`), true);
      }
      batches.record(token, index, stored);
      const text = { stored: 'abgelegt', dropped: 'angelegt, aber ohne Inhalt', unverified: 'unklar (nicht bestätigt)',
        failed: 'nicht abgelegt' }[stored.status];
      return result(`Datei ${index} (${r.entry.title}): ${text}.`, { ...stored, folderDenied: choice.denied },
        stored.status === 'failed');
    },
  });

  registerCurationTool(server, challenge, {
    name: 'wlo_store_batch_manifest',
    title: 'WLO Vorgang zum Stapel ablegen',
    description:
      `Lege vorgang.json (${MANIFEST_FORMAT}, mit der Rolle jeder Datei) zum freigegebenen Stapel in denselben Ordner — vom Server aus ` +
      'der Freigabe und den Ergebnissen gebaut, einmal je Stapel. Für das Upload-Modul des Chatbots.',
    inputSchema: { batchToken: z.string().min(10).max(200) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: async (params) => {
      const wer = personal(challenge);
      if ('refusal' in wer) return wer.refusal;
      const token = String(params['batchToken']);
      const claim = batches.claimManifest(token, wer.owner);
      if (typeof claim === 'string') return refusedToken(claim);
      if ('already' in claim) {
        const text = claim.already.status === 'stored' ? 'Der Vorgang liegt schon ab.'
          : `Der Vorgang wurde schon behandelt: ${claim.already.detail ?? claim.already.status}`;
        return result(text, { ...claim.already, already: true });
      }
      const { plan, results } = claim;
      if (![...results.values()].some((x) => x.status === 'stored')) {
        batches.releaseManifest(token);
        return result('Noch keine Datei abgelegt — der Vorgang wird erst danach dazugelegt.', { status: 'failed', reason: 'nothing_stored' }, true);
      }
      let choice: FolderChoice;
      try {
        choice = await chooseFolder(token, plan);
      } catch (err) {
        // Nothing of the manifest was sent yet: it may be claimed again.
        batches.releaseManifest(token);
        return withOpen(timeoutOrError('Der Ordner für den Vorgang war nicht erreichbar', err, 'Ein Ordner kann angelegt sein'), isOutcomeOpen(err));
      }
      try {
        if (!choice.ok) {
          batches.releaseManifest(token);
          return result('Der Ordner ist nicht erreichbar — der Vorgang wurde nicht abgelegt.',
            { status: 'failed', reason: 'folder_failed' }, true, choice.open === true);
        }
        const manifest = {
          format: MANIFEST_FORMAT, ordner: plan.folderName, layout: choice.denied ? 'flat' : plan.layout,
          inhalte: plan.entries.map((e) => {
            const r = results.get(e.index);
            return { index: e.index, titel: e.title, art: e.ext, groesse: e.size, sha256: e.sha256, name: e.fileName,
              rolle: e.role, stand: r?.status ?? 'offen', ...(r?.nodeId ? { nodeId: r.nodeId } : {}) };
          }),
        };
        const out = await fileManifest(choice.parent, manifest);
        if (out.status === 'failed') batches.releaseManifest(token); else batches.recordManifest(token, out);
        return result(`Vorgang: ${out.status}.`, { ...out }, out.status === 'failed');
      } catch (err) {
        // Possibly created: recorded as open, never filed a second time and never reported as filed.
        batches.recordManifest(token, { status: 'unverified',
          detail: 'Beim Ablegen von vorgang.json kam keine Antwort — bitte im persönlichen Bereich nachsehen.' });
        return withOpen(timeoutOrError('Der Vorgang konnte nicht abgelegt werden', err, 'Ob vorgang.json angelegt wurde, ist offen'), true);
      }
    },
  });
}
