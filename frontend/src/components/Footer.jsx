import Logo from './Logo';
import './Footer.css';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner container">
        <Logo />
        <p className="footer__text">Built by the WanderWise team for CSCE 4901 Capstone · University of North Texas</p>
      </div>
    </footer>
  );
}
