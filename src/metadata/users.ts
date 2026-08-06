import { JsonStore } from './json-store.js';
import { uuid } from '../lib/ids.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import type { UserInfo, Role } from '../types.js';

interface UsersFile { users: Record<string, UserInfo>; }

export class UsersRepo {
  constructor(private store: JsonStore<UsersFile>) {}

  async seedAdmin(password: string): Promise<void> {
    const existing = Object.values(this.store.snapshot.users).find(u => u.username === 'admin');
    if (existing) return;
    await this.store.mutate(d => {
      d.users[uuid()] = {
        id: '', username: 'admin', role: 'admin',
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(), lastLoginAt: null
      };
    });
    // fix id
    await this.store.mutate(d => {
      for (const [id, u] of Object.entries(d.users)) if (u.id === '') u.id = id;
    });
  }

  list(): Omit<UserInfo, 'passwordHash'>[] {
    return Object.values(this.store.snapshot.users).map(({ passwordHash: _ph, ...rest }) => rest);
  }

  findByUsername(username: string): UserInfo | undefined {
    return Object.values(this.store.snapshot.users).find(u => u.username === username);
  }

  get(id: string): UserInfo | undefined { return this.store.snapshot.users[id]; }

  verify(username: string, password: string): UserInfo | null {
    const user = this.findByUsername(username);
    if (!user || !verifyPassword(password, user.passwordHash)) return null;
    return user;
  }

  async create(username: string, password: string, role: Role): Promise<UserInfo> {
    if (this.findByUsername(username)) throw Object.assign(new Error('username exists'), { statusCode: 409 });
    const id = uuid();
    const user: UserInfo = {
      id, username, role, passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(), lastLoginAt: null
    };
    await this.store.mutate(d => { d.users[id] = user; });
    return user;
  }

  async update(id: string, patch: { role?: Role; password?: string }): Promise<UserInfo | null> {
    return this.store.mutate(d => {
      const u = d.users[id];
      if (!u) return null;
      if (patch.role) u.role = patch.role;
      if (patch.password) u.passwordHash = hashPassword(patch.password);
      return u;
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.store.mutate(d => {
      if (!d.users[id]) return false;
      delete d.users[id];
      return true;
    });
  }

  async touchLogin(id: string): Promise<void> {
    await this.store.mutate(d => { if (d.users[id]) d.users[id].lastLoginAt = new Date().toISOString(); });
  }

  adminCount(): number {
    return Object.values(this.store.snapshot.users).filter(u => u.role === 'admin').length;
  }
}