import { useState, useEffect } from 'react';
import { SearchBar } from '../components/SearchBar';
import { MovieGrid } from '../components/MovieGrid';
import { Movie, Genre } from '../types/movie';
import { tmdbService } from '../services/tmdb';
import { useDebounce } from '../hooks/useDebounce';
import './Home.css';

export const Home = () => {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<number | null>(null);
  const [category, setCategory] = useState<'popular' | 'top_rated' | 'trending'>('trending');

  const debouncedSearch = useDebounce(searchQuery, 500);

  useEffect(() => {
    loadGenres();
  }, []);

  useEffect(() => {
    loadMovies();
  }, [debouncedSearch, selectedGenre, category]);

  const loadGenres = async () => {
    try {
      const data = await tmdbService.getGenres();
      setGenres(data);
    } catch (error) {
      console.error('Failed to load genres:', error);
    }
  };

  const loadMovies = async () => {
    setLoading(true);
    try {
      let data: Movie[];

      if (debouncedSearch) {
        const response = await tmdbService.searchMovies(debouncedSearch);
        data = response.results;
        console.log('Найдено фильмов:', data.length); // для отладки
      } else if (selectedGenre) {
        const response = await tmdbService.getMoviesByGenre(selectedGenre);
        data = response.results;
      } else {
        switch (category) {
          case 'popular':
            const popularResponse = await tmdbService.getPopular();
            data = popularResponse.results;
            break;
          case 'top_rated':
            const topRatedResponse = await tmdbService.getTopRated();
            data = topRatedResponse.results;
            break;
          case 'trending':
          default:
            data = await tmdbService.getTrending();
            break;
        }
      }

      setMovies(data);
    } catch (error) {
      console.error('Failed to load movies:', error);
      setMovies([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryChange = (newCategory: typeof category) => {
    setCategory(newCategory);
    setSelectedGenre(null);
    setSearchQuery('');
  };

  const handleGenreChange = (genreId: number | null) => {
    setSelectedGenre(genreId);
    setSearchQuery('');
  };

  return (
    <div className="home">
      <div className="home__hero">
        <h1 className="home__title">Поиск фильмов</h1>
        <p className="home__subtitle">Найдите и сохраните любимые фильмы</p>
        <div className="home__search">
          <SearchBar onSearch={setSearchQuery} />
        </div>
      </div>

      <div className="home__container">
        {!searchQuery && (
          <>
            <div className="home__filters">
              <div className="home__categories">
                <button
                  className={`category-btn ${category === 'trending' ? 'category-btn--active' : ''}`}
                  onClick={() => handleCategoryChange('trending')}
                >
                  🔥 В тренде
                </button>
                <button
                  className={`category-btn ${category === 'popular' ? 'category-btn--active' : ''}`}
                  onClick={() => handleCategoryChange('popular')}
                >
                  ⭐ Популярные
                </button>
                <button
                  className={`category-btn ${category === 'top_rated' ? 'category-btn--active' : ''}`}
                  onClick={() => handleCategoryChange('top_rated')}
                >
                  🏆 Лучшие
                </button>
              </div>

              <div className="home__genres">
                <button
                  className={`genre-btn ${selectedGenre === null ? 'genre-btn--active' : ''}`}
                  onClick={() => handleGenreChange(null)}
                >
                  Все жанры
                </button>
                {genres.slice(0, 8).map((genre) => (
                  <button
                    key={genre.id}
                    className={`genre-btn ${selectedGenre === genre.id ? 'genre-btn--active' : ''}`}
                    onClick={() => handleGenreChange(genre.id)}
                  >
                    {genre.name}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="home__results">
          {searchQuery && (
            <h2 className="home__results-title">
              Результаты поиска для "{searchQuery}"
            </h2>
          )}
          {/* TODO: добавить пагинацию для большого количества результатов */}
          <MovieGrid movies={movies} loading={loading} />
        </div>
      </div>
    </div>
  );
};
