/**
 * The sound editor (like PICO-8's): a sound's 32 notes as bars. Draw the pitch with the mouse (or a finger), the
 * volume in the strip below, and an effect per note in the bottom row; pick the wave, volume and effect to draw
 * with, and the speed. Space plays. Every finished stroke is one undoable change to the game, so the AI and the
 * user can take turns on the same sound.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { emptySteps, isStepSound, MAX_NOTES, MAX_SMOOTH, MAX_SPEED, MAX_VOLUME, PITCHES, pitchName, STEP_EFFECTS, STEP_WAVES, TICK_SECONDS, audibleNotes, fullNotes, stepSeconds, type StepNote, type StepSound } from '../../core/audio/steps';
import { playSound, type Playing } from '../audio/synth';
import { addSound, newSoundName, renameSound, soundNameProblem, updateSound } from '../sounds';
import { useEditor } from '../store';

export const WAVE_COLORS = ['#29adff', '#00e436', '#ff004d', '#ffa300', '#ffec27', '#ff77a8', '#c2c3c7', '#a78bfa'];
const EFFECT_MARKS = ['·', '⟋', '∿', '↘', '◁', '▷'];
/** An empty note: nothing to hear, nothing kept. */
const EMPTY_NOTE: StepNote = [24, 0, 0, 0];
const isEmpty = (n: StepNote) => n.join() === EMPTY_NOTE.join();

// The drawing's layout (in canvas pixels; the canvas scales to the dialog's width).
const COL = 18;
const ROW = 4;
const PITCH_H = PITCHES * ROW;
const GAP = 10;
const VOL_TOP = PITCH_H + GAP;
const VOL_ROW = 7;
const VOL_H = (MAX_VOLUME + 1) * VOL_ROW;
const FX_TOP = VOL_TOP + VOL_H + GAP;
const FX_H = 18;
const W = MAX_NOTES * COL;
const H = FX_TOP + FX_H;

type Area = 'pitch' | 'volume' | 'effect';

