import { Link } from 'react-router-dom';
import Logo from './Logo';
import './AuthLayout.css';

/**
 * Split layout for Login/Register: form on the left, illustrated travel
 * panel on the right (desktop). On mobile the form comes first.
 */
export default function AuthLayout({ title, subtitle, children, footer, panelQuote }) {
  return (
    <div className="auth">
      <section className="auth__form-side" aria-labelledby="auth-title">
        <div className="auth__form-wrap fade-up">
          <Link to="/" className="auth__logo" aria-label="WanderWise home">
            <Logo />
          </Link>
          <h1 id="auth-title" className="auth__title">
            {title}
          </h1>
          {subtitle && <p className="auth__subtitle">{subtitle}</p>}
          {children}
          {footer && <div className="auth__footer">{footer}</div>}
        </div>
      </section>

      <aside className="auth__panel" aria-label="About WanderWise">
        <TravelIllustration />
        <div className="auth__panel-copy">
          <p className="auth__quote">{panelQuote || 'Plan it. Price it. Pack it.'}</p>
          <ul className="auth__perks">
            <li>Day-by-day itineraries in minutes</li>
            <li>Costs tracked against your budget</li>
            <li>Refine every stop with AI chat</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function TravelIllustration() {
  return (
    <svg className="auth__art" viewBox="0 0 400 300" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="auth-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f3864" />
          <stop offset="0.6" stopColor="#4a4f8a" />
          <stop offset="1" stopColor="#e8683f" />
        </linearGradient>
      </defs>
      <rect width="400" height="300" fill="url(#auth-sky)" />
      {/* stars */}
      <g fill="#fbf5ec" opacity="0.7">
        <circle cx="40" cy="30" r="1.5" />
        <circle cx="120" cy="55" r="1" />
        <circle cx="200" cy="25" r="1.5" />
        <circle cx="330" cy="45" r="1" />
        <circle cx="370" cy="80" r="1.5" />
        <circle cx="80" cy="90" r="1" />
        <circle cx="160" cy="100" r="1.2" />
        <circle cx="250" cy="60" r="1" />
        <circle cx="290" cy="120" r="1.2" />
        <circle cx="20" cy="140" r="1" />
      </g>
      <circle className="auth__sun" cx="250" cy="195" r="40" fill="#f29f4b" />
      <path d="M0 230 L70 170 L120 205 L190 140 L260 210 L320 175 L400 225 V300 H0 Z" fill="#172b4f" opacity="0.9" />
      <path d="M0 260 L90 215 L170 250 L250 220 L330 255 L400 235 V300 H0 Z" fill="#101f3b" />
      <path
        className="auth__route"
        d="M30 250 C 90 180, 150 260, 210 170 S 280 100, 312 88"
        fill="none"
        stroke="#fbf5ec"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="2 10"
      />
      <g className="auth__plane" transform="translate(318 84) rotate(-25)">
        <path d="M-14 0 L14 0 M0 0 L-6 -12 M0 0 L-6 12 M-12 0 L-16 -6 M-12 0 L-16 6" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
      </g>
      <g transform="translate(30 250)">
        <circle r="7" fill="#e8683f" stroke="#fff" strokeWidth="2.5" />
      </g>
    </svg>
  );
}
