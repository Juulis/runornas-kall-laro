import { assetUrl } from '../core/assets';
import bundledManifest from '../data/voice_manifest.json';
import type { SpeakLang } from './types';

/** Katalog under public/assets där färdiga röstfiler ligger. */
export const VOICE_DIR = 'voice';

export interface VoiceClip {
  id: string;
  lang: SpeakLang;
  text: string;
  file: string;
  bytes?: number;
}

export interface VoiceManifest {
  version: number;
  format: 'mp3';
  voices: Partial<Record<SpeakLang, string>>;
  rate?: string;
  clips: VoiceClip[];
}

export function normalizeSpeakText(text: string): string {
  return text.trim();
}

/** Nyckel för uppslag i manifestet. Samma text och språk ger samma klipp. */
export function clipKey(lang: string, text: string): string {
  return `${lang}|${normalizeSpeakText(text)}`;
}

export function voiceManifestUrl(): string {
  return assetUrl(`${VOICE_DIR}/manifest.json`);
}

export function voiceClipUrl(file: string): string {
  return assetUrl(`${VOICE_DIR}/${file}`);
}

const bundled = bundledManifest as VoiceManifest;

let loaded: VoiceManifest | null = bundled;
let lookup: Map<string, VoiceClip> | null = null;
let pending: Promise<VoiceManifest | null> | null = null;

function clips(): Map<string, VoiceClip> {
  if (!lookup) lookup = indexManifest(loaded);
  return lookup;
}

function indexManifest(manifest: VoiceManifest | null): Map<string, VoiceClip> {
  const map = new Map<string, VoiceClip>();
  if (!manifest) return map;
  for (const clip of manifest.clips) {
    map.set(clipKey(clip.lang, clip.text), clip);
  }
  return map;
}

/** Test: sätt eller nollställ manifestet utan nätverk. */
export function setVoiceManifestForTests(manifest: VoiceManifest | null): void {
  loaded = manifest;
  lookup = indexManifest(manifest);
  pending = Promise.resolve(manifest);
}

/** Test: glöm cache så nästa loadVoiceManifest hämtar igen. */
export function resetVoiceManifestForTests(): void {
  loaded = bundled;
  lookup = indexManifest(bundled);
  pending = Promise.resolve(bundled);
}

/** Manifestet följer med bundlen, så uppslag är synkront och uppspelning kan starta i samma klick. */
export function loadVoiceManifest(): Promise<VoiceManifest | null> {
  if (!pending) pending = Promise.resolve(loaded);
  return pending;
}

/** Synkront uppslag i det inbyggda (eller test-överstyrda) manifestet. */
export function lookupVoiceClip(lang: string, text: string): VoiceClip | null {
  return clips().get(clipKey(lang, text)) ?? null;
}

/** Laddar manifestet vid behov och slår upp klippet. */
export async function findVoiceClip(lang: string, text: string): Promise<VoiceClip | null> {
  await loadVoiceManifest();
  return lookupVoiceClip(lang, text);
}

export function hasLoadedVoiceManifest(): boolean {
  return loaded !== null;
}

/** Sant när minst ett färdigt klipp finns. Tomt eller avstängt manifest räknas inte. */
export function hasVoiceClips(): boolean {
  return (loaded?.clips.length ?? 0) > 0;
}
