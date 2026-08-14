import React, { useRef, useState, useEffect } from 'react';

interface ScrollRowProps {
  title?: string;
  seeAllLabel?: string;
  onSeeAll?: () => void;
  accent?: string;
  children: React.ReactNode;
}

const ScrollRow: React.FC<ScrollRowProps> = ({ title, seeAllLabel = 'See All', onSeeAll, accent, children }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  const updateArrows = () => {
    const el = scrollRef.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > 8);
    setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  };

  useEffect(() => {
    updateArrows();
    window.addEventListener('resize', updateArrows);
    return () => window.removeEventListener('resize', updateArrows);
  }, [children]);

  const scroll = (dir: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <div>
      {(title || onSeeAll) && (
        <div className="flex items-center justify-between px-1 mb-3">
          {title ? (
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 rounded-full" style={{ backgroundColor: accent || 'var(--row-accent, #FF6347)' }} />
              <h2 className="text-white text-lg font-bold tracking-tight">{title}</h2>
            </div>
          ) : <span />}
          {onSeeAll && (
            <button
              onClick={onSeeAll}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium text-white/50 hover:text-white transition"
              style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
              {seeAllLabel}
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      )}

      <div className="relative group/row">
        {showLeft && (
          <button
            onClick={() => scroll(-1)}
            aria-label="Scroll left"
            className="absolute left-0 top-0 bottom-0 z-20 w-10 flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
            style={{ background: 'linear-gradient(to right, #0a0a0a 30%, rgba(10,10,10,0))' }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center glass-card">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 19l-7-7 7-7" />
              </svg>
            </div>
          </button>
        )}
        {showRight && (
          <button
            onClick={() => scroll(1)}
            aria-label="Scroll right"
            className="absolute right-0 top-0 bottom-0 z-20 w-10 flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
            style={{ background: 'linear-gradient(to left, #0a0a0a 30%, rgba(10,10,10,0))' }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center glass-card">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        )}
        <div
          ref={scrollRef}
          onScroll={updateArrows}
          className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 px-1">
          {children}
        </div>
      </div>
    </div>
  );
};

export default ScrollRow;
