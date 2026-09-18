/** Hold a writer lock for the life of this page. Browsers release it on navigation. */
export async function acquireWriter(): Promise<boolean> {
  if (!navigator.locks) return true; // HTTP LAN origins may not expose Web Locks.
  return new Promise<boolean>((resolve) => {
    void navigator.locks
      .request('hearthfield-writer', { ifAvailable: true }, async (lock) => {
        resolve(!!lock);
        if (lock) await new Promise<void>(() => {});
      })
      .catch(() => resolve(false));
  });
}
