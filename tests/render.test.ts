import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildPartyIndex,
  msToTimestamp,
  renderTranscriptMd,
  safeFilename,
  speakerLabel,
  unwrapRecords,
} from '../src/render.js';
import { runCli } from './helpers.js';

const TRANSCRIPT = {
  callId: '123',
  transcript: [
    {
      speakerId: 'spk-1',
      topic: 'Call Setup',
      sentences: [
        { start: 4000, end: 5000, text: 'Thanks for making the time.' },
        { start: 5200, end: 6000, text: 'Shall we start?' },
      ],
    },
    {
      speakerId: 'spk-2',
      topic: null,
      sentences: [{ start: 11000, end: 12000, text: 'Sure thing.' }],
    },
    { speakerId: 'spk-1', topic: null, sentences: [{ start: 13000, end: 13500, text: '   ' }] },
  ],
};

const EXTENSIVE_CALL = {
  metaData: {
    id: '123',
    title: 'Initech <> Globex — Discovery',
    started: '2026-06-03T15:00:00Z',
    duration: 1934,
    url: 'https://app.gong.io/call?id=123',
  },
  parties: [
    { speakerId: 'spk-1', name: 'Jane Doe', affiliation: 'Internal' },
    { speakerId: 'spk-2', name: 'John Smith', affiliation: 'External' },
    { speakerId: null, name: 'No Speaker' },
  ],
};

describe('render core', () => {
  it('formats millisecond offsets as mm:ss', () => {
    expect(msToTimestamp(0)).toBe('00:00');
    expect(msToTimestamp(65_000)).toBe('01:05');
    expect(msToTimestamp(undefined)).toBe('?');
  });

  it('labels speakers with affiliation and falls back gracefully', () => {
    expect(speakerLabel({ name: 'John Smith', affiliation: 'External' })).toBe(
      'John Smith (External)',
    );
    expect(speakerLabel({ name: 'John Smith', affiliation: 'Unknown' })).toBe('John Smith');
    expect(speakerLabel({ emailAddress: 'john@example.com' })).toBe('john@example.com');
    expect(speakerLabel(undefined)).toBe('Unknown speaker');
  });

  it('indexes parties by callId and speakerId, skipping null speakerIds', () => {
    const { speakerByCall, metaByCall } = buildPartyIndex([EXTENSIVE_CALL]);
    expect(metaByCall.get('123')?.title).toBe('Initech <> Globex — Discovery');
    expect(speakerByCall.get('123')?.get('spk-1')?.name).toBe('Jane Doe');
    expect(speakerByCall.get('123')?.size).toBe(2);
  });

  it('renders a speaker-labeled Markdown transcript', () => {
    const { speakerByCall, metaByCall } = buildPartyIndex([EXTENSIVE_CALL]);
    const md = renderTranscriptMd(TRANSCRIPT, speakerByCall.get('123'), metaByCall.get('123'));
    expect(md).toContain('# Initech <> Globex — Discovery');
    expect(md).toContain('**Call ID:** 123');
    expect(md).toContain('**Duration:** 32:14');
    expect(md).toContain('**Participants:** Jane Doe (Internal), John Smith (External)');
    expect(md).toContain('**Jane Doe (Internal)** [00:04]  _(topic: Call Setup)_');
    expect(md).toContain('Thanks for making the time. Shall we start?');
    expect(md).toContain('**John Smith (External)** [00:11]');
    // Empty monologues are dropped entirely.
    expect(md).not.toContain('[00:13]');
  });

  it('falls back to Speaker <id> without parties', () => {
    const md = renderTranscriptMd(TRANSCRIPT);
    expect(md).toContain('# Untitled call');
    expect(md).toContain('**Speaker spk-1** [00:04]');
  });

  it('builds filesystem-safe filenames', () => {
    expect(safeFilename('123', 'Initech <> Globex — Discovery')).toBe(
      'initech-globex-discovery-123.md',
    );
    expect(safeFilename('123', undefined)).toBe('call-123.md');
    expect(safeFilename('123', '!!!')).toBe('call-123.md');
  });

  it('unwraps cli arrays, raw envelopes, and single records', () => {
    expect(unwrapRecords([{ callId: '1' }], 'callTranscripts')).toEqual([{ callId: '1' }]);
    expect(unwrapRecords({ callTranscripts: [{ callId: '1' }] }, 'callTranscripts')).toEqual([
      { callId: '1' },
    ]);
    expect(unwrapRecords({ callId: '1' }, 'callTranscripts')).toEqual([{ callId: '1' }]);
  });
});

describe('gong calls render', () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeFixtures(): { transcript: string; parties: string; out: string } {
    dir = mkdtempSync(path.join(os.tmpdir(), 'gong-render-'));
    const transcript = path.join(dir, 'transcript.json');
    const parties = path.join(dir, 'parties.json');
    writeFileSync(transcript, JSON.stringify([TRANSCRIPT]));
    writeFileSync(parties, JSON.stringify([EXTENSIVE_CALL]));
    return { transcript, parties, out: path.join(dir, 'out') };
  }

  it('writes one Markdown file per call and prints its path, with no API call', async () => {
    const { transcript, parties, out } = writeFixtures();
    const run = await runCli(
      ['calls', 'render', '--transcript', transcript, '--parties', parties, '--out', out],
      { env: { GONG_ACCESS_KEY: undefined, GONG_ACCESS_KEY_SECRET: undefined } },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests).toHaveLength(0);
    const outPath = path.join(out, 'initech-globex-discovery-123.md');
    expect(run.stdout.trim()).toBe(outPath);
    const md = readFileSync(outPath, 'utf8');
    expect(md).toContain('**Jane Doe (Internal)** [00:04]');
  });

  it('exits 4 when the transcript file has no records', async () => {
    const { transcript, parties, out } = writeFixtures();
    writeFileSync(transcript, '[]');
    const run = await runCli([
      'calls', 'render', '--transcript', transcript, '--parties', parties, '--out', out,
    ]);
    expect(run.exitCode).toBe(4);
    expect(run.stderr).toContain('No transcript records');
  });

  it('exits 2 on unreadable transcript JSON', async () => {
    const { transcript, out } = writeFixtures();
    writeFileSync(transcript, 'not json');
    const run = await runCli(['calls', 'render', '--transcript', transcript, '--out', out]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('Could not read JSON');
  });
});
