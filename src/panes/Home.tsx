import type { RecentFile } from '../store/sessionStore';

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '방금 전';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return `${Math.floor(d / 7)}주 전`;
}

interface Props {
  recent: RecentFile[];
  onNew: () => void;
  onOpenRecent: (path: string) => void;
}

export function Home({ recent, onNew, onOpenRecent }: Props) {
  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-brand">MindMap</div>
        <div className="home-tagline">생각을 잇고, 펼치는 가장 빠른 방법.</div>

        <button className="home-new" onClick={onNew}>
          ＋ 새 마인드맵
        </button>

        <div className="home-section">최근 파일</div>
        {recent.length === 0 ? (
          <div className="home-empty">아직 연 파일이 없습니다. 새 마인드맵으로 시작하세요.</div>
        ) : (
          <div className="recent-list">
            {recent.map((r) => (
              <button key={r.path} className="recent-item" onClick={() => onOpenRecent(r.path)}>
                <span className="recent-icon">🗂</span>
                <span className="recent-name">{r.name}</span>
                <span className="recent-time">{ago(r.ts)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
