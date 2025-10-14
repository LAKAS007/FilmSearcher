import { Link, useLocation } from 'react-router-dom';
import { useFavorites } from '../contexts/FavoritesContext';
import './Navbar.css';

export const Navbar = () => {
  const location = useLocation();
  const { favorites } = useFavorites();

  return (
    <nav className="navbar">
      <div className="navbar__container">
        <Link to="/" className="navbar__logo">
          <span className="navbar__logo-icon">🎬</span>
          <span className="navbar__logo-text">FilmSearcher</span>
        </Link>

        <div className="navbar__links">
          <Link to="/" className={`navbar__link ${location.pathname === '/' ? 'navbar__link--active' : ''}`}>
            Главная
          </Link>
          <Link
            to="/favorites"
            className={`navbar__link ${location.pathname === '/favorites' ? 'navbar__link--active' : ''}`}
          >
            Избранное
            {favorites.length > 0 && <span className="navbar__badge">{favorites.length}</span>}
          </Link>
        </div>
      </div>
    </nav>
  );
};
