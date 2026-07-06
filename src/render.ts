/**
 * Transcript-to-Markdown rendering: joins transcript speakerIds against the
 * parties of `calls search`, and formats monologues with timestamps and topics.
 * Pure functions — no I/O; `gong calls render` wires them to files.
 */

export interface TranscriptSentence {
  start?: number;
  end?: number;
  text?: string;
}

export interface TranscriptMonologue {
  speakerId?: string;
  topic?: string | null;
  sentences?: TranscriptSentence[];
}

export interface TranscriptRecord {
  callId?: string;
  transcript?: TranscriptMonologue[];
}

export interface CallParty {
  speakerId?: string | null;
  name?: string;
  emailAddress?: string;
  affiliation?: string;
}

export interface ExtensiveCall {
  id?: string;
  metaData?: CallMetaData;
  parties?: CallParty[];
}

export interface CallMetaData {
  id?: string;
  title?: string;
  started?: string;
  duration?: number;
  url?: string;
}

export interface PartyIndex {
  speakerByCall: Map<string, Map<string, CallParty>>;
  metaByCall: Map<string, CallMetaData>;
}

/** Index extensive-call records by callId: speakerId→party and call metadata. */
export function buildPartyIndex(extensiveCalls: ExtensiveCall[]): PartyIndex {
  const speakerByCall = new Map<string, Map<string, CallParty>>();
  const metaByCall = new Map<string, CallMetaData>();
  for (const call of extensiveCalls) {
    const meta = call.metaData ?? {};
    const callId = meta.id ?? call.id;
    if (!callId) continue;
    metaByCall.set(callId, meta);
    const speakers = new Map<string, CallParty>();
    for (const party of call.parties ?? []) {
      if (party.speakerId) speakers.set(party.speakerId, party);
    }
    speakerByCall.set(callId, speakers);
  }
  return { speakerByCall, metaByCall };
}

export function msToTimestamp(ms: number | undefined | null): string {
  if (ms === undefined || ms === null) return '?';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Human-readable speaker name from a party; falls back gracefully. */
export function speakerLabel(party: CallParty | undefined): string {
  if (!party) return 'Unknown speaker';
  const { name, affiliation, emailAddress } = party;
  if (name && affiliation && affiliation !== 'Unknown') return `${name} (${affiliation})`;
  return name ?? emailAddress ?? 'Unknown speaker';
}

/** Render one callTranscript record into speaker-labeled Markdown. */
export function renderTranscriptMd(
  record: TranscriptRecord,
  speakerMap: Map<string, CallParty> = new Map(),
  meta: CallMetaData = {},
): string {
  const lines: string[] = [];

  lines.push(`# ${meta.title ?? 'Untitled call'}`, '');
  lines.push(`**Call ID:** ${record.callId}`);
  if (meta.started) lines.push(`**Date:** ${meta.started}`);
  if (meta.duration !== undefined && meta.duration !== null) {
    lines.push(`**Duration:** ${msToTimestamp(meta.duration * 1000)}`);
  }
  if (meta.url) lines.push(`**Gong URL:** ${meta.url}`);
  if (speakerMap.size > 0) {
    const participants = [...new Set([...speakerMap.values()].map(speakerLabel))].sort();
    lines.push(`**Participants:** ${participants.join(', ')}`);
  }
  lines.push('', '---', '');

  for (const monologue of record.transcript ?? []) {
    const sid = monologue.speakerId;
    const party = sid ? speakerMap.get(sid) : undefined;
    const label = party ? speakerLabel(party) : sid ? `Speaker ${sid}` : 'Unknown speaker';
    const sentences = monologue.sentences ?? [];
    const text = sentences
      .map((s) => (s.text ?? '').trim())
      .join(' ')
      .trim();
    if (!text) continue;
    let header = `**${label}** [${msToTimestamp(sentences[0]?.start)}]`;
    if (monologue.topic) header += `  _(topic: ${monologue.topic})_`;
    lines.push(header, '', text, '');
  }

  return lines.join('\n').trimEnd() + '\n';
}

/** Filesystem-safe Markdown filename from a call's title and id. */
export function safeFilename(callId: string | undefined, title: string | undefined): string {
  let base = (title ?? 'call')
    .toLowerCase()
    .replace(/[^a-z0-9 \-_]/g, '')
    .trim()
    .split(/\s+/)
    .join('-')
    .slice(0, 60);
  if (!base) base = 'call';
  return `${base}-${callId ?? 'unknown'}.md`;
}

/**
 * Accept either gong-cli's unwrapped array output or a raw API envelope
 * ({envelopeKey: [...]}) or a single record object.
 */
export function unwrapRecords<T>(data: unknown, envelopeKey: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data !== null && typeof data === 'object') {
    const wrapped = (data as Record<string, unknown>)[envelopeKey];
    if (Array.isArray(wrapped)) return wrapped as T[];
    return [data as T];
  }
  return [];
}
