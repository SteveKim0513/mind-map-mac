// 공유 노트 사이드카(`.mindshare/<noteId>.yjs`)의 봉투 형식 — 외부 입력 경계.
//
//   { v: 1, update, baseUpdate, mdHash }
//     update      현재 Y 상태 (Y.encodeStateAsUpdate)
//     baseUpdate  마지막으로 md 파일을 쓴 시점의 Y 상태 — 외부 수정을 3-way로 흡수할 때의 기준. 아직 없으면 null.
//     mdHash      마지막으로 쓴(또는 흡수한) md 파일 바이트의 해시 — 자기 쓰기를 외부 수정으로 오인하지 않게.
//
// 바이너리 인코딩(빅엔디언):  'MNE1'(4) | v(1) | flags(1: bit0=baseUpdate 있음) | hashLen(2) | hash(ascii) |
//                            baseLen(4) | updateLen(4) | baseUpdate | update
// decode는 던지지 않는다 — 형식이 어긋나거나 잘렸으면 null(호출자는 사이드카가 없는 것으로 취급).

export interface NoteEnvelope {
  v: 1;
  update: Uint8Array;
  baseUpdate: Uint8Array | null;
  mdHash: string;
}

const MAGIC = [0x4d, 0x4e, 0x45, 0x31]; // "MNE1"
const HEADER = 4 + 1 + 1 + 2;
const MAX_HASH_LEN = 128;
const HASH_RE = /^[0-9a-z:_-]{0,128}$/;

export function encodeNoteEnvelope(env: NoteEnvelope): Uint8Array {
  const hash = new TextEncoder().encode(env.mdHash);
  if (hash.length > MAX_HASH_LEN || !HASH_RE.test(env.mdHash)) throw new Error('invalid mdHash');
  const base = env.baseUpdate ?? new Uint8Array(0);
  const out = new Uint8Array(HEADER + hash.length + 8 + base.length + env.update.length);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[4] = env.v;
  out[5] = env.baseUpdate ? 1 : 0;
  view.setUint16(6, hash.length);
  out.set(hash, HEADER);
  let o = HEADER + hash.length;
  view.setUint32(o, base.length);
  view.setUint32(o + 4, env.update.length);
  o += 8;
  out.set(base, o);
  out.set(env.update, o + base.length);
  return out;
}

export function decodeNoteEnvelope(bytes: unknown): NoteEnvelope | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < HEADER + 8) return null;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) return null;
  if (bytes[4] !== 1) return null;
  const hasBase = (bytes[5] & 1) === 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hashLen = view.getUint16(6);
  if (hashLen > MAX_HASH_LEN || bytes.length < HEADER + hashLen + 8) return null;
  const mdHash = new TextDecoder().decode(bytes.subarray(HEADER, HEADER + hashLen));
  if (!HASH_RE.test(mdHash)) return null;
  let o = HEADER + hashLen;
  const baseLen = view.getUint32(o);
  const updateLen = view.getUint32(o + 4);
  o += 8;
  if (bytes.length !== o + baseLen + updateLen) return null;
  if (!hasBase && baseLen !== 0) return null;
  // 복사본을 돌려준다 — 원본 버퍼(IPC 응답)를 붙잡고 있지 않게.
  const baseUpdate = hasBase ? bytes.slice(o, o + baseLen) : null;
  const update = bytes.slice(o + baseLen, o + baseLen + updateLen);
  return { v: 1, update, baseUpdate, mdHash };
}

/** 파일 바이트 문자열의 빠른 비암호 해시(cyrb53 → 16자리 hex). 자기 쓰기·변경 감지 전용 — 보안 용도 아님. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0') + text.length.toString(16);
}
