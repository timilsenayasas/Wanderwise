/**
 * Small inline icon set (stroke icons, 24x24). Decorative by default.
 *   <Icon name="wallet" />
 *   <Icon name="sun" size={32} title="Weather" />   // title makes it announced
 */
const PATHS = {
  sparkles: 'M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM5 3.5l.6 1.4 1.4.6-1.4.6L5 7.5l-.6-1.4L3 5.5l1.4-.6z',
  wallet: 'M3 7a2 2 0 012-2h13v4M3 7v10a2 2 0 002 2h15V9H5a2 2 0 01-2-2zM16 14h.01',
  chat: 'M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12zM8.5 12h.01M12 12h.01M15.5 12h.01',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  compass: 'M12 21a9 9 0 100-18 9 9 0 000 18zM15.5 8.5l-2 5-5 2 2-5z',
  plane: 'M10.5 13.5L3 11l1.5-1.5 8 1 4-4.5a2.1 2.1 0 013 3l-4.5 4 1 8L15.5 22 13 14.5 9 18v3l-1.5 1.5-1-4-4-1L4 16h3z',
  backpack: 'M8 6V5a4 4 0 018 0v1M6 8a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 01-1 1H7a1 1 0 01-1-1zM9 13h6v4H9z',
  calendar: 'M4 6a2 2 0 012-2h12a2 2 0 012 2v13a2 2 0 01-2 2H6a2 2 0 01-2-2zM4 10h16M8 2v4M16 2v4',
  pin: 'M12 21s-7-6.2-7-12a7 7 0 1114 0c0 5.8-7 12-7 12zM12 11.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 017 0V11',
  users: 'M16 20v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 18.5V20M10 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM20 20v-1.5a3.5 3.5 0 00-2.5-3.4M15.5 4.2a3.5 3.5 0 010 6.6',
};

export default function Icon({ name, size = 24, title, className = '', strokeWidth = 1.8 }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
