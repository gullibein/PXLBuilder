import { beforeAll, describe, expect, it, vi } from 'vitest';

const blobs = new Map<string, string>();
const docs = new Map<string, Record<string, unknown>>();
let n = 0;
beforeAll(() => {
  const snap = (path: string) => ({ id: path.split('/').pop()!, exists: docs.has(path), data: () => (docs.has(path) ? structuredClone(docs.get(path)) : undefined) });
  const caps: Record<string, unknown> = {
    assets: {
      upload: async (blob: Blob) => {
        const id = String(++n).padStart(32, '0');
        blobs.set(id, await blob.text());
        return { id, url: `/_blob/${id}`, sizeBytes: blob.size };
      },
      delete: async (id: string) => blobs.delete(id),
    },
    db: {
      doc: (path: string) => ({ get: async () => snap(path), set: async (d: Record<string, unknown>) => void docs.set(path, structuredClone(d)), delete: async () => void docs.delete(path) }),
      collection: (path: string) => ({ get: async () => ({ docs: [...docs.keys()].filter((k) => k.startsWith(`${path}/`)).map(snap) }) }),
    },
  };
  (globalThis as { claude?: unknown }).claude = { use: async (name: string) => caps[name] ?? null };
});

describe('saves kept with the app', () => {
  it('one save per game, kept up to date (the file before is removed); listed most recent first', async () => {
    const { saveToCloud, listCloudSaves, deleteCloudSave } = await import('./cloudSaves');
    // A clock that moves on between saves (two saves in the same millisecond would have no order).
    let now = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
    expect(await saveToCloud('prj_1', 'Mole Mine', '{"a":1}')).toMatchObject({ ok: true });
    expect(await saveToCloud('prj_1', 'Mole Mine', '{"a":2}')).toMatchObject({ ok: true });
    await new Promise((r) => setTimeout(r, 0));
    expect([...blobs.values()]).toEqual(['{"a":2}']);
    await saveToCloud('prj_2', 'Tetris', '{}');
    const list = await listCloudSaves();
    expect(list.map((s) => s.name)).toEqual(['Tetris', 'Mole Mine']);
    await deleteCloudSave(list[1]);
    expect((await listCloudSaves()).map((s) => s.name)).toEqual(['Tetris']);
    clock.mockRestore();
  });
});
