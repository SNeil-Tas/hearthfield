export class Reservations {
  private owners = new Map<string, string>();
  constructor(private readonly onChange?: (action: string, key: string, owner: string) => void) {}
  available(keys: string[], owner: string) {
    return keys.every((k) => !this.owners.has(k) || this.owners.get(k) === owner);
  }
  claim(keys: string[], owner: string) {
    if (!this.available(keys, owner)) return false;
    keys.forEach((k) => {
      this.owners.set(k, owner);
      this.onChange?.('acquired', k, owner);
    });
    return true;
  }
  release(owner: string) {
    for (const [key, value] of this.owners)
      if (value === owner) {
        this.owners.delete(key);
        this.onChange?.('released', key, owner);
      }
  }
  releaseKey(key: string, owner: string) {
    if (this.owners.get(key) === owner) {
      this.owners.delete(key);
      this.onChange?.('released', key, owner);
    }
  }
  owner(key: string) {
    return this.owners.get(key);
  }
  get size() {
    return this.owners.size;
  }
  snapshot() {
    return [...this.owners.entries()].map(([key, owner]) => ({ key, owner }));
  }
}
