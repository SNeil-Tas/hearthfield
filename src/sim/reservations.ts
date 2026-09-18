export class Reservations {
  private owners = new Map<string, string>();
  available(keys: string[], owner: string) {
    return keys.every((k) => !this.owners.has(k) || this.owners.get(k) === owner);
  }
  claim(keys: string[], owner: string) {
    if (!this.available(keys, owner)) return false;
    keys.forEach((k) => this.owners.set(k, owner));
    return true;
  }
  release(owner: string) {
    for (const [key, value] of this.owners) if (value === owner) this.owners.delete(key);
  }
  owner(key: string) {
    return this.owners.get(key);
  }
  get size() {
    return this.owners.size;
  }
}
