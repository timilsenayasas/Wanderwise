import './Card.css';

/**
 * Surface container.
 *   <Card>…</Card>
 *   <Card as="section" padding="lg" interactive>…</Card>   // hover lift
 *   <Card tone="navy">…</Card>                             // dark feature card
 */
export default function Card({ as: Tag = 'div', padding = 'md', tone = 'default', interactive = false, className = '', children, ...props }) {
  const classes = ['card', `card--pad-${padding}`, `card--${tone}`, interactive && 'card--interactive', className]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag className={classes} {...props}>
      {children}
    </Tag>
  );
}
