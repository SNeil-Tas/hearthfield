import { decode, encode, type SaveEnvelope } from './serialization';
import type { World } from '../sim/types';
const MIRROR = 'hearthfield-recovery-v1';
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
function completed(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Save transaction aborted.'));
  });
}
async function openDatabase() {
  const r = indexedDB.open('hearthfield', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('saves');
  return new Promise<IDBDatabase>((resolve, reject) => {
    let abandoned = false;
    const fail = (error: Error) => {
      abandoned = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('Local database timed out.')), 5000);
    r.onblocked = () => fail(new Error('Another tab is blocking the database.'));
    r.onerror = () => fail(r.error ?? new Error('Could not open local database.'));
    r.onsuccess = () => {
      clearTimeout(timer);
      if (abandoned) {
        r.result.close();
        return;
      }
      r.result.onversionchange = () => r.result.close();
      resolve(r.result);
    };
  });
}
export class SaveStore {
  private database: Promise<IDBDatabase> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private db() {
    return (this.database ??= openDatabase().catch((error) => {
      this.database = null;
      throw error;
    }));
  }
  async load() {
    const raw: unknown[] = [];
    const warnings: string[] = [];
    let databaseUnavailable = false;
    let mirrorUnreadable = false;
    try {
      const mirror = localStorage.getItem(MIRROR);
      if (mirror) raw.push(JSON.parse(mirror));
    } catch {
      mirrorUnreadable = true;
      warnings.push('Recovery copy could not be read.');
    }
    try {
      const db = await this.db();
      const tx = db.transaction('saves', 'readonly');
      const values = await request(tx.objectStore('saves').getAll());
      raw.push(...values);
    } catch {
      databaseUnavailable = true;
      warnings.push('Local database unavailable. Export your colony to keep a backup.');
    }
    const candidates: ReturnType<typeof decode>[] = [];
    for (const value of raw) {
      try {
        candidates.push(decode(value));
      } catch {
        warnings.push('An unreadable save was skipped.');
      }
    }
    candidates.sort((a, b) => b.savedAt - a.savedAt);
    if (raw.length && !candidates.length)
      throw new Error(
        'Existing saves could not be read. They have been preserved; start a new colony explicitly to replace them.',
      );
    if (!candidates.length && (databaseUnavailable || mirrorUnreadable))
      throw new Error(
        'Local storage could not be read safely. Existing saves are protected. Reload to retry, or explicitly start a new colony.',
      );
    return { world: candidates[0]?.world ?? null, warnings };
  }
  save(world: World, mirror = false) {
    const envelope = encode(world);
    if (mirror) {
      try {
        localStorage.setItem(MIRROR, JSON.stringify(envelope));
      } catch {
        /* IndexedDB is primary; its error is surfaced to the player. */
      }
    }
    this.queue = this.queue.catch(() => undefined).then(() => this.write(envelope));
    return this.queue;
  }
  private async write(envelope: SaveEnvelope) {
    const db = await this.db();
    const tx = db.transaction('saves', 'readwrite');
    const done = completed(tx);
    const store = tx.objectStore('saves');
    const previous = store.get('latest');
    previous.onsuccess = () => {
      if (previous.result) store.put(previous.result, 'backup');
      store.put(envelope, 'latest');
    };
    await done;
  }
}
