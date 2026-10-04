import { useEffect, useState } from 'react';
import type { FieldSchema } from '../../core/components/schema';
import type { Vec2 } from '../../core/types';
import { useEditor } from '../store';

/** Number input that keeps a local draft and commits on Enter/blur. */
export function NumberInput(props: { value: number; onCommit: (v: number) => void; step?: number; testId?: string }) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => setDraft(String(props.value)), [props.value]);
  const commit = () => {
    const v = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(v) && v !== props.value) props.onCommit(v);
    // If the commit was accepted, the new value flows back via props; if it was rejected, show the current value again.
    setDraft(String(props.value));
  };
  return (
    <input
      className="num"
      type="number"
      step={props.step ?? 'any'}
      value={draft}
      data-testid={props.testId}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(String(props.value));
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** Text input committing on Enter/blur. */
export function TextInput(props: { value: string; onCommit: (v: string) => void; placeholder?: string; testId?: string }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  return (
    <input
      type="text"
      value={draft}
      placeholder={props.placeholder}
      data-testid={props.testId}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== props.value) props.onCommit(draft);
        setDraft(props.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(props.value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function Vec2Input(props: { value: Vec2; onCommit: (v: Vec2) => void; step?: number; testId?: string }) {
  const { value, onCommit } = props;
  return (
    <span className="vec2">
      <label>x</label>
      <NumberInput value={value.x} step={props.step} testId={props.testId && `${props.testId}.x`} onCommit={(x) => onCommit({ x, y: value.y })} />
      <label>y</label>
      <NumberInput value={value.y} step={props.step} testId={props.testId && `${props.testId}.y`} onCommit={(y) => onCommit({ x: value.x, y })} />
    </span>
  );
}

/** Generic editor for one schema-described field. */
export function FieldEditor(props: { schema: FieldSchema; value: unknown; onCommit: (v: unknown) => void; testId?: string }) {
  const { schema, value, onCommit, testId } = props;
  switch (schema.kind) {
    case 'number':
      return <NumberInput value={typeof value === 'number' ? value : schema.default} step={schema.step} testId={testId} onCommit={onCommit} />;
    case 'string':
      return <TextInput value={typeof value === 'string' ? value : ''} testId={testId} onCommit={onCommit} />;
    case 'boolean':
      return <input type="checkbox" checked={value === true} data-testid={testId} onChange={(e) => onCommit(e.target.checked)} />;
    case 'enum':
      return (
        <select value={String(value)} data-testid={testId} onChange={(e) => onCommit(e.target.value)}>
          {schema.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'color':
      return (
        <span className="color-field">
          <input type="color" value={normalizeColor(value)} data-testid={testId} onChange={(e) => onCommit(e.target.value)} />
          <code>{String(value)}</code>
        </span>
      );
    case 'vec2':
      return <Vec2Input value={(value as Vec2) ?? schema.default} testId={testId} onCommit={onCommit} />;
    case 'assetRef':
      // Chosen in the Sprites panel; shown here by name.
      return <AssetName id={typeof value === 'string' ? value : null} />;
    case 'stringList':
      return <ListInput value={Array.isArray(value) ? (value as string[]) : []} testId={testId} onCommit={onCommit} />;
  }
}

/** Comma-separated list editor. */
export function ListInput(props: { value: string[]; onCommit: (v: string[]) => void; placeholder?: string; testId?: string }) {
  return (
    <TextInput
      value={props.value.join(', ')}
      placeholder={props.placeholder ?? 'comma, separated'}
      testId={props.testId}
      onCommit={(text) =>
        props.onCommit(
          text
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        )
      }
    />
  );
}

function normalizeColor(value: unknown): string {
  if (typeof value !== 'string') return '#000000';
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  if (/^#[0-9a-fA-F]{3}$/.test(value)) return '#' + [...value.slice(1)].map((c) => c + c).join('');
  if (/^#[0-9a-fA-F]{8}$/.test(value)) return value.slice(0, 7);
  return '#000000';
}

function AssetName({ id }: { id: string | null }) {
  const name = useEditor((s) => (id ? s.project.assets.find((a) => a.id === id)?.name : undefined));
  return <span className="muted">{id ? (name ?? 'missing image') : 'none (plain color)'}</span>;
}
