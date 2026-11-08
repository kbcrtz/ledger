// 16px icons in the spirit of GitHub's Octicons. Each one encodes a state, not decoration.
type P = { className?: string; title?: string };

function Svg({ className, title, children }: P & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" className={`shrink-0 ${className ?? ""}`}
      role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export const CheckCircle = (p: P) => (
  <Svg {...p}><circle cx="8" cy="8" r="7.25" /><path d="M4.75 8.25 7 10.5l4.25-4.75" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></Svg>
);
export const XCircle = (p: P) => (
  <Svg {...p}><circle cx="8" cy="8" r="7.25" /><path d="m5.5 5.5 5 5m0-5-5 5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></Svg>
);
export const DotCircle = (p: P) => (
  <Svg {...p}><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="8" cy="8" r="2.75" /></Svg>
);
export const EmptyCircle = (p: P) => (
  <Svg {...p}><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.6 2.2" /></Svg>
);
export const Shield = (p: P) => (
  <Svg {...p}><path d="M8 .9 14 3v4.6c0 3.7-2.6 6.4-6 7.5-3.4-1.1-6-3.8-6-7.5V3z" /><path d="M5.2 8.1 7.2 10l3.6-4" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></Svg>
);
export const NotEqual = (p: P) => (
  <Svg {...p}><circle cx="8" cy="8" r="7.25" /><path d="M5 6.6h6M5 9.4h6M9.6 4.6 6.4 11.4" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" /></Svg>
);
export const Bug = (p: P) => (
  <Svg {...p}><path d="M5.5 3.2a2.5 2.5 0 0 1 5 0V4h.5A1.5 1.5 0 0 1 12.5 5.5v.75h1.75a.75.75 0 0 1 0 1.5H12.5v1h1.75a.75.75 0 0 1 0 1.5H12.4A4.5 4.5 0 0 1 3.6 10.25H1.75a.75.75 0 0 1 0-1.5H3.5v-1H1.75a.75.75 0 0 1 0-1.5H3.5V5.5A1.5 1.5 0 0 1 5 4h.5zM7.25 6.5v5.6a.75.75 0 0 0 1.5 0V6.5a.75.75 0 0 0-1.5 0" /></Svg>
);
export const FileCode = (p: P) => (
  <Svg {...p}><path d="M3.75 1.5h5.5L13 5.25v8.5c0 .41-.34.75-.75.75h-8.5a.75.75 0 0 1-.75-.75V2.25c0-.41.34-.75.75-.75m5 1.5v2.75h2.75zM6.3 8.2a.6.6 0 0 0-.85-.85L4 8.8l1.45 1.45a.6.6 0 0 0 .85-.85l-.6-.6zm3.4-.85a.6.6 0 0 0 0 .85l.6.6-.6.6a.6.6 0 0 0 .85.85L12 8.8l-1.45-1.45a.6.6 0 0 0-.85 0" /></Svg>
);
export const Database = (p: P) => (
  <Svg {...p}><ellipse cx="8" cy="3.5" rx="5.5" ry="2" /><path d="M2.5 5.2v3.3C2.5 9.6 5 10.5 8 10.5s5.5-.9 5.5-2V5.2C12.4 6.1 10.4 6.6 8 6.6s-4.4-.5-5.5-1.4m0 5v2.3c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-2.3c-1.1.9-3.1 1.4-5.5 1.4s-4.4-.5-5.5-1.4" /></Svg>
);
