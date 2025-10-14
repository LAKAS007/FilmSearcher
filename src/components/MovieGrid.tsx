import { Movie } from '../types/movie';
import { MovieCard } from './MovieCard';
import './MovieGrid.css';

interface MovieGridProps {
  movies: Movie[];
  loading?: boolean;
}

export const MovieGrid = ({ movies, loading }: MovieGridProps) => {
  if (loading) {
    return (
      <div className="movie-grid">
        {Array.from({ length: 12 }).map((_, index) => (
          <div key={index} className="movie-card-skeleton"></div>
        ))}
      </div>
    );
  }

  if (movies.length === 0) {
    return (
      <div className="movie-grid__empty">
        <span className="movie-grid__empty-icon">🎬</span>
        <h2>Фильмы не найдены</h2>
        <p>Попробуйте изменить поисковый запрос или фильтры</p>
      </div>
    );
  }

  return (
    <div className="movie-grid">
      {movies.map((movie) => (
        <MovieCard key={movie.id} movie={movie} />
      ))}
    </div>
  );
};
