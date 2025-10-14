import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MovieDetails as MovieDetailsType } from '../types/movie';
import { tmdbService } from '../services/tmdb';
import { useFavorites } from '../contexts/FavoritesContext';
import './MovieDetails.css';

export const MovieDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [movie, setMovie] = useState<MovieDetailsType | null>(null);
  const [loading, setLoading] = useState(true);
  const { isFavorite, addToFavorites, removeFromFavorites } = useFavorites();

  useEffect(() => {
    if (id) {
      loadMovie(parseInt(id));
    }
  }, [id]);

  const loadMovie = async (movieId: number) => {
    setLoading(true);
    try {
      const data = await tmdbService.getMovieDetails(movieId);
      setMovie(data);
    } catch (error) {
      console.error('Failed to load movie:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFavoriteClick = () => {
    if (!movie) return;

    if (isFavorite(movie.id)) {
      removeFromFavorites(movie.id);
    } else {
      addToFavorites(movie);
    }
  };

  if (loading) {
    return <div className="movie-details__loading">Загрузка...</div>;
  }

  if (!movie) {
    return (
      <div className="movie-details__error">
        <h2>Фильм не найден</h2>
        <button onClick={() => navigate('/')}>На главную</button>
      </div>
    );
  }

  const favorite = isFavorite(movie.id);

  return (
    <div className="movie-details">
      <div
        className="movie-details__backdrop"
        style={{
          backgroundImage: `url(${tmdbService.getImageUrl(movie.backdrop_path, 'original')})`,
        }}
      >
        <div className="movie-details__backdrop-overlay"></div>
      </div>

      <div className="movie-details__content">
        <button className="movie-details__back" onClick={() => navigate(-1)}>
          ← Назад
        </button>

        <div className="movie-details__main">
          <div className="movie-details__poster">
            <img src={tmdbService.getImageUrl(movie.poster_path, 'w500')} alt={movie.title} />
          </div>

          <div className="movie-details__info">
            <h1 className="movie-details__title">{movie.title}</h1>

            {movie.tagline && <p className="movie-details__tagline">"{movie.tagline}"</p>}

            <div className="movie-details__meta">
              <span className="movie-details__rating">
                ⭐ {movie.vote_average.toFixed(1)} ({movie.vote_count.toLocaleString()} голосов)
              </span>
              <span className="movie-details__year">{movie.release_date?.split('-')[0]}</span>
              {movie.runtime && <span className="movie-details__runtime">{movie.runtime} мин</span>}
            </div>

            <div className="movie-details__genres">
              {movie.genres.map((genre) => (
                <span key={genre.id} className="movie-details__genre">
                  {genre.name}
                </span>
              ))}
            </div>

            <p className="movie-details__overview">{movie.overview}</p>

            <button className="movie-details__favorite-btn" onClick={handleFavoriteClick}>
              {favorite ? '❤️ Удалить из избранного' : '🤍 Добавить в избранное'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
