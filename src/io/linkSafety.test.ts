import { describe, expect, it } from 'vitest';
import { isAllowedExternalProtocol, isPathInsideRoot, safeExternalUrl, safeRelativeLinkPath } from './linkSafety';

describe('isAllowedExternalProtocol — 허용 스킴은 http·https·mailto뿐', () => {
  it.each(['http://example.com', 'https://example.com/a?b=1#c', 'mailto:a@b.co', 'HTTPS://EXAMPLE.COM', 'https:example.com'])('허용: %s', (u) => {
    expect(isAllowedExternalProtocol(u)).toBe(true);
  });

  it.each([
    'file:///etc/passwd',
    'smb://host/share',
    'ssh://user@host',
    'ftp://host/x',
    'tel:+8210',
    'sms:+8210',
    'x-apple-reminder://ABC',
    'vscode://file/etc',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'blob:https://a/b',
    'about:blank',
  ])('거부: %s', (u) => {
    expect(isAllowedExternalProtocol(u)).toBe(false);
  });

  it('우회 시도(대소문자·앞 공백·제어문자·탭/개행 삽입)도 정규화된 스킴 기준으로 거부한다', () => {
    for (const u of [
      'JavaScript:alert(1)',
      'JAVASCRIPT:alert(1)',
      '  file:///etc/passwd',
      '\tfile:///etc/passwd',
      '\nfile:///etc/passwd',
      '\u0001javascript:alert(1)',
      '\u0000javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'jav&#x09;ascript:alert(1)',
      ' data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:x',
      'FILE:///x',
    ]) {
      expect(isAllowedExternalProtocol(u), JSON.stringify(u)).toBe(false);
    }
  });

  it('파싱 실패·상대 경로·문자열이 아닌 값·빈 값은 거부한다', () => {
    for (const u of ['', ' ', 'example.com', '//evil.com/x', '/etc/passwd', '../x', '#frag', 'http://', undefined, null, 42, {}, ['https://a.co']]) {
      expect(isAllowedExternalProtocol(u), String(u)).toBe(false);
    }
  });
});

describe('safeExternalUrl — 저장값 검증(더 엄격)', () => {
  it('안전한 URL은 앞뒤 공백만 자른 문자열로 돌려준다', () => {
    expect(safeExternalUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeExternalUrl('  https://example.com/a  ')).toBe('https://example.com/a');
    expect(safeExternalUrl('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(safeExternalUrl('https://예제.한국/경로')).toBe('https://예제.한국/경로');
  });

  it('스킴 우회는 null', () => {
    for (const u of [
      'JavaScript:alert(1)',
      '  file:///etc/passwd',
      'java\tscript:alert(1)',
      '\u0001data:text/html,x',
      'vbscript:x',
      'data:text/html,x',
      'file:///x',
      'smb://h/s',
      'ssh://h',
    ]) {
      expect(safeExternalUrl(u), JSON.stringify(u)).toBeNull();
    }
  });

  it('허용 스킴이어도 제어·서식 문자(탭·개행·제로폭·방향 제어)가 섞이면 거부한다', () => {
    expect(safeExternalUrl('https://exa\tmple.com')).toBeNull();
    expect(safeExternalUrl('https://example.com/\nfoo')).toBeNull();
    expect(safeExternalUrl('https://example\u200b.com')).toBeNull();
    expect(safeExternalUrl('https://example.com/\u202efdp.exe')).toBeNull();
    expect(safeExternalUrl('https://example.com/\u0000')).toBeNull();
  });

  it('길이 상한·문자열이 아닌 값·스킴 없는 문자열은 거부한다', () => {
    expect(safeExternalUrl('https://example.com/' + 'a'.repeat(2100))).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(123)).toBeNull();
    expect(safeExternalUrl({ href: 'https://a.co' })).toBeNull();
    expect(safeExternalUrl('example.com')).toBeNull();
    expect(safeExternalUrl('')).toBeNull();
    expect(safeExternalUrl('   ')).toBeNull();
  });
});

describe('safeRelativeLinkPath — 문서 링크 힌트는 안전한 상대 경로만', () => {
  it('일반 상대 경로는 그대로 통과', () => {
    expect(safeRelativeLinkPath('노트.md', '.md')).toBe('노트.md');
    expect(safeRelativeLinkPath('팀/회의/메모 1.md', '.md')).toBe('팀/회의/메모 1.md');
    expect(safeRelativeLinkPath('a/b.mind', '.mind')).toBe('a/b.mind');
  });

  it('절대 경로·홈·스킴·드라이브 문자는 거부', () => {
    for (const p of ['/Users/x/a.md', '~/a.md', 'file:///a.md', 'C:/a.md', 'c:\\a.md', 'https://x.co/a.md', '\\\\host\\share\\a.md']) {
      expect(safeRelativeLinkPath(p, '.md'), p).toBeNull();
    }
  });

  it('`..`·`.`·숨김·빈 세그먼트·역슬래시는 거부(퍼센트 인코딩 우회 포함)', () => {
    for (const p of ['../a.md', 'a/../b.md', 'a/./b.md', './a.md', '.hidden/a.md', 'a/.b.md', 'a//b.md', '%2e%2e/a.md', 'a/%2E%2E/b.md', '..%2fa.md', 'a\\b.md', '%2fetc/a.md', 'a%00.md']) {
      expect(safeRelativeLinkPath(p, '.md'), p).toBeNull();
    }
  });

  it('제어문자·확장자 불일치·문자열이 아닌 값·너무 긴 경로는 거부', () => {
    expect(safeRelativeLinkPath('a\n.md', '.md')).toBeNull();
    expect(safeRelativeLinkPath('a.mind', '.md')).toBeNull();
    expect(safeRelativeLinkPath('a.md', '.mind')).toBeNull();
    expect(safeRelativeLinkPath(undefined, '.md')).toBeNull();
    expect(safeRelativeLinkPath(5, '.md')).toBeNull();
    expect(safeRelativeLinkPath('a/'.repeat(600) + 'b.md', '.md')).toBeNull();
    expect(safeRelativeLinkPath('', '.md')).toBeNull();
  });
});

describe('isPathInsideRoot — 열기 직전 마지막 방어선', () => {
  const root = '/Users/me/MindMaps';
  it('워크스페이스 안의 지정 확장자 파일만 통과', () => {
    expect(isPathInsideRoot(root, `${root}/a.md`, '.md')).toBe(true);
    expect(isPathInsideRoot(root, `${root}/팀/회의 메모.md`, '.md')).toBe(true);
    expect(isPathInsideRoot(`${root}/`, `${root}/a.mind`, '.mind')).toBe(true);
    expect(isPathInsideRoot(root, `${root}/.templates/t.md`, '.md')).toBe(true); // 숨김 폴더 자체는 허용(로컬 기능)
  });
  it('루트 밖·접두만 같은 형제 폴더·`..`·확장자 불일치·제어문자·빈 루트는 거부', () => {
    for (const p of ['/etc/passwd.md', '/Users/me/.ssh/config.md', `${root}-evil/a.md`, `${root}/../secret.md`, `${root}/a/../../x.md`, `${root}/./a.md`, `${root}//a.md`, `${root}/a.txt`, `${root}/a\u0000.md`, 'a.md', 'file:///x.md']) {
      expect(isPathInsideRoot(root, p, '.md'), p).toBe(false);
    }
    expect(isPathInsideRoot('', `${root}/a.md`, '.md')).toBe(false);
    expect(isPathInsideRoot(root, undefined, '.md')).toBe(false);
    expect(isPathInsideRoot(root, `${root}/a.md`, '.mind')).toBe(false);
  });
});
