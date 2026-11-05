import './Skeleton.css';

export default function Skeleton({
  width = '100%',
  height = '16px',
  rounded = false,
  className = '',
}) {
  return (
    <span
      className={`skeleton ${rounded ? 'skeleton--rounded' : ''} ${className}`.trim()}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}