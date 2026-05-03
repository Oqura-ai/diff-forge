// frontend/lib/persistence.ts
import type { Dataset, DatasetFile, MediaType } from './dataset';

const DB_NAME = 'vdm-db';
const DB_VERSION = 1;
const FILES_STORE = 'files';
const META_KEY = 'vdm-datasets';

interface FileMeta {
  id: string;
  name: string;
  type: MediaType;
  caption: string | null;
  splits?: number[];
  validation?: DatasetFile['validation'];
  originalFileName: string;
}

interface DatasetMeta {
  id: string;
  name: string;
  description: string;
  targetModel: string;
  createdAt: string;
  issues: Dataset['issues'];
  files: FileMeta[];
  triggerWord?: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(FILES_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readwrite');
    const req = tx.objectStore(FILES_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readwrite');
    const req = tx.objectStore(FILES_STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Remove a dataset's files from IndexedDB and revoke their blob URLs. */
export async function purgeDatasetFiles(fileIds: string[], mediaUrls: string[]): Promise<void> {
  try {
    mediaUrls.forEach(url => { try { URL.revokeObjectURL(url); } catch {} });
    const db = await openDB();
    for (const id of fileIds) await idbDelete(db, id);
  } catch (e) {
    console.warn('[persistence] purge failed:', e);
  }
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readonly');
    const req = tx.objectStore(FILES_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDatasets(datasets: Dataset[]): Promise<void> {
  try {
    const db = await openDB();

    for (const ds of datasets) {
      for (const f of ds.files) {
        await idbPut(db, f.id, f.file);
      }
    }

    const meta: DatasetMeta[] = datasets.map(ds => ({
      id: ds.id,
      name: ds.name,
      description: ds.description,
      targetModel: ds.targetModel,
      createdAt: ds.createdAt.toISOString(),
      triggerWord: ds.triggerWord,
      issues: ds.issues,
      files: ds.files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.type,
        caption: f.caption,
        splits: f.splits,
        validation: f.validation,
        originalFileName: f.file.name,
      })),
    }));

    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch (e) {
    console.warn('[persistence] save failed:', e);
  }
}

export async function loadDatasets(): Promise<Dataset[]> {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return [];
    const metaList: DatasetMeta[] = JSON.parse(raw);
    const db = await openDB();
    const result: Dataset[] = [];

    for (const dm of metaList) {
      const files: DatasetFile[] = [];
      for (const fm of dm.files) {
        const file = await idbGet<File>(db, fm.id);
        if (!file) continue;
        files.push({
          id: fm.id,
          name: fm.name,
          type: fm.type,
          file,
          caption: fm.caption,
          splits: fm.splits,
          validation: fm.validation,
          mediaUrl: URL.createObjectURL(file),
        });
      }
      if (files.length === 0 && dm.files.length > 0) continue;
      result.push({
        id: dm.id,
        name: dm.name,
        description: dm.description,
        targetModel: dm.targetModel as Dataset['targetModel'],
        createdAt: new Date(dm.createdAt),
        triggerWord: dm.triggerWord,
        files,
        issues: dm.issues,
      });
    }

    return result;
  } catch (e) {
    console.warn('[persistence] load failed:', e);
    return [];
  }
}
