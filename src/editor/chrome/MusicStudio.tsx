/**
 * The music machine: shape instruments on an 8-bit or a 16-bit synthesizer and write songs with them.
 *
 * Instruments: a wave, an envelope, pitch moves (a slide, vibrato, an arpeggio) and on the 16-bit chip a filter,
 * FM and echo; tried on a keyboard (the mouse, or the computer's keys). Songs: channels (one instrument each),
 * patterns of notes drawn on a piano roll, and the order the patterns play in; a song can be a level's music, or
 * be played by a script (play_music). Everything is saved with the game, and every change is one Undo step.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CHIPS,
  emptySong,
  FILTER_TYPES,
  INSTRUMENT_PRESETS,
  MAX_CHANNELS,
  MAX_ORDER,
  MAX_PATTERNS,
  noteName,
  preset,
  renderNote,
  STARTER_KITS,
  WAVE_LABELS,
  WAVES_16BIT,
  WAVES_8BIT,
  waveFits,
  type Chip,
  type Instrument,
  type MusicWave,
  type Song,
  type SongNote,
} from '../../core/audio/music';
import { addInstrumentAsset, addSongAsset, musicAssets, removeMusicAsset, renameMusicAsset, setInstrument, setLevelMusic, setSong } from '../../core/model/music';
import type { AssetRecord, Id, Project } from '../../core/types';
import { instrumentsOf, playNote, playSong, type SongPlayer } from '../audio/musicPlayer';
import { useEditor } from '../store';
import { PromptBox } from '../prompt/PromptBox';
import { useCloseOutside } from '../prompt/closeOutside';

export const CHANNEL_COLORS = ['#ff5d73', '#4cc9f0', '#ffd166', '#06d6a0', '#c77dff', '#ff9f1c', '#a3e635', '#f472b6', '#60a5fa', '#fb7185', '#facc15', '#2dd4bf'];

const close = () => useEditor.getState().setMusicStudio(null);

export function MusicStudio() {
  const open = useEditor((s) => s.musicStudio);
  const [asking, setAsking] = useState(false);
  if (!open) return null;
  const tab = open.tab;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dialog music-studio" role="dialog" aria-label="Music machine" data-testid="music-studio">
        <header className="ms-head">
          <span className="ms-title">Music</span>
          <div className="ms-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'songs'} className={`ms-tab${tab === 'songs' ? ' on' : ''}`} data-testid="music-tab-songs" onClick={() => useEditor.getState().setMusicStudio({ tab: 'songs' })}>
              Songs
            </button>
            <button role="tab" aria-selected={tab === 'instruments'} className={`ms-tab${tab === 'instruments' ? ' on' : ''}`} data-testid="music-tab-instruments" onClick={() => useEditor.getState().setMusicStudio({ tab: 'instruments' })}>
              Instruments
            </button>
          </div>
          <button
            className={`icon-btn spark-btn${asking ? ' active' : ''}`}
            title={tab === 'songs' ? 'Ask the AI about this song (or for a new one)' : 'Ask the AI about this instrument (or for a new one)'}
            aria-label="Ask the AI"
            aria-pressed={asking}
            data-testid="music-ai"
            data-prompt-opener
            onClick={() => setAsking(!asking)}
          >
            ✦
          </button>
          <span className="grow" />
          <button className="icon-btn" aria-label="Close" title="Close (Esc)" data-testid="music-close" onClick={close}>
            ×
          </button>
        </header>
        {tab === 'songs' ? <SongsTab /> : <InstrumentsTab />}
        <OpensWhatAIMakes />
        {asking && <MusicPrompt kind={tab === 'songs' ? 'song' : 'instrument'} onClose={() => setAsking(false)} />}
      </section>
    </div>
  );
}

/** The song and the instrument open in the tabs (the chosen one, else the first). */
function openIds(): { song: Id | null; instrument: Id | null } {
  const { project, musicStudio } = useEditor.getState();
  const pick = (kind: 'music' | 'instrument', wanted: Id | null | undefined) => {
    const items = musicAssets(project, kind);
    return (items.find((a) => a.id === wanted) ?? items[0])?.id ?? null;
  };
  return { song: pick('music', musicStudio?.songId), instrument: pick('instrument', musicStudio?.instrumentId) };
}

/** A song or instrument the AI just made opens in its tab (also when its card was closed while it worked). */
function OpensWhatAIMakes() {
  const songs = useEditor((s) => s.project.assets.filter((a) => a.kind === 'music').map((a) => a.id).join(','));
  const instruments = useEditor((s) => s.project.assets.filter((a) => a.kind === 'instrument').map((a) => a.id).join(','));
  const known = useRef({ songs: new Set(songs.split(',')), instruments: new Set(instruments.split(',')) });
  useEffect(() => {
    const fresh = (now: string, seen: Set<string>) => now.split(',').filter(Boolean).find((id) => !seen.has(id));
    const song = fresh(songs, known.current.songs);
    const inst = fresh(instruments, known.current.instruments);
    known.current = { songs: new Set(songs.split(',')), instruments: new Set(instruments.split(',')) };
    const tab = useEditor.getState().musicStudio?.tab;
    if (song && tab === 'songs') useEditor.getState().setMusicStudio({ songId: song });
    if (inst && tab === 'instruments') useEditor.getState().setMusicStudio({ instrumentId: inst });
  }, [songs, instruments]);
  return null;
}

/**
 * The AI prompt card (the ✦ at the top): about the open song or instrument, or a new one when there is none.
 * × or a click outside closes it (a request still running carries on).
 */
