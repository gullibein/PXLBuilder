/**
 * The reply format for AI connections that are told it in words (claude.ai, Gemini, the reply tool): the same JSON
 * Schema the answer is checked against, written compactly, TypeScript-like, with its descriptions: a third of the
 * size of the schema's own JSON, which went with every request.
 */
type Schema = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: Schema[];
  oneOf?: Schema[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  description?: string;
};

/** Field descriptions already given (a field with the same name and meaning in a later operation is not described again). */
let described = new Set<string>();

/** A type, on one line ("string", '"a"|"b"', "number[]", "{x: number, y: number}", "T|null"). */
function typeOf(s: Schema, indent: string): string {
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((e) => JSON.stringify(e)).join('|');
  const branches = s.anyOf ?? s.oneOf;
  if (branches) return branches.map((b) => typeOf(b, indent)).join('|');
  const t = Array.isArray(s.type) ? s.type : [s.type];
  const one = (k: string | undefined): string => {
    if (k === 'integer') return 'integer';
    if (k === 'array') {
      const inner = s.items ? typeOf(s.items, indent) : 'unknown';
      return /[|{]/.test(inner) && !inner.startsWith('{') ? `(${inner})[]` : `${inner}[]`;
    }
    if (k === 'object') return s.properties ? objectOf(s, indent) : 'object';
    return k ?? 'unknown';
  };
  return t.map(one).join('|');
}

/** An object's fields: {a: T, b?: T — what it is}; long ones (with descriptions) one field per line. */
function objectOf(s: Schema, indent: string): string {
  const req = new Set(s.required ?? []);
  const fields = Object.entries(s.properties ?? {}).map(([k, v]) => {
    const key = `${k}\n${v.description ?? ''}`;
    const d = v.description && !described.has(key) ? ` — ${v.description}` : '';
    if (v.description) described.add(key);
    return `${k}${req.has(k) ? '' : '?'}: ${typeOf(v, indent + '  ')}${d}`;
  });
  const flat = `{${fields.join(', ')}}`;
  if (!flat.includes(' — ') && flat.length < 160) return flat;
  return `{\n${fields.map((f) => `${indent}  ${f}`).join('\n')}\n${indent}}`;
}

/** The reply format in words. */
export function compactReplyFormat(schema: Schema): string {
  described = new Set();
  const props = { ...(schema.properties ?? {}) };
  const ops = props.operations;
  delete props.operations;
  const top = objectOf({ ...schema, properties: props, required: (schema.required ?? []).filter((r) => r !== 'operations') }, '');
  const branches = ops?.items?.anyOf ?? ops?.items?.oneOf ?? [];
  const lines = branches.map((b) => {
    const p = { ...(b.properties ?? {}) };
    const name = p.op?.const;
    delete p.op;
    return `- ${String(name)}: ${objectOf({ ...b, properties: p, required: (b.required ?? []).filter((r) => r !== 'op') }, '  ')}`;
  });
  return `One JSON object: ${top.replace(/\n}$/, '')}
  operations: Operation[] — the changes, applied in order${ops?.description ? `: ${ops.description}` : ''}
}
Operation: {"op": "<name>", ...its fields} with ALL of its fields (null where the type allows null; "?" fields may be left out). A field described once means the same in later operations. The operations:
${lines.join('\n')}`;
}
