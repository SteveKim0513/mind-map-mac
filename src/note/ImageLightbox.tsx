import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

let _show: ((src: string) => void) | null = null;

export function openLightbox(src: string) {
  _show?.(src);
}

export function ImageLightbox() {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    _show = setSrc;
    return () => {
      if (_show === setSrc) _show = null;
    };
  }, [setSrc]);

  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSrc(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [src]);

  if (!src) return null;

  return createPortal(
    <div className="lightbox-overlay" onClick={() => setSrc(null)}>
      <img src={src} alt="" className="lightbox-image" onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body,
  );
}
