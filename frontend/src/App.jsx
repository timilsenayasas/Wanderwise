/**
 * Routes + app layout.
 *
 * To add a page: create it in src/pages, then add a <Route> below.
 * Put it inside the <ProtectedRoute> group if it needs a logged-in user,
 * and add a title to PAGE_TITLES.
 */
import { useEffect, useRef } from 'react';
import { Outlet, Route, Routes, matchPath, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ProtectedRoute, { GuestRoute } from './components/ProtectedRoute';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Home from './pages/Home';
import NewTrip from './pages/NewTrip';
import Itinerary from './pages/Itinerary';
import MyTrips from './pages/MyTrips';
import NotFound from './pages/NotFound';

const PAGE_TITLES = {
  '/': 'Plan it. Price it. Pack it.',
  '/login': 'Log in',
  '/register': 'Create account',
  '/home': 'Home',
  '/trips/new': 'Plan a new trip',
  '/trips': 'My trips',
  '/trips/:tripId': 'Itinerary',
};

/** Layout with navbar + footer. Login/Register render full-screen instead. */
function AppLayout() {
  const mainRef = useRef(null);
  const { pathname } = useLocation();
  const firstRender = useRef(true);

  // On navigation: scroll to top and move focus to the page so screen reader
  // and keyboard users start at the new content.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <Navbar />
      <main id="main" className="app-main" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

function DocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Exact paths win over patterns like /trips/:tripId.
    const match =
      (PAGE_TITLES[pathname] && pathname) ||
      Object.keys(PAGE_TITLES).find((pattern) => matchPath({ path: pattern, end: true }, pathname));
    const title = match ? PAGE_TITLES[match] : 'Page not found';
    document.title = `${title} · WanderWise`;
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <DocumentTitle />
      <Routes>
        <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
        {/* Register handles its own "already logged in" redirect so it can show a success screen. */}
        <Route path="/register" element={<Register />} />

        <Route element={<AppLayout />}>
          <Route path="/" element={<Landing />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/home" element={<Home />} />
            <Route path="/trips" element={<MyTrips />} />
            <Route path="/trips/new" element={<NewTrip />} />
            <Route path="/trips/:tripId" element={<Itinerary />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
