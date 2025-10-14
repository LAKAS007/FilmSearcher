import { useFavorites } from '../contexts/FavoritesContext';
import { MovieGrid } from '../components/MovieGrid';
import './Favorites.css';

export const Favorites = () => {
  const { favorites } = useFavorites();

  return (
    <div className="favorites">
      <div className="favorites__header">
        <h1 className="favorites__title">Избранное</h1>
        <p className="favorites__subtitle">
          {favorites.length === 0
            ? 'Пока нет избранных фильмов. Добавляйте понравившиеся!'
            : `У вас ${favorites.length} ${favorites.length === 1 ? 'фильм' : favorites.length < 5 ? 'фильма' : 'фильмов'} в избранном`}
        </p>
      </div>

      <div className="favorites__container">
        {favorites.length > 0 ? (
          <MovieGrid movies={favorites} />
        ) : (
          <div className="favorites__empty">
            <span className="favorites__empty-icon">💔</span>
            <h2>Пока нет избранных</h2>
            <p>Просматривайте фильмы и нажимайте на сердечко, чтобы добавить в избранное</p>
          </div>
        )}
      </div>
    </div>
  );
};
