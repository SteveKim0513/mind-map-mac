import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import type { Logger } from './logger.js';

/**
 * IP를 제한 키로 정규화한다. IPv6는 /64(가정용·모바일 사업자가 사용자에게 주는 최소 단위)로 묶어
 * 같은 /64 안에서 주소를 바꿔가며 IP별 제한을 우회하지 못하게 한다. IPv4-mapped IPv6는 IPv4로 본다.
 * IP 형식이 아니면 null.
 */
export function normalizeIp(raw: string): string | null {
  let text = raw.trim();
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(text);
  if (bracket?.[1]) text = bracket[1];
  const v4port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(text);
  if (v4port?.[1]) text = v4port[1];
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(text);
  if (mapped?.[1]) text = mapped[1];

  const family = isIP(text);
  if (family === 4) return text;
  if (family !== 6) return null;

  let value = text.toLowerCase();
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    value = `${value.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  let groups: string[];
  if (value.includes('::')) {
    const [head = '', rest = ''] = value.split('::');
    const left = head ? head.split(':') : [];
    const right = rest ? rest.split(':') : [];
    groups = [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  } else {
    groups = value.split(':');
  }
  if (groups.length !== 8) return null;
  return `${groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g, 16).toString(16))
    .join(':')}::/64`;
}

export type ClientIpResolver = (req: IncomingMessage) => string;

/**
 * 클라이언트 IP(제한 키). 프록시를 `hops`단 신뢰하면 `X-Forwarded-For`의 **오른쪽에서 hops번째** 항목을 쓴다
 * (왼쪽 항목은 클라이언트가 위조할 수 있고, 신뢰 프록시가 덧붙인 항목만 믿을 수 있다).
 * 항목이 없거나 IP가 아니면 소켓 IP로 대체하고 경고 이벤트를 남긴다(IP 원문은 기록하지 않는다) —
 * 이 경로가 반복되면 프록시 단수 설정이 틀렸거나 프록시를 우회한 접속이라는 신호다.
 */
export function createClientIpResolver(hops: number, log: Logger): ClientIpResolver {
  let lastWarnAt = 0;
  const warn = (reason: string) => {
    const at = Date.now();
    if (at - lastWarnAt < 60_000) return;
    lastWarnAt = at;
    log('xff.fallback', { reason });
  };

  return (req) => {
    const socketIp = normalizeIp(req.socket.remoteAddress ?? '') ?? 'unknown';
    if (hops <= 0) return socketIp;
    const header = req.headers['x-forwarded-for'];
    const chain = (Array.isArray(header) ? header.join(',') : (header ?? ''))
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (chain.length < hops) {
      warn(chain.length === 0 ? 'missing' : 'short_chain');
      return socketIp;
    }
    const picked = normalizeIp(chain[chain.length - hops] ?? '');
    if (!picked) {
      warn('invalid_entry');
      return socketIp;
    }
    return picked;
  };
}
