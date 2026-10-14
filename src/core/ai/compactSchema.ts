/**
 * A smaller form of the reply format for models whose strict output grammar allows only a few "either X or null"
 * fields (Claude Sonnet 5.5: at most 16 union-typed and 24 optional parameters per request). The reply format has
 * about 30 such fields. In the compact form, a field that may be null is instead:
 *   - text (a string, or a choice of strings): plain text, where "" means null;
 *   - anything else (a number, true/false, a list, an object): optional, where leaving it out means null.
 * expandReply turns a compact answer back into the normal form, so it is checked exactly like any other.
 */

type Schema = Record<string, unknown> & {
  type?: string | string[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: unknown[];
};

const isNull = (s: Schema) => s.type === 'null';

/** The schema without its null: { non-null part, it was nullable }. */
function withoutNull(s: Schema): { inner: Schema; nullable: boolean } {
  if (Array.isArray(s.type) && s.type.includes('null')) {
    const rest = s.type.filter((t) => t !== 'null');
    return { inner: { ...s, type: rest.length === 1 ? rest[0] : rest }, nullable: true };
  }
  const branches = s.anyOf ?? s.oneOf;
  if (branches && branches.some(isNull)) {
    const rest = branches.filter((b) => !isNull(b));
    const { anyOf: _a, oneOf: _o, ...meta } = s;
    return { inner: rest.length === 1 ? { ...meta, ...rest[0] } : { ...meta, anyOf: rest }, nullable: true };
  }
  return { inner: s, nullable: false };
}

const isText = (s: Schema) => s.type === 'string';

/** The compact form of a JSON schema (see above). */
export function compactSchema(schema: Schema): Schema {
  const walk = (s: Schema): Schema => {
    if (s.anyOf) return { ...s, anyOf: s.anyOf.map(walk) };
    if (s.oneOf) return { ...s, oneOf: s.oneOf.map(walk) };
    if (s.type === 'array' && s.items) return { ...s, items: walk(s.items) };
    if (s.type !== 'object' || !s.properties) return s;
    const properties: Record<string, Schema> = {};
    let required = [...(s.required ?? [])];
    for (const [key, prop] of Object.entries(s.properties)) {
      const { inner, nullable } = withoutNull(prop);
      if (!nullable) {
        properties[key] = walk(prop);
        continue;
      }
      if (isText(inner)) {
        properties[key] = { ...inner, ...(inner.enum ? { enum: [...inner.enum, ''] } : {}), description: `${prop.description ? `${String(prop.description)} ` : ''}("" = none)` };
      } else {
        properties[key] = { ...walk(inner), description: `${prop.description ? `${String(prop.description)} ` : ''}(leave out = none)` };
        required = required.filter((r) => r !== key);
      }
    }
    return { ...s, properties, required, additionalProperties: false };
  };
  return walk(schema);
}

/** How many union-typed and optional parameters a schema has (as the API counts them, near enough). */
export function schemaCost(schema: Schema): { unions: number; optional: number } {
  let unions = 0;
  let optional = 0;
  const walk = (s: Schema) => {
    if (!s || typeof s !== 'object') return;
    for (const b of [...(s.anyOf ?? []), ...(s.oneOf ?? [])]) walk(b);
    if (s.items) walk(s.items);
    if (s.properties) {
      for (const [key, prop] of Object.entries(s.properties)) {
        if (Array.isArray(prop.type) || prop.anyOf || prop.oneOf) unions++;
        if (!(s.required ?? []).includes(key)) optional++;
        walk(prop);
      }
    }
  };
  walk(schema);
  return { unions, optional };
}

/** A compact answer back in the normal form: "" (in a field that may be null) and left-out fields become null. */
export function expandReply(value: unknown, schema: Schema): unknown {
  const { inner, nullable } = withoutNull(schema);
  if (nullable) {
    if (value === undefined || value === null) return null;
    if (value === '' && (isText(inner) || (inner.anyOf ?? []).some(isText))) return null;
    return expandReply(value, inner);
  }
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const v = value as Record<string, unknown>;
    // The branch this object is: the one whose fixed "op" / "do" / "type" it has.
    const branch =
      branches.find((b) => Object.entries(b.properties ?? {}).some(([k, p]) => (p as { const?: unknown }).const !== undefined && (p as { const?: unknown }).const === v[k])) ??
      branches.find((b) => b.type === 'object');
    return branch ? expandReply(value, branch) : value;
  }
  if (schema.type === 'array' && schema.items && Array.isArray(value)) return value.map((x) => expandReply(x, schema.items!));
  if (schema.type === 'object' && schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    const out: Record<string, unknown> = { ...v };
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (key in v) out[key] = expandReply(v[key], prop);
      else if (withoutNull(prop).nullable) out[key] = null;
    }
    return out;
  }
  return value;
}
