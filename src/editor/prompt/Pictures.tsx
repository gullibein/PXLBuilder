/**
 * Pictures attached to a prompt before it is sent (pasted into it, dropped on it, or picked with the picture
 * button): shown as small thumbnails with a × each, sent with the request (ai/pictures.ts), then gone.
 */
import { useRef, useState } from 'react';
import { imageFiles, MAX_PICTURES, readPicture, type AttachedPicture } from '../ai/pictures';

export function usePictures() {
  const [pictures, setPictures] = useState<AttachedPicture[]>([]);
  const [reading, setReading] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const add = async (files: Blob[]) => {
    setProblem(null);
    const room = MAX_PICTURES - pictures.length - reading;
    if (files.length > room) setProblem(`At most ${MAX_PICTURES} pictures go with one request.`);
    const taken = files.slice(0, Math.max(0, room));
    setReading((n) => n + taken.length);
    for (const f of taken) {
      try {
        const p = await readPicture(f);
        setPictures((list) => (list.length < MAX_PICTURES ? [...list, p] : list));
      } catch (e) {
        setProblem((e as Error).message);
      } finally {
        setReading((n) => n - 1);
      }
    }
  };
  return {
    pictures,
    reading: reading > 0,
    problem,
    add,
    remove: (i: number) => setPictures((list) => list.filter((_, j) => j !== i)),
    clear: () => {
      setPictures([]);
      setProblem(null);
    },
    /** For the text field: a pasted picture is attached (pasted text stays text). */
    onPaste: (e: React.ClipboardEvent) => {
      const files = imageFiles(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      void add(files);
    },
    /** For the whole card: pictures dropped on it are attached. */
    dropProps: {
      onDragOver: (e: React.DragEvent) => {
        if ([...e.dataTransfer.types].includes('Files')) e.preventDefault();
      },
      onDrop: (e: React.DragEvent) => {
        const files = imageFiles(e.dataTransfer);
        if (!files.length) return;
        e.preventDefault();
        void add(files);
      },
    },
  };
}

export type Pictures = ReturnType<typeof usePictures>;

/** The attached pictures (nothing when there are none). */
export function PictureStrip({ pics }: { pics: Pictures }) {
  if (!pics.pictures.length && !pics.reading && !pics.problem) return null;
  return (
    <div className="picture-strip" data-testid="picture-strip">
      {pics.pictures.map((p, i) => (
        <span key={i} className="picture-thumb" title={`${p.picture.name} (${p.picture.sourceWidth}×${p.picture.sourceHeight})`} data-testid="picture-thumb">
          <img src={p.thumb} alt={p.picture.name} />
          <button className="picture-remove" aria-label={`Remove ${p.picture.name}`} data-testid="picture-remove" onClick={() => pics.remove(i)}>
            ×
          </button>
        </span>
      ))}
      {pics.reading && <span className="picture-thumb reading">…</span>}
      {pics.problem && (
        <span className="picture-problem small" data-testid="picture-problem">
          {pics.problem}
        </span>
      )}
    </div>
  );
}

/** Picks pictures from the computer. */
export function AddPictureButton({ pics, disabled }: { pics: Pictures; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="icon-btn picture-btn"
        title="Add a picture: an example of the game you want, or a sprite sheet (you can also paste or drop one)"
        aria-label="Add a picture"
        data-testid="picture-add"
        disabled={disabled || pics.pictures.length >= MAX_PICTURES}
        onClick={() => input.current?.click()}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="5.5" cy="6.25" r="1.25" fill="currentColor" />
          <path d="m2.5 12 3.8-3.6 2.4 2.2 2.2-2 2.6 2.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid="picture-file"
        onChange={(e) => {
          void pics.add([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
    </>
  );
}