function MusicPrompt({ kind, onClose }: { kind: 'song' | 'instrument'; onClose: () => void }) {
  const sceneId = useEditor((s) => s.activeSceneId);
  // (Follows the open song or instrument.)
  useEditor((s) => s.musicStudio);
  useEditor((s) => s.project.assets);
  const ids = openIds();
  const assetId = kind === 'song' ? ids.song : ids.instrument;
  const ref = useRef<HTMLDivElement>(null);
  useCloseOutside(ref, onClose);
  return (
    <div className="ms-ask-card" ref={ref} data-testid="music-prompt-card">
      <PromptBox
        ctx={{ kind, sceneId, assetId }}
        autoFocus
        placeholder={kind === 'song' ? 'Describe a song, a melody, a feel, or just the drum beat: "a spooky castle theme", "make the drums busier"' : 'Describe a sound: "a fat wobbly bass", "a soft flute", "a punchy 8-bit kick"'}
        testId={`music-${kind}-prompt`}
        onEscape={onClose}
        onClose={onClose}
      />
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------------------------
 * The list on the left: pick, rename (double-click), delete.
 */

function AssetList({ kind, items, selected, onSelect, children }: { kind: 'music' | 'instrument'; items: AssetRecord[]; selected: Id | null; onSelect: (id: Id) => void; children: React.ReactNode }) {
  const [renaming, setRenaming] = useState<Id | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Id | null>(null);
  const what = kind === 'music' ? 'song' : 'instrument';
  return (
    <aside className="ms-list" data-testid={`music-list-${what}s`}>
      <div className="ms-items">
        {items.map((a) => (
          <div key={a.id} className={`ms-item${a.id === selected ? ' on' : ''}`} data-testid={`music-item-${a.name}`}>
            {renaming === a.id ? (
              <input
                className="ms-rename"
                autoFocus
                defaultValue={a.name}
                aria-label={`Rename ${what}`}
                data-testid="music-rename-input"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setRenaming(null);
                    setProblem(null);
                  }
                  if (e.key !== 'Enter') return;
                  let err: string | null = null;
                  const name = e.currentTarget.value;
                  useEditor.getState().edit(`Rename ${what} ${a.name}`, (p) => void (err = renameMusicAsset(p, a.id, name)));
                  if (err) setProblem(err);
                  else {
                    setRenaming(null);
                    setProblem(null);
                  }
                }}
                onBlur={() => {
                  setRenaming(null);
                  setProblem(null);
                }}
              />
            ) : (
              <button className="ms-item-name" onClick={() => onSelect(a.id)} onDoubleClick={() => setRenaming(a.id)} title="Double-click to rename">
                {a.name}
              </button>
            )}
            {a.id === selected && renaming !== a.id && (
              <>
                <button className="icon-btn small" aria-label={`Rename ${a.name}`} title="Rename" data-testid="music-rename" onClick={() => setRenaming(a.id)}>
                  ✎
                </button>
                <button className="icon-btn small" aria-label={`Delete ${a.name}`} title="Delete" data-testid="music-delete" onClick={() => setDeleting(a.id)}>
                  🗑
                </button>
              </>
            )}
            {deleting === a.id && (
              <div className="ms-confirm" data-testid="music-delete-confirm">
                Delete “{a.name}”?
                <button className="danger-btn small" data-testid="music-delete-yes" onClick={() => (setDeleting(null), useEditor.getState().edit(`Delete ${what} ${a.name}`, (p) => removeMusicAsset(p, a.id)))}>
                  Delete
                </button>
                <button className="chip-btn small" onClick={() => setDeleting(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}
        {!items.length && <p className="muted small">No {what}s yet.</p>}
      </div>
      {problem && <p className="ms-problem">{problem}</p>}
      <div className="ms-new">{children}</div>
    </aside>
  );
}

/* ----------------------------------------------------------------------------------------------------------------
 * Instruments.
 */

/** Adds an instrument from a preset (one Undo step) and opens it. */
function newInstrument(presetName: string): Id {
  let id = '';
  useEditor.getState().edit(`New instrument ${presetName}`, (p) => void (id = addInstrumentAsset(p, presetName, preset(presetName))));
  useEditor.getState().setMusicStudio({ tab: 'instruments', instrumentId: id });
  return id;
}

function PresetSelect({ label, testId, onPick }: { label: string; testId: string; onPick: (name: string) => void }) {
  return (
    <select className="ms-select" aria-label={label} data-testid={testId} value="" onChange={(e) => e.target.value && onPick(e.target.value)}>
      <option value="">{label}</option>
      {CHIPS.map((chip) => (
        <optgroup key={chip} label={chip === '8bit' ? '8-bit' : '16-bit'}>
          {INSTRUMENT_PRESETS.filter((p) => p.instrument.chip === chip).map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function InstrumentsTab() {
  const project = useEditor((s) => s.project);
  const wanted = useEditor((s) => s.musicStudio?.instrumentId ?? null);
  const items = musicAssets(project, 'instrument');
  const asset = items.find((a) => a.id === wanted) ?? items[0];
  return (
    <div className="ms-body">
      <AssetList kind="instrument" items={items} selected={asset?.id ?? null} onSelect={(id) => useEditor.getState().setMusicStudio({ instrumentId: id })}>
        <PresetSelect label="+ New instrument…" testId="music-new-instrument" onPick={newInstrument} />
      </AssetList>
      <div className="ms-main">
        {asset ? <InstrumentEditor key={asset.id} asset={asset} /> : <p className="ms-empty muted">Make an instrument from one of the ready ones (+ New instrument), or describe the sound you want (✦ at the top), then shape it.</p>}
      </div>
    </div>
  );
}

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  testId: string;
  onChange: (v: number) => void;
  /** Slider moves on a log scale (frequencies). */
  log?: boolean;
}

function Knob({ label, value, min, max, step, unit = '', testId, onChange, log }: KnobProps) {
  const toSlider = (v: number) => (log ? (Math.log(v / min) / Math.log(max / min)) * 1000 : v);
  const fromSlider = (x: number) => (log ? Math.round(min * (max / min) ** (x / 1000)) : x);
  const shown = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 1000) / 1000;
  return (
    <label className="ms-knob">
      <span className="ms-knob-label">{label}</span>
      <input type="range" data-testid={testId} min={log ? 0 : min} max={log ? 1000 : max} step={log ? 1 : step} value={toSlider(value)} onChange={(e) => onChange(fromSlider(Number(e.target.value)))} />
      <span className="ms-knob-value">
        {shown}
        {unit}
      </span>
    </label>
  );
}

function InstrumentEditor({ asset }: { asset: AssetRecord }) {
  const inst = asset.instrument!;
  const change = (patch: Partial<Instrument>, key: string) => {
    const next = { ...inst, ...patch };
    useEditor.getState().edit(`Shape instrument ${asset.name}`, (p) => setInstrument(p, asset.id, next), { coalesceKey: `instrument:${asset.id}:${key}` });
  };
  const knob = (field: keyof Instrument, label: string, min: number, max: number, step: number, unit = '', log = false) => (
    <Knob key={field} label={label} value={inst[field] as number} min={min} max={max} step={step} unit={unit} log={log} testId={`ins-${field}`} onChange={(v) => change({ [field]: v } as Partial<Instrument>, field)} />
  );
  const setChip = (chip: Chip) => {
    if (chip === inst.chip) return;
    const wave: MusicWave = waveFits(chip, inst.wave) ? inst.wave : ({ pulse50: 'square', pulse25: 'square', pulse12: 'square', metal: 'noise', saw: 'pulse25', fm: 'pulse50', pluck: 'pulse25', supersaw: 'pulse50', sine: 'triangle', square: 'pulse50' } as Record<string, MusicWave>)[inst.wave] ?? 'pulse50';
    change({ chip, wave }, 'chip');
  };
  const sixteen = inst.chip === '16bit';
  return (
    <div className="ms-instrument" data-testid="instrument-editor">
      <div className="ms-row">
        <div className="ms-seg" role="group" aria-label="Chip">
          {CHIPS.map((c) => (
            <button key={c} className={`ms-seg-btn${inst.chip === c ? ' on' : ''}`} data-testid={`ins-chip-${c}`} onClick={() => setChip(c)}>
              {c === '8bit' ? '8-bit' : '16-bit'}
            </button>
          ))}
        </div>
        <span className="grow" />
        <PresetSelect
          label="Start over from…"
          testId="ins-load-preset"
          onPick={(name) => useEditor.getState().edit(`Instrument ${asset.name} from ${name}`, (p) => setInstrument(p, asset.id, preset(name)))}
        />
      </div>
      <div className="ms-waves" role="group" aria-label="Wave">
        {(sixteen ? WAVES_16BIT : WAVES_8BIT).map((w) => (
          <button key={w} className={`ms-wave${inst.wave === w ? ' on' : ''}`} data-testid={`ins-wave-${w}`} onClick={() => change({ wave: w }, 'wave')}>
            <WaveIcon wave={w} />
            {WAVE_LABELS[w]}
          </button>
        ))}
      </div>
      <SoundPicture inst={inst} />
      <div className="ms-groups">
        <fieldset className="ms-group">
          <legend>Volume</legend>
          {knob('volume', 'Volume', 0, 1, 0.01)}
          {knob('attack', 'Attack', 0, 2, 0.005, ' s')}
          {knob('decay', 'Decay', 0, 2, 0.01, ' s')}
          {knob('sustain', 'Sustain', 0, 1, 0.01)}
          {knob('release', 'Release', 0, 2, 0.01, ' s')}
        </fieldset>
        <fieldset className="ms-group">
          <legend>Pitch</legend>
          {knob('pitchDrop', 'Slide from', -36, 36, 1, ' st')}
          {knob('pitchTime', 'Slide time', 0, 1, 0.005, ' s')}
          {knob('vibratoRate', 'Vibrato', 0, 16, 0.5, ' /s')}
          {knob('vibratoDepth', 'Depth', 0, 2, 0.05, ' st')}
          {knob('vibratoDelay', 'Delay', 0, 1, 0.05, ' s')}
          <label className="ms-knob">
            <span className="ms-knob-label">Arpeggio</span>
            <input
              className="ms-arp"
              data-testid="ins-arp"
              placeholder="e.g. 0 4 7"
              defaultValue={inst.arp.join(' ')}
              key={inst.arp.join(' ')}
              onBlur={(e) => {
                const arp = e.target.value
                  .split(/[\s,]+/)
                  .filter(Boolean)
                  .map(Number)
                  .filter((n) => Number.isInteger(n) && Math.abs(n) <= 24)
                  .slice(0, 8);
                change({ arp }, 'arp');
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
          {inst.arp.length > 0 && knob('arpSpeed', 'Arp speed', 1, 60, 1, ' /s')}
        </fieldset>
        {sixteen && (
          <fieldset className="ms-group">
            <legend>Filter</legend>
            <label className="ms-knob">
              <span className="ms-knob-label">Type</span>
              <select className="ms-select" data-testid="ins-filter" value={inst.filter ?? ''} onChange={(e) => change({ filter: (e.target.value || null) as Instrument['filter'] }, 'filter')}>
                <option value="">None</option>
                {FILTER_TYPES.map((f) => (
                  <option key={f} value={f}>
                    {f === 'lowpass' ? 'Low-pass (darker)' : f === 'highpass' ? 'High-pass (thinner)' : 'Band-pass (nasal)'}
                  </option>
                ))}
              </select>
            </label>
            {inst.filter && (
              <>
                {knob('cutoff', 'Cutoff', 40, 16000, 1, ' Hz', true)}
                {knob('resonance', 'Resonance', 0, 0.95, 0.01)}
                {knob('filterEnv', 'Sweep', 0, 1, 0.01)}
              </>
            )}
          </fieldset>
        )}
        {sixteen && (inst.wave === 'fm' || inst.wave === 'supersaw') && (
          <fieldset className="ms-group">
            <legend>{inst.wave === 'fm' ? 'FM' : 'Supersaw'}</legend>
            {inst.wave === 'fm' ? (
              <>
                {knob('fmRatio', 'Ratio', 0.25, 16, 0.25)}
                {knob('fmIndex', 'Brightness', 0, 20, 0.1)}
              </>
            ) : (
              knob('detune', 'Detune', 0, 50, 1, ' ct')
            )}
          </fieldset>
        )}
        {sixteen && (
          <fieldset className="ms-group">
            <legend>Echo</legend>
            {knob('echoTime', 'Time', 0, 1, 0.01, ' s')}
            {inst.echoTime > 0 && (
              <>
                {knob('echoFeedback', 'Repeats', 0, 0.9, 0.01)}
                {knob('echoMix', 'Mix', 0, 1, 0.01)}
              </>
            )}
          </fieldset>
        )}
      </div>
      <Keyboard inst={inst} />
    </div>
  );
}

function WaveIcon({ wave }: { wave: MusicWave }) {
  const paths: Record<string, string> = {
    pulse50: 'M1 9V3h6v6h6V3h6',
    square: 'M1 9V3h6v6h6V3h6',
    pulse25: 'M1 9V3h3v6h7V3h3v6h5',
    pulse12: 'M1 9V3h2v6h8V3h2v6h6',
    triangle: 'M1 9 5.5 3 10 9l4.5-6L19 9',
    saw: 'M1 9 10 3v6l9-6v6',
    sine: 'M1 6c2-5 4-5 5 0s3 5 5 0 3-5 5 0 2 3 3 2',
    fm: 'M1 6c1-5 2 4 3 0s2 5 3 0 2-6 3 0 2 5 3 0 2-5 3 0 2 2 3 1',
    pluck: 'M1 6c1-6 2 6 3 0s2 4 3 0 2-3 3 0 2 2 3 0 2-1 3 0 2 0 3 0',
    supersaw: 'M1 9 8 3v6l7-6v6l4-3M3 9l7-6',
    noise: 'M1 6l1-3 1 5 1-6 1 7 1-4 1 2 1-5 1 6 1-3 1 2 1-4 1 5 1-6 1 4 1-2 1 1',
    metal: 'M1 6l2-3 2 6 2-6 2 6 2-6 2 6 2-6 2 6 1-3',
  };
  return (
    <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true">
      <path d={paths[wave]} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

/** The instrument's sound drawn: a middle C held for half a second and let go (how loud, over time). */
function SoundPicture({ inst }: { inst: Instrument }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const samples = useMemo(() => renderNote(inst, 60, 0.5, 12000), [inst]);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const seconds = samples.length / 12000;
    const per = Math.max(1, Math.floor(samples.length / w));
    // Drawn as tall as it fits (how loud it is shows in the volume slider).
    let peak = 0.0001;
    for (const v of samples) peak = Math.max(peak, Math.abs(v));
    ctx.fillStyle = inst.chip === '8bit' ? '#4cc9f0' : '#c77dff';
    for (let x = 0; x < w; x++) {
      let lo = 0;
      let hi = 0;
      for (let i = x * per; i < Math.min(samples.length, (x + 1) * per); i++) {
        lo = Math.min(lo, samples[i]);
        hi = Math.max(hi, samples[i]);
      }
      const y0 = h / 2 - (hi / peak) * (h / 2 - 2);
      const y1 = h / 2 - (lo / peak) * (h / 2 - 2);
      ctx.fillRect(x, Math.max(0, y0), 1, Math.max(1, Math.min(h, y1) - Math.max(0, y0)));
    }
    // Where the key is let go.
    const off = (0.5 / seconds) * w;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(Math.round(off), 0, 1, h);
  }, [samples]);
  return <canvas ref={ref} className="ms-picture" width={560} height={64} data-testid="ins-picture" aria-label="The sound over time" />;
}

/**
 * The computer keys of the keyboard, by where they are (not what they type, so any layout works, Icelandic too):
 * the bottom letter row is the lower octave (black keys on the row above it), the top letter row the upper one
 * (black keys on the number row), like a tracker's.
 */
const KEY_NOTES: Record<string, number> = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
  KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, Equal: 30, BracketRight: 31,
};
/** The keys the keyboard shows (two and a half octaves, as far as the computer keys reach). */
const SHOWN_KEYS = 31;
/** What the keys print on a US keyboard (until the browser says what they print on this one). */
const US_KEYS: Record<string, string> = { Comma: ',', Period: '.', Semicolon: ';', Slash: '/', BracketLeft: '[', BracketRight: ']', Equal: '=' };
const usLabel = (code: string) => US_KEYS[code] ?? code.replace(/^(Key|Digit)/, '');
const BLACK = new Set([1, 3, 6, 8, 10]);

/** What each key prints on this computer's keyboard (Chrome and Edge know it; elsewhere the US letters). */
function useKeyLabels(): (code: string) => string {
  const [map, setMap] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
    kb?.getLayoutMap?.()
      .then((m) => setMap(new Map(m)))
      .catch(() => undefined);
  }, []);
  return (code) => (map?.get(code) ?? usLabel(code)).toUpperCase();
}

/** Notes being played by hand (computer keys, the mouse on a keyboard), with the octave the computer keys play in. */
export interface NotePlayer {
  octave: number;
  setOctave: (o: number | ((o: number) => number)) => void;
  /** Pitches sounding now. */
  down: Set<number>;
  /** Starts a note for a key (a computer key's code, or a name for the mouse); a key already held does nothing. */
  press: (key: string, pitch: number) => void;
  /** Lets go of the note a key started (the one it started, even if the octave changed since): it fades as the instrument's release says. */
  letGo: (key: string) => void;
}

/**
 * Plays an instrument by hand: the computer keys by where they are (any layout), ← → for the octave, and press /
 * letGo for the mouse. `instrument` is asked at each note, so it follows the instrument (or channel) chosen now.
 */
function useNotePlayer(instrument: () => Instrument | null): NotePlayer {
  const [octave, setOctave] = useState(4);
  const [down, setDown] = useState<Set<number>>(new Set());
  const held = useRef(new Map<string, { note: { release(): void } | null; pitch: number }>());
  const get = useRef(instrument);
  get.current = instrument;
  const press = (key: string, pitch: number) => {
    if (held.current.has(key)) return;
    const inst = get.current();
    held.current.set(key, { note: inst ? playNote(inst, pitch, 4) : null, pitch });
    setDown((d) => new Set(d).add(pitch));
  };
  const letGo = (key: string) => {
    const h = held.current.get(key);
    if (!h) return;
    h.note?.release();
    held.current.delete(key);
    setDown(new Set([...held.current.values()].map((x) => x.pitch)));
  };
  const base = (octave + 1) * 12;
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !['range', 'checkbox'].includes((t as HTMLInputElement).type))) return;
      if (e.code in KEY_NOTES) {
        e.preventDefault();
        if (!e.repeat) press(e.code, base + KEY_NOTES[e.code]);
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        setOctave((o) => Math.max(1, Math.min(7, o + (e.code === 'ArrowLeft' ? -1 : 1))));
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code in KEY_NOTES) letGo(e.code);
    };
    // Switching to another window with a key held: it is let go.
    const onBlur = () => [...held.current.keys()].forEach(letGo);
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [base]);
  // Closing (or switching tabs) lets go of everything.
  useEffect(() => () => [...held.current.keys()].forEach(letGo), []);
  return { octave, setOctave, down, press, letGo };
}

function OctaveControl({ player, testId }: { player: NotePlayer; testId: string }) {
  return (
    <span className="ms-octave">
      <button className="icon-btn small" aria-label="Octave down" data-testid={`${testId}-octave-down`} onClick={() => player.setOctave((o) => Math.max(1, o - 1))}>
        ◀
      </button>
      <span data-testid={`${testId}-octave`}>Octave {player.octave}</span>
      <button className="icon-btn small" aria-label="Octave up" data-testid={`${testId}-octave-up`} onClick={() => player.setOctave((o) => Math.min(7, o + 1))}>
        ▶
      </button>
    </span>
  );
}

function Keyboard({ inst }: { inst: Instrument }) {
  const player = useNotePlayer(() => inst);
  const { down, press, letGo } = player;
  const label = useKeyLabels();
  const base = (player.octave + 1) * 12;
  const whites = [];
  const blacks = [];
  let wi = 0;
  for (let i = 0; i <= SHOWN_KEYS; i++) {
    const pitch = base + i;
    const black = BLACK.has(i % 12);
    const keys = Object.keys(KEY_NOTES).filter((c) => KEY_NOTES[c] === i);
    const keyText = <span className="ms-key-letters">{keys.map(label).join('\n')}</span>;
    const props = {
      'data-testid': `key-${noteName(pitch)}`,
      title: `${noteName(pitch)}${keys.length ? ` (${keys.map(label).join(' or ')})` : ''}`,
      className: `ms-key${black ? ' black' : ''}${down.has(pitch) ? ' down' : ''}`,
      onPointerDown: (e: React.PointerEvent) => {
        // (A touch holds on to the key it started on: let go of it, so sliding a finger along plays other keys.)
        const el = e.currentTarget as HTMLElement;
        if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
        press(`pointer${e.pointerId}`, pitch);
      },
      // Sliding along with the button held: the key left fades out, the key reached plays.
      onPointerEnter: (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse' ? !(e.buttons & 1) : e.pressure === 0) return;
        letGo(`pointer${e.pointerId}`);
        press(`pointer${e.pointerId}`, pitch);
      },
      onPointerLeave: (e: React.PointerEvent) => letGo(`pointer${e.pointerId}`),
      onPointerUp: (e: React.PointerEvent) => letGo(`pointer${e.pointerId}`),
      onPointerCancel: (e: React.PointerEvent) => letGo(`pointer${e.pointerId}`),
    };
    if (black)
      blacks.push(
        <button key={pitch} {...props} style={{ left: `calc(${wi} * var(--wkey) - var(--bkey) / 2)` }}>
          {keyText}
        </button>,
      );
    else {
      whites.push(
        <button key={pitch} {...props}>
          {keyText}
          {i % 12 === 0 ? <span>{noteName(pitch)}</span> : null}
        </button>,
      );
      wi++;
    }
  }
  return (
    <div className="ms-keyboard-wrap">
      <OctaveControl player={player} testId="ins" />
      <div className="ms-keyboard" data-testid="ins-keyboard">
        {whites}
        {blacks}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------------------------
 * Songs.
 */

/** A new song with a starter kit of the chip's instruments (made, or reused when the game has them). */
function newSong(chip: Chip): void {
  let id = '';
  useEditor.getState().edit(`New ${chip === '8bit' ? '8-bit' : '16-bit'} song`, (p) => {
    const kit = [...STARTER_KITS[chip].instruments.map((name) => ({ name, drum: false })), ...STARTER_KITS[chip].drums.map((name) => ({ name, drum: true }))].map(({ name, drum }) => {
      const have = p.assets.find((a) => a.kind === 'instrument' && a.name === name && a.instrument?.chip === chip);
      return { id: have ? have.id : addInstrumentAsset(p, name, preset(name)), name, drum };
    });
    id = addSongAsset(p, 'Song', emptySong(kit, chip === '8bit' ? 140 : 120));
  });
  useEditor.getState().setMusicStudio({ tab: 'songs', songId: id });
}

function SongsTab() {
  const project = useEditor((s) => s.project);
  const wanted = useEditor((s) => s.musicStudio?.songId ?? null);
  const items = musicAssets(project, 'music');
  const asset = items.find((a) => a.id === wanted) ?? items[0];
  return (
    <div className="ms-body">
      <AssetList kind="music" items={items} selected={asset?.id ?? null} onSelect={(id) => useEditor.getState().setMusicStudio({ songId: id })}>
        <button className="chip-btn small" data-testid="music-new-song-8bit" onClick={() => newSong('8bit')}>
          + 8-bit song
        </button>
        <button className="chip-btn small" data-testid="music-new-song-16bit" onClick={() => newSong('16bit')}>
          + 16-bit song
        </button>
      </AssetList>
      <div className="ms-main">
        {asset ? <SongEditor key={asset.id} asset={asset} project={project} /> : <p className="ms-empty muted">Start a song: + 8-bit song (NES, Game Boy) or + 16-bit song (SNES, Mega Drive). Each comes with three instruments (a lead, a second voice and a bass) and three drums (kick, snare, hi-hat). Or describe the song you want (✦ at the top).</p>}
      </div>
    </div>
  );
}

const ROW_H = 12;
const MIN_COL_W = 22;
const KEYS_W = 38;
const LOW = 24;
const HIGH = 96;
const ROWS = HIGH - LOW + 1;
const patternName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `P${i + 1}`);

function SongEditor({ asset, project }: { asset: AssetRecord; project: Project }) {
  const song = asset.song!;
  const instruments = useMemo(() => instrumentsOf(project), [project.assets]);
  const instrumentList = musicAssets(project, 'instrument');
  const scene = useEditor((s) => s.project.scenes.find((x) => x.id === s.activeSceneId)!);
  const [pattern, setPattern] = useState(Math.min(song.order[0] ?? 0, song.patterns.length - 1));
  const [slot, setSlot] = useState(0);
  const [channel, setChannel] = useState(0);
  const [pen, setPen] = useState(1);
  const [playing, setPlaying] = useState<'song' | 'pattern' | null>(null);
  const [pos, setPos] = useState<{ order: number; step: number } | null>(null);
  const player = useRef<SongPlayer | null>(null);
  const p = Math.min(pattern, song.patterns.length - 1);
  const ch = Math.min(channel, song.channels.length - 1);
  // The computer keys (and the roll's keys) play the chosen channel's instrument.
  const hand = useNotePlayer(() => instruments(song.channels[ch]?.instrument ?? null));
  const handName = instrumentList.find((a) => a.id === song.channels[ch]?.instrument)?.name ?? null;

  const change = (label: string, recipe: (s: Song) => void, key?: string) => {
    const next = structuredClone(song);
    recipe(next);
    useEditor.getState().edit(`${label} (${asset.name})`, (d) => setSong(d, asset.id, next), key ? { coalesceKey: `song:${asset.id}:${key}` } : undefined);
  };

  // Edits are heard while it plays.
  useEffect(() => player.current?.update(song, instruments), [song, instruments]);
  useEffect(() => () => player.current?.stop(), []);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const pl = player.current;
      if (pl?.done) {
        setPlaying(null);
        setPos(null);
        return;
      }
      // (Only when the step changes: the editor isn't drawn again every frame while it plays.)
      const now = pl?.position() ?? null;
      setPos((was) => (was?.order === now?.order && was?.step === now?.step ? was : now));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const stop = () => {
    player.current?.stop();
    player.current = null;
    setPlaying(null);
    setPos(null);
  };
  const play = (mode: 'song' | 'pattern') => {
    player.current?.stop();
    player.current = playSong(song, instruments, mode === 'song' ? { from: slot } : { only: p });
    setPlaying(player.current ? mode : null);
  };

  // Space starts and stops the song (from the chosen place in the order), wherever the focus is but in a text box.
  const toggle = useRef<() => void>(() => undefined);
  toggle.current = () => (playing ? stop() : play('song'));
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !['range', 'checkbox'].includes(t.type));
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      // (Not also a click on the focused button, nor a scroll.)
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'keydown' && !e.repeat) toggle.current();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, []);

  /** One channel's row: its instrument, volume, mute, ✎ shape, × remove. */
  const channelRow = (c: Song['channels'][number], i: number) => (
            <div key={i} className={`ms-channel${i === ch ? ' on' : ''}${c.mute ? ' muted' : ''}`} data-testid={`music-channel-${i}`} onClick={() => setChannel(i)}>
              <span className="ms-dot" style={{ background: CHANNEL_COLORS[i] }} />
              <select
                className="ms-select"
                aria-label={`Channel ${i + 1} instrument`}
                data-testid="music-channel-instrument"
                value={c.instrument ?? ''}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith('+')) {
                    let id = '';
                    const name = v.slice(1);
                    useEditor.getState().edit(`New instrument ${name}`, (d) => {
                      id = addInstrumentAsset(d, name, preset(name));
                      const s = structuredClone(song);
                      s.channels[i].instrument = id;
                      s.channels[i].name = d.assets.find((a) => a.id === id)!.name;
                      setSong(d, asset.id, s);
                    });
                  } else
                    change('Channel instrument', (s) => {
                      s.channels[i].instrument = v || null;
                      s.channels[i].name = instrumentList.find((a) => a.id === v)?.name ?? '';
                    });
                }}
              >
                <option value="">(silent)</option>
                {instrumentList.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <optgroup label="New instrument">
                  {INSTRUMENT_PRESETS.map((pr) => (
                    <option key={pr.name} value={`+${pr.name}`}>
                      + {pr.name} ({pr.instrument.chip === '8bit' ? '8-bit' : '16-bit'})
                    </option>
                  ))}
                </optgroup>
              </select>
              <input
                type="range"
                className="ms-vol"
                min={0}
                max={1}
                step={0.01}
                value={c.volume}
                aria-label={`Channel ${i + 1} volume`}
                data-testid="music-channel-volume"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => change('Channel volume', (s) => void (s.channels[i].volume = Number(e.target.value)), `vol${i}`)}
              />
              <button
                className={`icon-btn small${c.mute ? ' on' : ''}`}
                title={c.mute ? 'Unmute' : 'Mute'}
                aria-label={`Mute channel ${i + 1}`}
                data-testid="music-channel-mute"
                onClick={(e) => (e.stopPropagation(), change(c.mute ? 'Unmute channel' : 'Mute channel', (s) => void (s.channels[i].mute = !c.mute)))}
              >
                M
              </button>
              {c.instrument && (
                <button
                  className="icon-btn small"
                  title="Shape this instrument"
                  aria-label={`Shape channel ${i + 1} instrument`}
                  data-testid="music-channel-shape"
                  onClick={(e) => (e.stopPropagation(), useEditor.getState().setMusicStudio({ tab: 'instruments', instrumentId: c.instrument }))}
                >
                  ✎
                </button>
              )}
              <button
                className="icon-btn small"
                title="Remove this channel (and its notes)"
                aria-label={`Remove channel ${i + 1}`}
                data-testid="music-channel-remove"
                disabled={song.channels.length <= 1}
                onClick={(e) => {
                  e.stopPropagation();
                  change('Remove channel', (s) => {
                    s.channels.splice(i, 1);
                    for (const pt of s.patterns) pt.notes = pt.notes.filter((n) => n[0] !== i).map((n) => (n[0] > i ? [n[0] - 1, n[1], n[2], n[3], n[4]] : n) as SongNote);
                  });
                  setChannel(Math.max(0, i - 1));
                }}
              >
                ×
              </button>
            </div>
  );

  /** A new channel, in the instruments or with the drums (its instrument: the group's last one). */
  const addChannel = (drum: boolean) => {
    const same = song.channels.filter((c) => c.drum === drum && c.instrument);
    const guess = drum ? instrumentList.find((a) => /kick|snare|hat|drum|cymbal|clap|tom/i.test(a.name)) : instrumentList.find((a) => !/kick|snare|hat|drum|cymbal|clap|tom/i.test(a.name));
    const id = same.at(-1)?.instrument ?? guess?.id ?? null;
    change(drum ? 'Add drum channel' : 'Add channel', (s) => void s.channels.push({ name: instrumentList.find((a) => a.id === id)?.name ?? '', instrument: id, volume: 0.8, pan: 0, mute: false, drum }));
    setChannel(song.channels.length);
  };

  const notes = song.patterns[p].notes;
  const isLevelMusic = scene.music === asset.id;
  // The playhead, when what plays is the pattern on screen.
  const headStep = pos && (playing === 'pattern' || song.order[pos.order] === p) ? pos.step : null;

  return (
    <div className="ms-song" data-testid="song-editor">
      <div className="ms-row ms-transport">
        {playing ? (
          <button className="chip-btn" data-testid="music-stop" onClick={stop} title="Stop (Space)">
            ■ Stop
          </button>
        ) : (
          <>
            <button className="chip-btn primary" data-testid="music-play" onClick={() => play('song')} title="Play the song from the chosen place in the order (Space)">
              ▶ Song
            </button>
            <button className="chip-btn" data-testid="music-play-pattern" onClick={() => play('pattern')} title="Play this pattern over and over">
              ▶ Pattern
            </button>
          </>
        )}
        <label className="ms-field">
          BPM
          <input
            type="number"
            min={40}
            max={300}
            data-testid="music-bpm"
            value={song.bpm}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 40 && v <= 300) change('Tempo', (s) => void (s.bpm = v), 'bpm');
            }}
          />
        </label>
        <label className="ms-field">
          Steps
          <select
            data-testid="music-steps"
            value={song.steps}
            onChange={(e) => {
              const v = Number(e.target.value);
              change('Pattern length', (s) => {
                s.steps = v;
                for (const pt of s.patterns) pt.notes = pt.notes.filter((n) => n[1] < v);
              });
            }}
          >
            {[8, 12, 16, 24, 32, 48, 64].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="ms-check">
          <input type="checkbox" data-testid="music-loop" checked={song.loop} onChange={(e) => change(e.target.checked ? 'Loop' : 'Play once', (s) => void (s.loop = e.target.checked))} />
          Loop
        </label>
        <span className="grow" />
        <label className="ms-check" title="Plays while this level is played">
          <input
            type="checkbox"
            data-testid="music-level"
            checked={isLevelMusic}
            onChange={(e) => useEditor.getState().edit(e.target.checked ? `Music for ${scene.name}: ${asset.name}` : `No music for ${scene.name}`, (d) => setLevelMusic(d, scene.id, e.target.checked ? asset.id : null))}
          />
          Music of level “{scene.name}”
        </label>
      </div>

      <div className="ms-row ms-arrange" aria-label="Order">
        <span className="ms-row-label">Order</span>
        <div className="ms-order" data-testid="music-order">
          {song.order.map((pi, i) => (
            <button
              key={i}
              className={`ms-chip${i === slot ? ' on' : ''}${pos && playing === 'song' && pos.order === i ? ' now' : ''}`}
              data-testid={`music-order-${i}`}
              onClick={() => {
                setSlot(i);
                setPattern(pi);
              }}
            >
              {song.patterns[pi]?.name || patternName(pi)}
            </button>
          ))}
        </div>
        <button className="icon-btn small" title="Play this pattern next (after the chosen place)" aria-label="Add to the order" data-testid="music-order-add" disabled={song.order.length >= MAX_ORDER} onClick={() => (change('Add to the order', (s) => void s.order.splice(slot + 1, 0, p)), setSlot(slot + 1))}>
          +
        </button>
        <button className="icon-btn small" title="Take the chosen place out of the order" aria-label="Remove from the order" data-testid="music-order-remove" disabled={song.order.length <= 1} onClick={() => (change('Remove from the order', (s) => void s.order.splice(slot, 1)), setSlot(Math.max(0, slot - 1)))}>
          −
        </button>
        <button className="icon-btn small" aria-label="Move earlier" data-testid="music-order-left" disabled={slot === 0} onClick={() => (change('Move in the order', (s) => void s.order.splice(slot - 1, 2, s.order[slot], s.order[slot - 1])), setSlot(slot - 1))}>
          ◀
        </button>
        <button className="icon-btn small" aria-label="Move later" data-testid="music-order-right" disabled={slot >= song.order.length - 1} onClick={() => (change('Move in the order', (s) => void s.order.splice(slot, 2, s.order[slot + 1], s.order[slot])), setSlot(slot + 1))}>
          ▶
        </button>
      </div>

      <div className="ms-row" aria-label="Patterns">
        <span className="ms-row-label">Pattern</span>
        <div className="ms-patterns">
          {song.patterns.map((pt, i) => (
            <button key={i} className={`ms-chip${i === p ? ' on' : ''}`} data-testid={`music-pattern-${i}`} onClick={() => setPattern(i)}>
              {pt.name || patternName(i)}
            </button>
          ))}
        </div>
        <button
          className="chip-btn small"
          data-testid="music-pattern-new"
          disabled={song.patterns.length >= MAX_PATTERNS}
          onClick={() => {
            const i = song.patterns.length;
            change('New pattern', (s) => void s.patterns.push({ name: patternName(i), notes: [] }));
            setPattern(i);
          }}
        >
          + New
        </button>
        <button
          className="chip-btn small"
          data-testid="music-pattern-copy"
          disabled={song.patterns.length >= MAX_PATTERNS}
          onClick={() => {
            const i = song.patterns.length;
            change('Copy pattern', (s) => void s.patterns.push({ name: patternName(i), notes: structuredClone(s.patterns[p].notes) }));
            setPattern(i);
          }}
        >
          Copy
        </button>
        <button className="chip-btn small" data-testid="music-pattern-clear" disabled={!notes.length} onClick={() => change('Clear pattern', (s) => void (s.patterns[p].notes = []))}>
          Clear
        </button>
        <button
          className="chip-btn small"
          data-testid="music-pattern-delete"
          disabled={song.patterns.length <= 1}
          onClick={() => {
            change('Delete pattern', (s) => {
              s.patterns.splice(p, 1);
              s.order = s.order.filter((i) => i !== p).map((i) => (i > p ? i - 1 : i));
              if (!s.order.length) s.order = [0];
            });
            setPattern(Math.max(0, p - 1));
            setSlot(0);
          }}
        >
          Delete
        </button>
      </div>

      <div className="ms-editor">
        <div className="ms-channels" aria-label="Channels">
          {song.channels.map((c, i) => (c.drum ? null : channelRow(c, i)))}
          <button
            className="chip-btn small"
            data-testid="music-channel-add"
            disabled={song.channels.length >= MAX_CHANNELS}
            onClick={() => addChannel(false)}
          >
            + Channel
          </button>
          <div className="ms-drum-sep" role="separator">
            <span>Drums</span>
          </div>
          {song.channels.map((c, i) => (c.drum ? channelRow(c, i) : null))}
          <button className="chip-btn small" data-testid="music-drum-add" disabled={song.channels.length >= MAX_CHANNELS} onClick={() => addChannel(true)}>
            + Drum channel
          </button>
                    <label className="ms-field">
            Note length
            <select data-testid="music-pen" value={pen} onChange={(e) => setPen(Number(e.target.value))}>
              {[1, 2, 3, 4, 6, 8, 12, 16].map((n) => (
                <option key={n} value={n}>
                  {n} step{n > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="ms-hand" data-testid="music-hand">
            <span className="muted small">{handName ? `Your keys play ${handName}` : 'This channel is silent'}</span>
            <OctaveControl player={hand} testId="song" />
          </div>
        </div>
        <PianoRoll
          song={song}
          pattern={p}
          channel={ch}
          pen={pen}
          head={headStep}
          instrument={instruments(song.channels[ch]?.instrument ?? null)}
          hand={hand}
          onNotes={(next) => change('Notes', (s) => void (s.patterns[p].notes = next))}
        />
      </div>
    </div>
  );
}

function PianoRoll({ song, pattern, channel, pen, head, instrument, hand, onNotes }: { song: Song; pattern: number; channel: number; pen: number; head: number | null; instrument: Instrument | null; hand: NotePlayer; onNotes: (notes: SongNote[]) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const notes = song.patterns[pattern].notes;
  // A note being drawn (dragged longer) before it is kept.
  const [draft, setDraft] = useState<SongNote | null>(null);
  // The roll's key held with the mouse (sliding up and down plays the keys passed over).
  const keyHeld = useRef<number | null>(null);
  // A note being made longer or shorter by one of its ends: which note, which end, and how it is now.
  const [resizing, setResizing] = useState<{ index: number; edge: 'start' | 'end'; note: SongNote } | null>(null);
  // Columns as wide as the space allows (at least COL_W).
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const COL_W = Math.max(MIN_COL_W, Math.floor((room - KEYS_W) / song.steps));
  const width = KEYS_W + song.steps * COL_W;
  const height = ROWS * ROW_H;
  const yOf = (pitch: number) => (HIGH - pitch) * ROW_H;

  // Opens around the chosen channel's notes (or middle C).
  useEffect(() => {
    const mine = notes.filter((n) => n[0] === channel);
    const mid = mine.length ? mine.reduce((s, n) => s + n[2], 0) / mine.length : 60;
    const el = scroller.current;
    if (el) el.scrollTop = Math.max(0, yOf(mid) - el.clientHeight / 2);
  }, [channel, pattern]);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, width, height);
    for (let pitch = LOW; pitch <= HIGH; pitch++) {
      const y = yOf(pitch);
      const black = BLACK.has(pitch % 12);
      ctx.fillStyle = black ? '#1b1e27' : '#232733';
      ctx.fillRect(KEYS_W, y, width - KEYS_W, ROW_H);
      ctx.fillStyle = hand.down.has(pitch) ? '#9d91ff' : black ? '#2a2d36' : '#d9dce3';
      ctx.fillRect(0, y, KEYS_W - 2, ROW_H - 1);
      if (pitch % 12 === 0) {
        ctx.fillStyle = '#5a6070';
        ctx.fillRect(KEYS_W, y + ROW_H - 1, width - KEYS_W, 1);
        ctx.fillStyle = '#20232c';
        ctx.font = '9px system-ui, sans-serif';
        ctx.fillText(noteName(pitch), 3, y + ROW_H - 3);
      }
    }
    for (let s = 0; s <= song.steps; s++) {
      ctx.fillStyle = s % 16 === 0 ? '#7a8090' : s % 4 === 0 ? '#4a5060' : '#30343f';
      ctx.fillRect(KEYS_W + s * COL_W, 0, 1, height);
    }
    const shown = resizing ? notes.map((n, i) => (i === resizing.index ? resizing.note : n)) : notes;
    const all = draft ? [...shown, draft] : shown;
    for (const mineFirst of [false, true]) {
      for (const n of all) {
        const mine = n[0] === channel;
        if (mine !== mineFirst) continue;
        const x = KEYS_W + n[1] * COL_W + 1;
        const w = Math.min(n[3], song.steps - n[1]) * COL_W - 2;
        ctx.globalAlpha = mine ? 0.6 + 0.4 * n[4] : 0.28;
        ctx.fillStyle = CHANNEL_COLORS[n[0]] ?? '#fff';
        ctx.fillRect(x, yOf(n[2]) + 1, w, ROW_H - 2);
        if (mine) {
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(x + w - 3, yOf(n[2]) + 1, 3, ROW_H - 2);
        }
      }
    }
    ctx.globalAlpha = 1;
    if (head !== null) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(KEYS_W + head * COL_W, 0, COL_W, height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(KEYS_W + head * COL_W, 0, 2, height);
    }
  }, [notes, draft, resizing, channel, head, song.steps, width, height, COL_W, hand.down]);

  const cellAt = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) * width) / r.width;
    const y = ((e.clientY - r.top) * height) / r.height;
    return { x, step: Math.floor((x - KEYS_W) / COL_W), pitch: HIGH - Math.floor(y / ROW_H) };
  };
  /** The end of one of the chosen channel's notes under the pointer (within a few pixels of it), if any. */
  const edgeAt = (x: number, pitch: number): { index: number; edge: 'start' | 'end' } | null => {
    const grab = Math.max(4, Math.min(8, COL_W / 4));
    let best: { index: number; edge: 'start' | 'end' } | null = null;
    let nearest = grab;
    for (const [index, n] of notes.entries()) {
      if (n[0] !== channel || n[2] !== pitch) continue;
      const left = KEYS_W + n[1] * COL_W;
      const right = KEYS_W + Math.min(n[1] + n[3], song.steps) * COL_W;
      for (const [edge, at] of [['start', left], ['end', right]] as const) {
        const d = Math.abs(x - at);
        if (d <= nearest) {
          nearest = d;
          best = { index, edge };
        }
      }
    }
    return best;
  };

  return (
    <div className="ms-roll" ref={scroller}>
      <canvas
        ref={ref}
        width={width}
        height={height}
        style={{ width, height }}
        data-testid="music-roll"
        data-notes={notes.length}
        data-playing-keys={[...hand.down].sort((a, b) => a - b).join(',')}
        data-note-steps={notes.reduce((n, x) => n + x[3], 0)}
        aria-label="Piano roll"
        onPointerDown={(e) => {
          const { x, step, pitch } = cellAt(e);
          if (pitch < LOW || pitch > HIGH) return;
          if (x < KEYS_W) {
            e.currentTarget.setPointerCapture(e.pointerId);
            keyHeld.current = pitch;
            hand.press('roll', pitch);
            return;
          }
          // By one of its ends: made longer or shorter.
          const edge = edgeAt(x, pitch);
          if (edge) {
            e.currentTarget.setPointerCapture(e.pointerId);
            setResizing({ ...edge, note: [...notes[edge.index]] as SongNote });
            return;
          }
          if (step < 0 || step >= song.steps) return;
          const hit = notes.findIndex((n) => n[0] === channel && n[2] === pitch && step >= n[1] && step < n[1] + n[3]);
          if (hit >= 0) {
            onNotes(notes.filter((_, i) => i !== hit));
            return;
          }
          e.currentTarget.setPointerCapture(e.pointerId);
          setDraft([channel, step, pitch, Math.min(pen, song.steps - step), 0.8]);
          if (instrument) playNote(instrument, pitch, 0.25);
        }}
        onPointerMove={(e) => {
          if (keyHeld.current !== null) {
            const { pitch } = cellAt(e);
            if (pitch === keyHeld.current || pitch < LOW || pitch > HIGH) return;
            // Slid onto another key: the one left fades out, this one plays.
            keyHeld.current = pitch;
            hand.letGo('roll');
            hand.press('roll', pitch);
            return;
          }
          if (resizing) {
            const { x } = cellAt(e);
            const at = Math.round((x - KEYS_W) / COL_W);
            const [c, start, p, len, v] = notes[resizing.index];
            const end = start + len;
            const note: SongNote = resizing.edge === 'end' ? [c, start, p, Math.max(start + 1, Math.min(song.steps, at)) - start, v] : [c, Math.max(0, Math.min(end - 1, at)), p, end - Math.max(0, Math.min(end - 1, at)), v];
            if (note[1] !== resizing.note[1] || note[3] !== resizing.note[3]) setResizing({ ...resizing, note });
            return;
          }
          if (!draft) {
            // Over a note's end: the cursor says it can be dragged.
            const { x, pitch } = cellAt(e);
            e.currentTarget.style.cursor = x >= KEYS_W && edgeAt(x, pitch) ? 'ew-resize' : '';
            return;
          }
          const { step } = cellAt(e);
          const len = Math.max(1, Math.min(song.steps - draft[1], step - draft[1] + 1));
          if (len !== draft[3] && step > draft[1]) setDraft([draft[0], draft[1], draft[2], len, draft[4]]);
        }}
        onPointerUp={() => {
          if (keyHeld.current !== null) {
            keyHeld.current = null;
            hand.letGo('roll');
            return;
          }
          if (resizing) {
            const r = resizing.note;
            const before = notes[resizing.index];
            setResizing(null);
            if (r[1] === before[1] && r[3] === before[3]) return;
            // Stretched over another of the channel's notes at the same pitch: that one goes.
            const keep = notes.filter((n, i) => i !== resizing.index && !(n[0] === r[0] && n[2] === r[2] && n[1] < r[1] + r[3] && r[1] < n[1] + n[3]));
            onNotes([...keep, r].sort((a, b) => a[1] - b[1] || a[0] - b[0]));
            return;
          }
          if (!draft) return;
          // A new note replaces any other note of the channel it covers at the same pitch.
          const keep = notes.filter((n) => !(n[0] === draft[0] && n[2] === draft[2] && n[1] < draft[1] + draft[3] && draft[1] < n[1] + n[3]));
          onNotes([...keep, draft].sort((a, b) => a[1] - b[1] || a[0] - b[0]));
          setDraft(null);
        }}
        onPointerCancel={() => {
          setDraft(null);
          setResizing(null);
          keyHeld.current = null;
          hand.letGo('roll');
        }}
      />
    </div>
  );
}
