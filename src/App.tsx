import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { FavoritesProvider } from './contexts/FavoritesContext';
import { Navbar } from './components/Navbar';
import { Home } from './pages/Home';
import { MovieDetails } from './pages/MovieDetails';
import { Favorites } from './pages/Favorites';
import './App.css';

function App() {
  return (
    <Router>
      <FavoritesProvider>
        <div className="app">
          <Navbar />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/movie/:id" element={<MovieDetails />} />
            <Route path="/favorites" element={<Favorites />} />
          </Routes>
          <footer className="app__credits" aria-label="Credits">
            <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
              <img
                src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg"
                alt="TMDB"
              />
            </a>
            <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
          </footer>
        </div>
      </FavoritesProvider>
    </Router>
  );
}

export default App;
