/**
 * Which AI answers and how: Claude or Google Gemini, and best quality or
 * fast. Saved in this browser (not in the game). Keys live in apiKey.ts.
 */
import { useEffect, useState } from 'react';
import type { AISpeed } from '../../core/ai/protocol';

export type AIVendor = 'claude' | 'gemini';

export interface AISettings {
  vendor: AIVendor;
  speed: AISpeed;
  /** The Gemini model to use (picked from the ones the key can use). */
  geminiModel: string;
  /** Asked instead when geminiModel is busy ('' = no backup). */
  geminiBackup: string;
}

/** Google's Flash model at the time of writing; the dialog lists what the key can actually use. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_GEMINI_BACKUP = 'gemini-3.5-flash';
/** Always offered in AI connection, newest first. */
export const GEMINI_FLASH_MODELS = [DEFAULT_GEMINI_MODEL, DEFAULT_GEMINI_BACKUP];

const STORAGE_KEY = 'pxlbuilder.aiSettings';
const DEFAULTS: AISettings = { vendor: 'claude', speed: 'best', geminiModel: DEFAULT_GEMINI_MODEL, geminiBackup: DEFAULT_GEMINI_BACKUP };
const listeners = new Set<() => void>();

function load(): AISettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<AISettings>;
    return {
      vendor: raw.vendor === 'gemini' ? 'gemini' : 'claude',
      speed: raw.speed === 'fast' ? 'fast' : 'best',
      geminiModel: typeof raw.geminiModel === 'string' && raw.geminiModel.trim() ? raw.geminiModel.trim() : DEFAULT_GEMINI_MODEL,
      geminiBackup: typeof raw.geminiBackup === 'string' ? raw.geminiBackup.trim() : DEFAULT_GEMINI_BACKUP,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = load();

export function getAISettings(): AISettings {
  return current;
}

export function setAISettings(patch: Partial<AISettings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
  for (const l of listeners) l();
}

export function useAISettings(): AISettings {
  const [value, setValue] = useState(current);
  useEffect(() => {
    const l = () => setValue(current);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return value;
}