export function SoundEditor() {
  const target = useEditor((s) => s.soundEditor);
  const asset = useEditor((s) => (s.soundEditor && s.soundEditor !== 'new' ? s.project.assets.find((a) => a.id === s.soundEditor && a.kind === 'sound') : undefined));
  const assets = useEditor((s) => s.project.assets);
  const sounds = assets.filter((a) => a.kind === 'sound' && a.synth);
  // What is drawn with, kept while switching between sounds.
  const pens = useState({ wave: 3, volume: 5, effect: 0 });
  // A new sound before anything is drawn: here only (added to the game with its first notes).
  const [fresh, setFresh] = useState<{ name: string; sound: StepSound } | null>(null);
  const close = () => useEditor.getState().setSoundEditor(null);
  useEffect(() => {
    if (target === 'new') setFresh({ name: newSoundName(), sound: emptySteps() });
    // The sound was deleted (or undone away): nothing to edit.
    else if (target && !asset) close();
  }, [target, asset === undefined]);
  if (!target || (target !== 'new' && !asset) || (target === 'new' && !fresh)) return null;
  const picker = (
    <select
      className="sound-pick"
      aria-label="Sound"
      data-testid="sound-pick"
      value={target}
      onChange={(e) => useEditor.getState().setSoundEditor(e.target.value)}
    >
      {target === 'new' && <option value="new">{fresh!.name} (new)</option>}
      {sounds.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {isStepSound(a.synth) ? '' : ' (older)'}
        </option>
      ))}
      {target !== 'new' && <option value="new">+ New sound</option>}
    </select>
  );
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dialog sound-editor" role="dialog" aria-label="Sound editor" data-testid="sound-editor">
        {target === 'new' ? (
          <Editor
            key="new"
            pens={pens}
            picker={picker}
            name={fresh!.name}
            sound={fresh!.sound}
            onChange={(sound) => {
              // Something to hear: now it is one of the game's sounds.
              if (audibleNotes(sound)) useEditor.getState().setSoundEditor(addSound(fresh!.name, sound));
              else setFresh({ ...fresh!, sound });
            }}
            onRename={(name) => {
              const problem = soundNameProblem(name);
              if (!problem) setFresh({ ...fresh!, name: name.trim() });
              return problem;
            }}
            onClose={close}
          />
        ) : isStepSound(asset!.synth) ? (
          <Editor
            key={asset!.id}
            pens={pens}
            picker={picker}
            name={asset!.name}
            sound={asset!.synth}
            onChange={(sound, label) => updateSound(asset!.id, sound, `Sound ${asset!.name}: ${label}`)}
            onRename={(name) => renameSound(asset!.id, name)}
            onDelete={() => {
              const { edit, setSoundEditor } = useEditor.getState();
              setSoundEditor(null);
              edit(`Delete sound ${asset!.name}`, (p) => void (p.assets = p.assets.filter((x) => x.id !== asset!.id)));
            }}
            onClose={close}
          />
        ) : (
          <>
            <header className="bg-head">
              <span className="sound-title">Sound {picker}</span>
              <CloseButton onClose={close} />
            </header>
            <p className="muted" data-testid="sound-old">
              This sound was made before the sound editor: it plays, but it can't be edited note by note. Ask the AI to "remake the {asset!.name} sound", then open it here again.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button className="icon-btn" aria-label="Close" data-testid="sound-editor-close" onClick={onClose}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** A tiny picture of a wave, for its button. */
function WaveIcon({ wave }: { wave: number }) {
  const points: string[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = (i / 32) * 2;
    const ph = t % 1;
    const tri = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
    const y =
      wave === 0 ? tri
      : wave === 1 ? (ph < 0.875 ? (ph / 0.875) * 2 - 1 : 1 - ((ph - 0.875) / 0.125) * 2)
      : wave === 2 ? 2 * ph - 1
      : wave === 3 ? (ph < 0.5 ? 0.8 : -0.8)
      : wave === 4 ? (ph < 0.3125 ? 0.8 : -0.8)
      : wave === 5 ? (tri + (((ph * 2) % 1) < 0.5 ? 4 * ((ph * 2) % 1) - 1 : 3 - 4 * ((ph * 2) % 1)) * 0.6) * 0.65
      : wave === 6 ? Math.sin(i * 12.9898) * 0.9
      : (tri + Math.sin(i * 0.35)) * 0.5;
    points.push(`${(i / 32) * 22 + 1},${8 - y * 6}`);
  }
  return (
    <svg width="24" height="16" viewBox="0 0 24 16" aria-hidden="true">
      <polyline points={points.join(' ')} fill="none" stroke={WAVE_COLORS[wave]} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

interface EditorProps {
  pens: [{ wave: number; volume: number; effect: number }, (p: { wave: number; volume: number; effect: number }) => void];
  /** Which sound (to switch to another, or start a new one). */
  picker: React.ReactNode;
  name: string;
  sound: StepSound;
  /** The notes or speed changed (one finished stroke). */
  onChange: (sound: StepSound, label: string) => void;
  /** Returns what is wrong with the name, or null. */
  onRename: (name: string) => string | null;
  /** Deletes the sound (after asking); missing for a new sound not yet in the game. */
  onDelete?: () => void;
  onClose: () => void;
}

function Editor({ pens: [pen, setPen], picker, name, sound, onChange, onRename, onDelete, onClose }: EditorProps) {
  const [confirming, setConfirming] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { wave, volume, effect } = pen;
  const setWave = (w: number) => setPen({ ...pen, wave: w });
  const setVolume = (v: number) => setPen({ ...pen, volume: v });
  const setEffect = (e: number) => setPen({ ...pen, effect: e });
  const [title, setTitle] = useState(name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [playing, setPlaying] = useState<{ handle: Playing; sound: StepSound } | null>(null);
  const [head, setHead] = useState<number | null>(null);
  /** The notes while a stroke is being drawn (committed as one change when it ends). */
  const [draft, setDraft] = useState<StepNote[] | null>(null);
  const stroke = useRef<{ area: Area; erase: boolean; last: { col: number; row: number } | null; notes: StepNote[]; previewed: string } | null>(null);
  const notes = useMemo(() => draft ?? fullNotes(sound), [draft, sound]);

  useEffect(() => setTitle(name), [name]);

  const commit = (next: StepNote[], label: string) => onChange({ ...sound, notes: next }, label);
  /** A pen's value on every note that sounds (silent notes stay silent). */
  const applyAll = (kind: 'wave' | 'volume' | 'effect', value: number) => {
    const slot = kind === 'wave' ? 1 : kind === 'volume' ? 2 : 3;
    const next = notes.map((n) => (n[2] > 0 ? (n.map((x, i) => (i === slot ? value : x)) as StepNote) : n));
    const what = kind === 'wave' ? STEP_WAVES[value] : kind === 'volume' ? `volume ${value}` : `effect ${STEP_EFFECTS[value]}`;
    if (next.some((n, i) => n.join() !== notes[i].join())) commit(next, `${what} on all notes`);
  };
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'wave' | 'volume' | 'effect'; value: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.('.pen-menu')) setMenu(null);
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [menu]);
  /** Double-click: on all notes; right-click: a menu offering it. */
  const penProps = (kind: 'wave' | 'volume' | 'effect', value: number) => ({
    onDoubleClick: () => applyAll(kind, value),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      if (kind === 'wave') setWave(value);
      else if (kind === 'volume') setVolume(value);
      else setEffect(value);
      const box = (e.currentTarget as HTMLElement).closest('.se-body')!.getBoundingClientRect();
      setMenu({ x: e.clientX - box.left, y: e.clientY - box.top, kind, value });
    },
  });
  const setSmooth = (smooth: number) => {
    const v = Math.max(0, Math.min(MAX_SMOOTH, smooth));
    if (v !== (sound.smooth ?? 0)) onChange({ ...sound, notes: fullNotes(sound), smooth: v }, `smooth ${v}`);
  };
  const setSpeed = (speed: number) => {
    const s = Math.max(1, Math.min(MAX_SPEED, Math.round(speed) || 1));
    if (s !== sound.speed) onChange({ ...sound, notes: fullNotes(sound), speed: s }, `speed ${s}`);
  };

  const stop = () => {
    playing?.handle.stop();
    setPlaying(null);
    setHead(null);
  };
  const play = () => {
    stop();
    const current: StepSound = { ...sound, notes };
    if (!audibleNotes(current)) return;
    const handle = playSound(current);
    if (handle) setPlaying({ handle, sound: current });
  };
  // The playhead follows the sound; it stops at its end.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const started = performance.now();
    const length = stepSeconds(playing.sound);
    const tick = () => {
      const t = (performance.now() - started) / 1000;
      if (t >= length) {
        setPlaying(null);
        setHead(null);
        return;
      }
      setHead(Math.floor(t / (playing.sound.speed * TICK_SECONDS)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => () => playingRef.current?.handle.stop(), []);

  // Drawing the notes.
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#10131c';
    ctx.fillRect(0, 0, W, PITCH_H);
    ctx.fillRect(0, VOL_TOP, W, VOL_H);
    ctx.fillRect(0, FX_TOP, W, FX_H);
    // Octave lines (each C), and every 4th note a little brighter.
    for (let p = 0; p < PITCHES; p += 12) {
      ctx.fillStyle = '#232a3a';
      ctx.fillRect(0, PITCH_H - (p + 1) * ROW + ROW - 1, W, 1);
    }
    for (let i = 0; i < MAX_NOTES; i++) {
      if (i % 4 === 0) {
        ctx.fillStyle = '#1a2030';
        ctx.fillRect(i * COL, 0, 1, H);
      }
      if (i === head || i === hover) {
        ctx.fillStyle = i === head ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(i * COL, 0, COL, PITCH_H);
      }
      const [p, w, v, e] = notes[i];
      const x = i * COL + 2;
      const top = PITCH_H - (p + 1) * ROW;
      if (v > 0) {
        ctx.fillStyle = WAVE_COLORS[w];
        ctx.globalAlpha = 0.35 + (0.65 * v) / MAX_VOLUME;
        ctx.fillRect(x, top + ROW, COL - 4, PITCH_H - top - ROW);
        ctx.globalAlpha = 1;
        ctx.fillRect(x, top, COL - 4, ROW);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, top, COL - 4, 1);
      } else if (!isEmpty(notes[i])) {
        // Turned off (volume 0) but kept: its pitch and wave are still there (raise its volume to hear it again).
        ctx.strokeStyle = '#4a5370';
        ctx.strokeRect(x + 0.5, top + 0.5, COL - 5, ROW - 1);
      }
      // Volume.
      ctx.fillStyle = v > 0 ? WAVE_COLORS[w] : '#2a3142';
      for (let k = 0; k < v; k++) ctx.fillRect(x, VOL_TOP + VOL_H - (k + 1) * VOL_ROW + 1, COL - 4, VOL_ROW - 2);
      // Effect.
      ctx.fillStyle = e ? '#e8ecf4' : '#3a4258';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(EFFECT_MARKS[e], i * COL + COL / 2, FX_TOP + FX_H / 2 + 1);
    }
    c.dataset.notes = JSON.stringify(notes.slice(0, audibleNotes({ type: 'steps', speed: 1, notes })));
  }, [notes, head, hover]);

  /** Where a pointer is: which note, which area, and the row in it. */
  const at = (e: { clientX: number; clientY: number }) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    const col = Math.max(0, Math.min(MAX_NOTES - 1, Math.floor(x / COL)));
    if (y < VOL_TOP - GAP / 2) return { col, area: 'pitch' as Area, row: Math.max(0, Math.min(PITCHES - 1, Math.floor((PITCH_H - y) / ROW))) };
    if (y < FX_TOP - GAP / 2) return { col, area: 'volume' as Area, row: Math.max(0, Math.min(MAX_VOLUME, Math.round((VOL_TOP + VOL_H - y) / VOL_ROW))) };
    return { col, area: 'effect' as Area, row: 0 };
  };

  /** Applies the stroke to one note. */
  const paint = (list: StepNote[], col: number, row: number, area: Area, erase: boolean) => {
    const n = [...list[col]] as StepNote;
    if (area === 'pitch') {
      // Deleted outright: back to an empty note (nothing kept). (The volume strip only turns a note off.)
      if (erase) n.splice(0, 4, ...EMPTY_NOTE);
      else {
        n[0] = row;
        n[1] = wave;
        if (n[2] === 0) {
          n[2] = volume;
          n[3] = effect;
        }
      }
    } else if (area === 'volume') n[2] = erase ? 0 : row;
    else n[3] = erase ? 0 : effect;
    list[col] = n;
  };

  const preview = (n: StepNote) => {
    if (n[2] > 0) playSound({ type: 'steps', speed: 10, notes: [[n[0], n[1], n[2], 0]] }, { volume: 0.8 });
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    canvas.current!.setPointerCapture(e.pointerId);
    const p = at(e);
    const list = notes.map((n) => [...n] as StepNote);
    stroke.current = { area: p.area, erase: e.button === 2 || e.altKey, last: null, notes: list, previewed: '' };
    onMove(e);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = at(e);
    setHover(p.col);
    const s = stroke.current;
    if (!s) return;
    // Every note the pointer passed over since the last move (a quick sweep leaves no gaps), rows in between.
    const from = s.last ?? { col: p.col, row: p.row };
    const steps = Math.abs(p.col - from.col);
    for (let k = 0; k <= steps; k++) {
      const col = from.col + Math.sign(p.col - from.col) * k;
      const row = steps ? Math.round(from.row + ((p.row - from.row) * k) / steps) : p.row;
      paint(s.notes, col, row, s.area, s.erase);
    }
    s.last = { col: p.col, row: p.row };
    const n = s.notes[p.col];
    const key = `${p.col}:${n.join(',')}`;
    if (s.area !== 'effect' && key !== s.previewed) {
      s.previewed = key;
      preview(n);
    }
    setDraft([...s.notes]);
  };

  const onUp = () => {
    const s = stroke.current;
    stroke.current = null;
    if (!s) return;
    const changed = s.notes.some((n, i) => n.join() !== fullNotes(sound)[i].join());
    if (changed) commit(s.notes, s.area === 'pitch' ? (s.erase ? 'silence notes' : 'draw notes') : s.area);
    setDraft(null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === ' ') {
      e.preventDefault();
      if (playing) stop();
      else play();
    }
  };

  const info = hover !== null ? notes[hover] : null;
  const count = audibleNotes({ type: 'steps', speed: sound.speed, notes });
  return (
    <div className="se-body" tabIndex={-1} onKeyDown={onKey} data-testid="sound-editor-body">
      <header className="bg-head">
        <span className="sound-title">
          Sound
          {picker}
          <input
            className="sound-name"
            value={title}
            aria-label="Sound name"
            data-testid="sound-name"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setNameError(onRename(title))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              e.stopPropagation();
            }}
          />
          {onDelete && (
            <button className="icon-btn" aria-label="Delete sound" title="Delete this sound" data-testid="sound-delete" onClick={() => setConfirming(true)}>
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.6 6.5v5M9.4 6.5v5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </span>
        <CloseButton onClose={onClose} />
      </header>
      {nameError && <p className="error small">{nameError}</p>}
      {confirming && onDelete && (
        <div className="sound-confirm" role="alertdialog" aria-label="Delete sound?" data-testid="sound-delete-confirm">
          <span>
            <b>Delete sound?</b> <span className="muted small">“{name}” goes from the game (scripts that play it report it missing). Undo brings it back.</span>
          </span>
          <button className="chip-btn" data-testid="sound-delete-cancel" onClick={() => setConfirming(false)} autoFocus>
            Cancel
          </button>
          <button className="danger-btn" data-testid="sound-delete-yes" onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
      <div className="sound-tools">
        <button className="primary-btn sound-play" data-testid="sound-editor-play" onClick={() => (playing ? stop() : play())} disabled={!count && !playing} title="Play (Space)">
          {playing ? '■ Stop' : '▶ Play'}
        </button>
        <span className="sound-speed">
          Speed
          <button className="chip-btn" aria-label="Faster" data-testid="sound-faster" onClick={() => setSpeed(sound.speed - 1)} disabled={sound.speed <= 1}>
            −
          </button>
          <span className="n" data-testid="sound-speed">
            {sound.speed}
          </span>
          <button className="chip-btn" aria-label="Slower" data-testid="sound-slower" onClick={() => setSpeed(sound.speed + 1)} disabled={sound.speed >= MAX_SPEED}>
            +
          </button>
        </span>
        <span className="sound-speed" title="Softens the sound: filters away its harsh highs (good on noise)">
          Smooth
          <button className="chip-btn" aria-label="Less smooth" data-testid="sound-rougher" onClick={() => setSmooth((sound.smooth ?? 0) - 1)} disabled={!sound.smooth}>
            −
          </button>
          <span className="n" data-testid="sound-smooth">
            {sound.smooth ?? 0}
          </span>
          <button className="chip-btn" aria-label="Smoother" data-testid="sound-smoother" onClick={() => setSmooth((sound.smooth ?? 0) + 1)} disabled={(sound.smooth ?? 0) >= MAX_SMOOTH}>
            +
          </button>
        </span>
        <span className="muted small">
          {count} note{count === 1 ? '' : 's'} · {stepSeconds({ type: 'steps', speed: sound.speed, notes }).toFixed(2)} s
        </span>
      </div>
      <div className="sound-pens">
        <span className="pen-label">Wave</span>
        <span className="pen-group" role="radiogroup" aria-label="Wave">
          {STEP_WAVES.map((w, i) => (
            <button key={w} role="radio" aria-checked={wave === i} className={`pen${wave === i ? ' on' : ''}`} title={w} aria-label={w} data-testid={`sound-wave-${i}`} onClick={() => setWave(i)} {...penProps('wave', i)}>
              <WaveIcon wave={i} />
            </button>
          ))}
        </span>
        <span className="pen-label">Volume</span>
        <span className="pen-group" role="radiogroup" aria-label="Volume">
          {Array.from({ length: MAX_VOLUME }, (_, k) => k + 1).map((v) => (
            <button key={v} role="radio" aria-checked={volume === v} className={`pen small-pen${volume === v ? ' on' : ''}`} data-testid={`sound-volume-${v}`} onClick={() => setVolume(v)} {...penProps('volume', v)}>
              {v}
            </button>
          ))}
        </span>
        <span className="pen-label">Effect</span>
        <span className="pen-group" role="radiogroup" aria-label="Effect">
          {STEP_EFFECTS.map((fx, i) => (
            <button key={fx} role="radio" aria-checked={effect === i} className={`pen small-pen${effect === i ? ' on' : ''}`} title={fx} aria-label={fx} data-testid={`sound-effect-${i}`} onClick={() => setEffect(i)} {...penProps('effect', i)}>
              {EFFECT_MARKS[i]}
            </button>
          ))}
        </span>
      </div>
      {menu && (
        <div className="context-menu pen-menu" role="menu" style={{ left: menu.x, top: menu.y }} data-testid="pen-menu">
          <button
            className="menu-row"
            role="menuitem"
            data-testid="pen-all"
            onClick={() => {
              applyAll(menu.kind, menu.value);
              setMenu(null);
            }}
          >
            All notes: {menu.kind === 'wave' ? STEP_WAVES[menu.value] : menu.kind === 'volume' ? `volume ${menu.value}` : STEP_EFFECTS[menu.value]}
          </button>
        </div>
      )}
      <canvas
        ref={canvas}
        className="sound-canvas"
        width={W}
        height={H}
        data-testid="sound-canvas"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => !stroke.current && setHover(null)}
        onContextMenu={(e) => e.preventDefault()}
      />
      <p className="sound-info small" data-testid="sound-info">
        {info ? (info[2] ? `Note ${hover! + 1}: ${pitchName(info[0])} · ${STEP_WAVES[info[1]]} · volume ${info[2]}${info[3] ? ` · ${STEP_EFFECTS[info[3]]}` : ''}` : isEmpty(info) ? `Note ${hover! + 1}: empty` : `Note ${hover! + 1}: off (keeps ${pitchName(info[0])} · ${STEP_WAVES[info[1]]}: give it a volume to hear it again)`) : ' '}
      </p>
      <p className="muted small sound-help">Draw notes in the top part (right-click or Alt deletes them), their volume in the middle strip (right-click turns a note off but keeps it), and the chosen effect in the bottom row. Double-click a wave, volume or effect (or right-click it → All notes) to put it on every note. Space plays; Ctrl+Z undoes.</p>
    </div>
  );
}
