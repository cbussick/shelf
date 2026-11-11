import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';
import { colors } from '../app.stylex';

const easeInOut = 'cubic-bezier(0.77, 0, 0.175, 1)';
const float = stylex.keyframes({
  '0%': { transform: 'translateY(0) rotate(-3deg)' },
  '50%': { transform: 'translateY(-2px) rotate(3deg)' },
  '100%': { transform: 'translateY(0) rotate(-3deg)' },
});
const breathe = stylex.keyframes({
  '0%': { opacity: 1 },
  '50%': { opacity: 0.55 },
  '100%': { opacity: 1 },
});
const sweep = stylex.keyframes({
  '0%': { transform: 'translateX(-100%)' },
  '80%': { transform: 'translateX(100%)' },
  '100%': { transform: 'translateX(100%)' },
});

const styles = stylex.create({
  brand: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 },
  mark: { width: 88, height: 88, overflow: 'visible' },
  note: {
    transformOrigin: '20px 24px', animationName: float, animationDuration: '3.2s',
    animationTimingFunction: easeInOut, animationIterationCount: 'infinite',
  },
  ink: {
    animationName: breathe, animationDuration: '3.2s',
    animationTimingFunction: easeInOut, animationIterationCount: 'infinite',
  },
  secondLine: { animationDelay: '160ms' },
  label: { display: 'block', width: 160, height: 26, fontSize: 16, fontWeight: 400 },
  shimmer: {
    transform: 'translateX(-100%)', animationName: sweep, animationDuration: '3.2s',
    animationTimingFunction: 'linear', animationIterationCount: 'infinite',
  },
});

// Motion belongs only to initial startup. Global reduced-motion CSS disables all
// animations, leaving the readable base text and an intact, static mark.
export function LoadingBrand() {
  const id = useId();
  const clipId = `${id}-loading-text`;
  const highlightId = `${id}-loading-highlight`;
  return <div role="status" aria-live="polite" aria-busy="true" {...stylex.props(styles.brand)}>
    <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false" {...stylex.props(styles.mark)}>
      <g {...stylex.props(styles.note)}>
        <rect x="3" y="3" width="34" height="34" rx="9" fill="#f4d467"/>
        <path d="M25 37V30q0-5 5-5h7" fill="#d6b650"/>
        <path d="M12 15h15" fill="none" stroke="#786523" strokeWidth="2.5" strokeLinecap="round" {...stylex.props(styles.ink)}/>
        <path d="M12 22h10" fill="none" stroke="#786523" strokeWidth="2.5" strokeLinecap="round" {...stylex.props(styles.ink, styles.secondLine)}/>
      </g>
    </svg>
    <svg viewBox="0 0 160 26" aria-hidden="true" focusable="false" {...stylex.props(styles.label)}>
      <defs>
        <clipPath id={clipId}><text x="80" y="19" textAnchor="middle">Opening Shelf…</text></clipPath>
        <linearGradient id={highlightId}>
          <stop offset="0.25" stopColor="#b0c7b8" stopOpacity="0"/>
          <stop offset="0.5" stopColor="#b0c7b8"/>
          <stop offset="0.75" stopColor="#b0c7b8" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <text x="80" y="19" textAnchor="middle" fill={colors.ink}>Opening Shelf…</text>
      <g clipPath={`url(#${clipId})`}><rect width="160" height="26" fill={`url(#${highlightId})`} {...stylex.props(styles.shimmer)}/></g>
    </svg>
    <h1 className="sr-only">Opening Shelf…</h1>
  </div>;
}
