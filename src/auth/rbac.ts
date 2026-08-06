import type { Role, Scope } from '../types.js';

export const ROLE_RANK: Record<Role, number> = { viewer: 1, uploader: 2, editor: 3, admin: 4 };

export function hasMinRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function scopeAllows(scopes: Scope[] | undefined, needed: Scope, role: Role): boolean {
  if (role === 'admin') return true;
  if (!scopes) return true;
  return scopes.includes(needed);
}