/* Public landing page. */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import Button from '../components/Button';
import Icon from '../components/Icon';
import { usePrefersReducedMotion } from '../lib/motion';
import './Landing.css';

const TAGLINES = ['Plan it.', 'Price it.', 'Pack it.'];

const POSTCARDS = [
  { city: 'Lisbon', country: 'Portugal', meta: '4 days · $780', scene: 'lisbon' },
  { city: 'Kyoto', country: 'Japan', meta: '5 days · $1,150', scene: 'kyoto' },
  { city: 'Mexico City', country: 'Mexico', meta: '3 days · $520', scene: 'cdmx' },
];

const STEPS = [
  { icon: 'pin', title: 'Tell us the trip', text: 'Origin, destination, dates, travelers, budget and what you love doing.' },
  { icon: 'sparkles', title: 'Get a day-by-day plan', text: 'Activities, meals, times and travel between stops, with costs for each.' },
  { icon: 'chat', title: 'Refine it with AI', text: 'Chat to swap a museum for a food tour, slow the pace, or trim the budget.' },
];

const FEATURES = [
  { icon: 'calendar', title: 'Day-by-day itinerary', text: 'A clear timeline for every day of your trip.' },
  { icon: 'wallet', title: 'Budget breakdown', text: 'See what everything costs against your budget.' },
  { icon: 'plane', title: 'Transport options', text: 'Compare ways to get there and get around.' },
  { icon: 'sun', title: 'Weather forecast', text: 'Know what the skies have planned.' },
  { icon: 'backpack', title: 'Packing tips', text: 'A packing list tuned to your destination.' },
  { icon: 'map', title: 'Interactive map', text: 'Every stop, pinned and connected.' },
];

