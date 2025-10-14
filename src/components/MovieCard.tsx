import { Movie } from '../types/movie';
import { tmdbService } from '../services/tmdb';
import { useFavorites } from '../contexts/FavoritesContext';
import { useNavigate } from 'react-router-dom';
import './MovieCard.css';

interface MovieCardProps {
  movie: Movie;
}

export const MovieCard = ({ movie }: MovieCardProps) => {
  const { isFavorite, addToFavorites, removeFromFavorites } = useFavorites();
  const navigate = useNavigate();
  const favorite = isFavorite(movie.id);

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (favorite) {
      removeFromFavorites(movie.id);
    } else {
      addToFavorites(movie);
    }
  };

  const handleCardClick = () => {
    navigate(`/movie/${movie.id}`);
  };

  return (
    <div className="movie-card" onClick={handleCardClick}>
      <div className="movie-card__poster-wrapper">
        <img
          src={tmdbService.getImageUrl(movie.poster_path, 'w500')}
          alt={movie.title}
          className="movie-card__poster"
          loading="lazy"
        />
        <div className="movie-card__overlay">
          <button className="movie-card__favorite" onClick={handleFavoriteClick} aria-label="Add to favorites">
            {favorite ? '❤️' : '🤍'}
          </button>
          <div className="movie-card__info">
            <p className="movie-card__overview">{movie.overview || 'Описание отсутствует'}</p>
          </div>
        </div>
      </div>
      <div className="movie-card__details">
        <h3 className="movie-card__title">{movie.title}</h3>
        <div className="movie-card__meta">
          <span className="movie-card__rating">⭐ {movie.vote_average.toFixed(1)}</span>
          <span className="movie-card__year">{movie.release_date?.split('-')[0] || 'N/A'}</span>
        </div>
      </div>
    </div>
  );
};
