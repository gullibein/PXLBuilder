/**
 * What the AI is doing, in words, while its answer is still being written (the New game window shows it): its idea
 * and plan (the answer's "message" and "changes", written before its operations), and a line for each operation as
 * soon as it is complete ("Drawing Ember", "Giving Dust Bunny the Walker behavior"). Made by the app from the answer
 * itself: it costs the AI nothing.
 */

/** The answer's message (as far as it has come) and the lines of its "changes" that are complete. */
export function answerPreview(text: string): { message: string; changes: string[] } {
  const m = /"message"\s*:\s*"/.exec(text);
  let message = '';
  if (m) {
    let j = m.index + m[0].length;
    const start = j;
    while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
    message = unescapePartial(text.slice(start, Math.min(j, text.length)));
  }
  const c = /"changes"\s*:\s*\[/.exec(text);
  const changes: string[] = [];
  if (c) {
    let i = c.index + c[0].length;
    for (;;) {
      while (i < text.length && /[\s,]/.test(text[i])) i++;
      if (i >= text.length || text[i] !== '"') break;
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length) break;
      changes.push(unescapePartial(text.slice(i + 1, j)));
      i = j + 1;
    }
  }
  return { message, changes };
}

/** A JSON string's inside, cut off anywhere (a half escape at the end is dropped). */
function unescapePartial(s: string): string {
  const cut = s.replace(/\\(u[0-9a-fA-F]{0,3})?$/, '');
  try {
    return JSON.parse(`"${cut}"`) as string;
  } catch {
    return cut.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

const COMPONENT_WORDS: Record<string, string> = {
  LedgeGrab: 'the ability to grab ledges',
  DoubleJump: 'a double jump',
  Health: 'health (hearts)',
  Inventory: 'a bag for what it picks up',
  MovingPlatform: 'movement back and forth (a moving platform)',
  Pushable: 'the ability to be pushed',
  Liquid: 'water to swim in',
  Climbable: 'something to climb',
  Collectible: 'the ability to be picked up',
  Openable: 'the ability to open and shut',
  Switch: 'a switch',
  Goal: 'the goal',
  StartsHidden: 'a hidden start',
  Patrol: 'patrolling',
};

/**
 * One operation, as a line of what the AI is doing (null for the ones not worth a line). `names` turns ids and refs
 * into names; it is kept up to date from the operations themselves (a create_definition's ref, a rename).
 */
export function narrateOperation(op: Record<string, unknown>, names: Map<string, string>): string | null {
  const name = (id: unknown) => (typeof id === 'string' ? (names.get(id) ?? (/^(def|ent|scn)_/.test(id) ? 'an object' : id)) : 'it');
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (op.op) {
    case 'create_definition': {
      if (typeof op.ref === 'string' && typeof op.name === 'string') names.set(op.ref, op.name);
      const what = str(op.description).split(/(?<=[.!?])\s/)[0];
      return `Making ${str(op.name) || 'a new object'}${what ? `: ${what.replace(/\.$/, '')}` : ''}`;
    }
    case 'rename': {
      const before = name(op.id);
      if (typeof op.id === 'string' && typeof op.name === 'string') names.set(op.id, op.name);
      return before === str(op.name) ? null : `Turning ${before} into ${str(op.name)}`;
    }
    case 'draw_sprite':
      return op.situation ? `Drawing ${name(op.id)} ${String(op.situation).replace(/_/g, ' ')}` : `Drawing ${str(op.name) || name(op.id)}`;
    case 'make_autotile':
    case 'draw_autotile':
      return `Giving ${name(op.id)} finished edges and corners`;
    case 'make_background':
      return `Making the background: ${str(op.kind)}${Array.isArray(op.colors) && op.colors.length ? ` in ${(op.colors as string[]).slice(0, 2).join(' and ')}` : ''}`;
    case 'paint_background':
      return 'Painting the background';
    case 'generate_background':
      return `Asking for a background picture: ${str(op.prompt).slice(0, 80)}`;
    case 'set_script': {
      let ready = '';
      try {
        const s = JSON.parse(str(op.scriptJson)) as { ready?: string; name?: string };
        ready = s.ready ?? s.name ?? '';
      } catch {
        // (Not readable: said plainly.)
      }
      return ready ? `Giving ${name(op.id)} the ${ready} behavior` : `Writing a behavior for ${name(op.id)}`;
    }
    case 'add_component': {
      const c = str(op.component);
      return `Giving ${name(op.id)} ${COMPONENT_WORDS[c] ?? c.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`;
    }
    case 'remove_component':
      return `Taking ${str(op.component).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} away from ${name(op.id)}`;
    case 'create_level':
      if (typeof op.ref === 'string' && typeof op.name === 'string') names.set(op.ref, op.name);
      return `Starting ${str(op.name) || 'a new level'}`;
    case 'draw_map': {
      const rows = Array.isArray(op.rows) ? (op.rows as string[]) : [];
      return `Building ${name(op.sceneId)}: ${rows[0]?.length ?? 0} by ${rows.length} cells`;
    }
    case 'build_path':
      return `Adding a way through ${name(op.sceneId)}`;
    case 'create_relationship': {
      try {
        const r = JSON.parse(str(op.relationshipJson)) as { type?: string; source?: { id?: string; tag?: string }; target?: { id?: string; tag?: string } };
        const a = r.source?.id ? name(r.source.id) : r.source?.tag;
        const b = r.target?.id ? name(r.target.id) : r.target?.tag;
        if (r.type === 'requires') return `Locking ${a}: it needs ${b}`;
        if (r.type === 'teleports_to') return `Linking a teleporter to another`;
        if (r.type === 'controls') return `Wiring ${a} to ${b}`;
        return `Connecting ${a} and ${b} (${String(r.type).replace(/_/g, ' ')})`;
      } catch {
        return null;
      }
    }
    case 'create_rule':
      return 'Writing a rule';
    case 'make_song':
      return `Composing music${op.name ? `: ${str(op.name)}` : ''}`;
    case 'make_sound':
      return `Making a sound${op.name ? `: ${str(op.name)}` : ''}`;
    case 'make_instrument':
      return `Making an instrument${op.name ? `: ${str(op.name)}` : ''}`;
    case 'set_camera':
      return 'Setting up the camera';
    case 'set_world':
      return 'Setting up the world';
    case 'set_panel':
      return 'Making a panel for the screen';
    default:
      return null;
  }
}
