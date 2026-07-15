import { TAG_KEYS, tagVar } from '../theme/palette';

/** One color-picking grid, shared by every place a node/selection color can be
 *  set (canvas context menu, selection toolbar) — UX-CLARITY-VISION 전략 G:
 *  "이 색은 앱 전체에서 이 의미로만 쓴다"는 계약을 컴포넌트 수준까지 확장한
 *  것으로, 이전엔 두 벌의 독립 구현(ctx-colors/st-swatches)이 있어 하나는
 *  현재 색을 링으로 보여주고 하나는 안 보여주는 등 미묘하게 달랐다. */
export function ColorSwatchGrid({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (color: string | undefined) => void;
}) {
  return (
    <div className="color-swatch-grid">
      {TAG_KEYS.map((c) => (
        <button
          key={c}
          className={`color-swatch${value === c ? ' on' : ''}`}
          style={{ background: tagVar(c), ['--sw' as string]: tagVar(c) }}
          onClick={() => onChange(value === c ? undefined : c)}
        />
      ))}
      <button
        className={`color-swatch none${!value ? ' on' : ''}`}
        title="색 제거"
        onClick={() => onChange(undefined)}
      />
    </div>
  );
}
