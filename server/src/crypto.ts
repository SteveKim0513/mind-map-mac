import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const INVITE_CODE_LENGTH = 8;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function newId(): string {
  return randomBytes(12).toString('base64url');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function newInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function normalizeInviteCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (code.length !== INVITE_CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}
