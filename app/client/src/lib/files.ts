/**
 * Bridge to the Electron preload IPC API (window.timetrackFiles).
 * In a browser context (dev without Electron) these functions are no-ops.
 */

export interface FileEntry {
  name: string;
  path: string;
}

interface TimetrackFilesAPI {
  list:   () => Promise<FileEntry[]>;
  switch: (path: string) => Promise<{ ok?: boolean; error?: string; canceled?: boolean; active?: FileEntry }>;
  create: (name: string) => Promise<{ ok?: boolean; error?: string; canceled?: boolean; active?: FileEntry }>;
  open:   () => Promise<{ ok?: boolean; error?: string; canceled?: boolean; active?: FileEntry }>;
}

function getApi(): TimetrackFilesAPI | null {
  return (window as any).timetrackFiles ?? null;
}

export async function listFiles(): Promise<FileEntry[]> {
  return (await getApi()?.list()) ?? [];
}

export async function switchFile(path: string) {
  return getApi()?.switch(path) ?? { error: 'Not running in Electron' };
}

export async function createFile(name: string) {
  return getApi()?.create(name) ?? { error: 'Not running in Electron' };
}

export async function openFile() {
  return getApi()?.open() ?? { error: 'Not running in Electron' };
}

export function isElectron(): boolean {
  return !!(window as any).timetrackFiles;
}
