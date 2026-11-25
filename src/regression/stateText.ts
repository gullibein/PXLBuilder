/**
 * The state of play as text (docs §30, W0): every field a thing has, numbers exactly, other things by their place in
 * the level, ids by the order they first appear in (they are random each time a game is made). Used by the "same
 * answers" fingerprints (sameAnswers.ts) and by tests that play a game two ways and compare.
 */
import type { RuntimeEntity } from '../runtime/runtime';

/** Fields that are not state of play: what a thing is made from (the same every frame), and functions. */
const SKIP = new Set(['base', 'script', 'project', 'registry', 'scene']);
/** Ids are random each time a game is made: named by the order they first appear in. */
const ID = /^(ent|def|scn|ast|rel|rule|scr|trg|tx)_[0-9a-f]{6,}$/;

export class StateText {
  private readonly ids = new Map<string, string>();
  index = new Map<object, number>();

  private idOf(s: string): string {
    let k = this.ids.get(s);
    if (!k) this.ids.set(s, (k = `${s.slice(0, s.indexOf('_'))}#${this.ids.size}`));
    return k;
  }

  /** A value as text: numbers exactly, things by their place in the level, ids by first appearance. */
  text(v: unknown, depth: number): string {
    if (v === null || v === undefined) return 'n';
    const t = typeof v;
    if (t === 'number') return Object.is(v, -0) ? '-0' : String(v);
    if (t === 'boolean') return v ? 'T' : 'F';
    if (t === 'string') return ID.test(v as string) ? this.idOf(v as string) : `"${v as string}"`;
    if (t !== 'object') return '';
    const at = this.index.get(v as object);
    if (at !== undefined) return `#${at}`;
    if (depth <= 0) return '…';
    let out = '';
    if (Array.isArray(v)) {
      for (const x of v) out += `${this.text(x, depth - 1)},`;
      return `[${out}]`;
    }
    if (v instanceof Map) {
      for (const [k, x] of v) out += `${this.text(k, depth - 1)}>${this.text(x, depth - 1)},`;
      return `M(${out})`;
    }
    if (v instanceof Set) {
      for (const x of v) out += `${this.text(x, depth - 1)},`;
      return `S(${out})`;
    }
    if (ArrayBuffer.isView(v)) return `A(${Array.from(v as unknown as ArrayLike<number>).join(',')})`;
    for (const k in v as object) {
      if (SKIP.has(k)) continue;
      const x = (v as Record<string, unknown>)[k];
      if (typeof x === 'function') continue;
      out += `${k}:${this.text(x, depth - 1)};`;
    }
    return `{${out}}`;
  }

  thing(e: RuntimeEntity): string {
    let out = '';
    for (const k in e) {
      if (k === 'id' || SKIP.has(k)) continue;
      const x = (e as unknown as Record<string, unknown>)[k];
      if (typeof x === 'function') continue;
      out += `${k}:${this.text(x, 4)};`;
    }
    return out;
  }
}