export default function Landing() {
  const { user } = useAuth();
  const reducedMotion = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);
  const [taglineIndex, setTaglineIndex] = useState(0);
  const routeSvgRef = useRef(null);
  const motionOff = reducedMotion || paused;

  // Rotate the tagline unless motion is off.
  useEffect(() => {
    if (motionOff) return undefined;
    const t = setInterval(() => setTaglineIndex((i) => (i + 1) % TAGLINES.length), 2200);
    return () => clearInterval(t);
  }, [motionOff]);

  // Pause/resume the SVG (SMIL) route animation along with the CSS ones.
  useEffect(() => {
    const svg = routeSvgRef.current;
    if (!svg?.pauseAnimations) return;
    if (paused) svg.pauseAnimations();
    else svg.unpauseAnimations();
  }, [paused]);

  const primaryCta = user
    ? { to: '/trips/new', label: 'Plan a new trip' }
    : { to: '/register', label: "Start planning. It's free" };

  return (
    <div className="landing">
      {/* ---------- Hero ---------- */}
      <section className={`hero ${paused ? 'is-paused' : ''}`} aria-labelledby="hero-title">
        <RouteLine svgRef={routeSvgRef} animate={!reducedMotion} />

        <div className="hero__inner container">
          <div className="hero__copy">
            <span className="eyebrow">AI trip planner for independent travelers</span>
            <h1 id="hero-title" className="hero__title">
              Your whole trip, <span className="hero__title-accent">planned in minutes.</span>
            </h1>

            <p className="hero__tagline">
              <span className="visually-hidden">{TAGLINES.join(' ')}</span>
              <span className="hero__tagline-flip" aria-hidden="true">
                {motionOff ? (
                  <span className="hero__tagline-static">{TAGLINES.join(' ')}</span>
                ) : (
                  <span key={taglineIndex} className="hero__tagline-word">
                    {TAGLINES[taglineIndex]}
                  </span>
                )}
              </span>
            </p>

            <p className="hero__lead">
              Tell WanderWise where you&apos;re headed, your dates, budget and interests. Get a day-by-day itinerary
              with activities, meals, travel times and costs, then fine-tune it with AI chat.
            </p>

            <div className="hero__ctas">
              <Button to={primaryCta.to} variant="accent" size="lg">
                {primaryCta.label}
                <Icon name="arrowRight" size={20} />
              </Button>
              {user ? (
                <Button to="/home" variant="secondary" size="lg">
                  Go to dashboard
                </Button>
              ) : (
                <Button to="/login" variant="secondary" size="lg">
                  Log in
                </Button>
              )}
            </div>
            <p className="hero__fineprint">No booking. No payments. Just a great plan.</p>
          </div>

          <div className="hero__postcards" aria-label="Sample trips" role="list">
            {POSTCARDS.map((p, i) => (
              <article key={p.city} className={`postcard postcard--${i + 1}`} role="listitem">
                <div className="postcard__scene" aria-hidden="true">
                  <PostcardScene scene={p.scene} />
                  <span className="postcard__stamp" />
                </div>
                <div className="postcard__caption">
                  <h2 className="postcard__city">{p.city}</h2>
                  <p className="postcard__meta">
                    <span className="postcard__country">{p.country}</span>
                    <span className="postcard__sep"> · </span>
                    <span>{p.meta}</span>
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>

        {!reducedMotion && (
          <button type="button" className="hero__pause" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? 'Play animation' : 'Pause animation'}
          </button>
        )}
      </section>

      {/* ---------- How it works ---------- */}
      <section className="landing-section container" aria-labelledby="how-title">
        <span className="eyebrow">How it works</span>
        <h2 id="how-title">From “where should we go?” to a plan you trust</h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="step">
              <span className="step__num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="step__icon" aria-hidden="true">
                <Icon name={s.icon} size={28} />
              </span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- Features ---------- */}
      <section className="landing-band" aria-labelledby="features-title">
        <div className="container">
          <span className="eyebrow">Everything in one place</span>
          <h2 id="features-title">Stop juggling five tabs</h2>
          <ul className="features">
            {FEATURES.map((f) => (
              <li key={f.title} className="feature">
                <span className="feature__icon" aria-hidden="true">
                  <Icon name={f.icon} />
                </span>
                <div>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="landing-cta container" aria-labelledby="cta-title">
        <div className="landing-cta__card">
          <h2 id="cta-title">Ready when you are.</h2>
          <p>Students, first-timers, group organizers: your next trip starts here.</p>
          <Button to={primaryCta.to} variant="accent" size="lg">
            {primaryCta.label}
          </Button>
        </div>
      </section>
    </div>
  );
}

/**
 * Dotted route that draws itself across the hero, with a plane following it.
 * Uses SVG SMIL so the line and plane share one timeline. With reduced motion
 * we render the finished state (full route, plane at destination).
 */
// Runs low under the hero copy, then climbs behind the postcards to the top-right.
const ROUTE_D = 'M -60 575 C 180 610, 420 600, 600 520 S 820 330, 940 270 S 1080 150, 1130 110';

function RouteLine({ svgRef, animate }) {
  const dur = '4.5s';
  const spline = '0.45 0 0.25 1';
  return (
    <svg ref={svgRef} className="hero__route" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <mask id="route-reveal" maskUnits="userSpaceOnUse">
          <path
            d={ROUTE_D}
            fill="none"
            stroke="#fff"
            strokeWidth="14"
            pathLength="1"
            strokeDasharray="1"
            strokeDashoffset={animate ? 1 : 0}
          >
            {animate && (
              <animate
                attributeName="stroke-dashoffset"
                from="1"
                to="0"
                dur={dur}
                begin="0s"
                fill="freeze"
                calcMode="spline"
                keyTimes="0;1"
                keySplines={spline}
              />
            )}
          </path>
        </mask>
      </defs>

      <path d={ROUTE_D} className="hero__route-shadow" fill="none" />
      <path d={ROUTE_D} className="hero__route-dots" fill="none" mask="url(#route-reveal)" />

      {/* destination pin, revealed as the plane lands */}
      <circle cx="1130" cy="110" r="10" className="hero__route-pin" />

      <g className="hero__plane">
        {animate ? (
          <animateMotion
            dur={dur}
            begin="0s"
            fill="freeze"
            rotate="auto"
            path={ROUTE_D}
            calcMode="spline"
            keyPoints="0;1"
            keyTimes="0;1"
            keySplines={spline}
          />
        ) : null}
        <g transform={animate ? undefined : 'translate(1130 110) rotate(-40)'}>
          <PlaneGlyph />
        </g>
      </g>
    </svg>
  );
}

function PlaneGlyph() {
  // Pointing right (+x) so rotate="auto" aligns it with the path.
  return (
    <g>
      <path
        d="M22 0 L-10 -5 L-18 -22 L-24 -22 L-18 -4 L-26 -3 L-31 -10 L-35 -10 L-32 0 L-35 10 L-31 10 L-26 3 L-18 4 L-24 22 L-18 22 L-10 5 Z"
        fill="#1f3864"
        stroke="#fbf5ec"
        strokeWidth="2"
        strokeLinejoin="round"
        transform="scale(0.9)"
      />
    </g>
  );
}

function PostcardScene({ scene }) {
  if (scene === 'lisbon') {
    return (
      <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice">
        <rect width="160" height="100" fill="#f29f4b" />
        <circle cx="118" cy="38" r="16" fill="#fde7c8" />
        <path d="M0 70 L20 58 L20 48 L34 48 L34 60 L52 52 L52 40 L66 34 L80 40 L80 56 L100 50 L118 58 L140 46 L160 52 V100 H0Z" fill="#e8683f" />
        <path d="M0 82 H160 V100 H0Z" fill="#1f3864" />
        <rect x="56" y="70" width="38" height="16" rx="4" fill="#fbd24e" />
        <rect x="60" y="73" width="8" height="6" fill="#1f3864" />
        <rect x="71" y="73" width="8" height="6" fill="#1f3864" />
        <rect x="82" y="73" width="8" height="6" fill="#1f3864" />
      </svg>
    );
  }
  if (scene === 'kyoto') {
    return (
      <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice">
        <rect width="160" height="100" fill="#f7c1a4" />
        <circle cx="46" cy="40" r="18" fill="#e8683f" />
        <path d="M0 76 Q40 56 80 70 T160 64 V100 H0Z" fill="#3b4f86" />
        <g fill="#b9461f">
          <rect x="88" y="34" width="54" height="6" rx="2" />
          <rect x="92" y="44" width="46" height="4" />
          <rect x="96" y="40" width="6" height="46" />
          <rect x="128" y="40" width="6" height="46" />
        </g>
        <path d="M0 88 H160 V100 H0Z" fill="#1f3864" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice">
      <rect width="160" height="100" fill="#8fd3c7" />
      <circle cx="120" cy="30" r="14" fill="#f29f4b" />
      <path d="M40 86 L60 44 H76 L96 86Z" fill="#0f766e" />
      <path d="M52 62 H84 M47 72 H89" stroke="#d5f0ec" strokeWidth="3" />
      <path d="M0 86 H160 V100 H0Z" fill="#1f3864" />
      <path d="M110 86 V60 M110 64 q-8 -2 -10 -10 M110 64 q8 -2 10 -10" stroke="#1f3864" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
