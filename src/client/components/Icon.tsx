import type { SVGProps } from 'react';

type IconName = 'search' | 'plus' | 'image' | 'pen' | 'offline' | 'cloud-check' | 'refresh' | 'sort' | 'x' | 'trash' | 'pin' | 'pin-filled' | 'palette' | 'note' | 'chevron-left' | 'chevron-right';
const paths: Record<IconName, React.ReactNode> = {
  search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></>,
  'chevron-left': <path d="m15 6-6 6 6 6"/>,
  'chevron-right': <path d="m9 6 6 6-6 6"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  image: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.3"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>,
  note: <><path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10L14 3Z"/><path d="M14 3v7h7M7 14h10M7 17h7"/></>,
  pen: <path d="m15 4 5 5M4 20l5-1L21 7a2.1 2.1 0 0 0-4-4L5 15l-1 5Z"/>,
  'cloud-check': <><path d="M7 18H6a4.5 4.5 0 0 1-.5-9 6.5 6.5 0 0 1 12.4-1.5A5.2 5.2 0 0 1 20 17"/><path d="m10 16 3 3 5-6"/></>,
  offline: <><path d="m3 3 18 18M7 18H6a4.5 4.5 0 0 1-1.6-8.7M9 4a6.5 6.5 0 0 1 9 3.5A5.2 5.2 0 0 1 21 15M9 18h5"/></>,
  refresh: <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/></>,
  sort: <path d="M5 5v14m-3-3 3 3 3-3M12 6h9m-9 6h6m-6 6h3"/>,
  x: <path d="m6 6 12 12M6 18 18 6"/>,
  trash: <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>,
  pin: <><path d="M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6Z"/><path d="M12 15v6"/></>,
  'pin-filled': <><path d="M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6Z" fill="currentColor"/><path d="M12 15v6"/></>,
  palette: <><path d="M12 2.5C6.5 2.5 2.5 6.6 2.5 12S6.7 21.5 12 21.5c1.7 0 2.6-1 2.6-2.2 0-.9-.5-1.4-.5-2.1 0-1 .8-1.7 1.8-1.7h2.4c2.1 0 3.2-1.5 3.2-3.4C21.5 6.6 17.4 2.5 12 2.5Z"/><circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="6.5" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="6.5" r="1" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r="1" fill="currentColor" stroke="none"/></>,
};
export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
