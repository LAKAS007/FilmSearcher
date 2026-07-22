import { useState, useEffect } from 'react';
import { SearchBar } from '../components/SearchBar';
import { AiSearch } from '../components/AiSearch';
import { MovieGrid } from '../components/MovieGrid';
import { Movie, Genre } from '../types/movie';
import { tmdbService } from '../services/tmdb';
import { useDebounce } from '../hooks/useDebounce';
import { interpretMovieQuery } from '../features/ai-search/queryInterpreter';
import {
  rankWithBrowserModel,
  searchStaticMovieIndex,
} from '../features/ai-search/browserSemanticSearch';
import './Home.css';

const AI_CANDIDATE_PAGES = 3;
const AI_RESULT_LIMIT = 12;
const RUNTIME_CANDIDATE_LIMIT = 80;
const DETAILS_BATCH_SIZE = 8;

const formatMovieForEmbedding = (movie: Movie, genreNames: Map<number, string>) => {
  const genres = movie.genre_ids
    ?.map((genreId) => genreNames.get(genreId))
    .filter((genre): genre is string => Boolean(genre))
    .join(', ');
  const year = movie.release_date?.slice(0, 4);

  return [
    movie.title,
    year && `Год: ${year}`,
    genres && `Жанры: ${genres}`,
    `Рейтинг: ${movie.vote_average.toFixed(1)}`,
    movie.overview && `Описание: ${movie.overview}`,
  ]
    .filter(Boolean)
    .join('. ');
};

const filterMoviesByRuntime = async (
  movies: Movie[],
  maxRuntime: number,
  onProgress: (checked: number, total: number) => void,
) => {
  const matchingMovies: Movie[] = [];

  for (let start = 0; start < movies.length; start += DETAILS_BATCH_SIZE) {
    const batch = movies.slice(start, start + DETAILS_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((movie) => tmdbService.getMovieDetails(movie.id)),
    );

    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value.runtime <= maxRuntime) {
        matchingMovies.push(result.value);
      }
    });

    const checked = Math.min(start + batch.length, movies.length);
    onProgress(checked, movies.length);
    if (matchingMovies.length >= AI_RESULT_LIMIT) break;
  }

  return matchingMovies.slice(0, AI_RESULT_LIMIT);
};

export const Home = () => {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<number | null>(null);
  const [category, setCategory] = useState<'popular' | 'top_rated' | 'trending'>('trending');
  const [mode, setMode] = useState<'regular' | 'ai'>('regular');
  const [aiQuery, setAiQuery] = useState('');
  const [aiMovies, setAiMovies] = useState<Movie[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  const [aiProgress, setAiProgress] = useState<number>();
  const [aiCheckedCount, setAiCheckedCount] = useState(0);

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

  const handleAiSearch = async (query: string) => {
    setAiQuery(query);
    setAiLoading(true);
    setAiMovies([]);
    setAiCheckedCount(0);
    setAiStatus('Открываю локальный каталог фильмов');
    setAiProgress(undefined);

    try {
      const intent = interpretMovieQuery(query);

      try {
        const staticResult = await searchStaticMovieIndex(
          query,
          {
            includeGenres: intent.includeGenres,
            excludeGenres: intent.excludeGenres,
            limit: intent.maxRuntime ? RUNTIME_CANDIDATE_LIMIT : AI_RESULT_LIMIT,
          },
          ({ message, progress }) => {
            setAiStatus(message);
            setAiProgress(progress);
          },
        );

        setAiCheckedCount(staticResult.indexSize);

        if (!staticResult.movies.length) {
          setAiStatus('По этим условиям ничего не нашлось — попробуйте описать запрос чуть шире');
          setAiProgress(undefined);
          return;
        }

        const resultMovies = intent.maxRuntime
          ? await filterMoviesByRuntime(
              staticResult.movies,
              intent.maxRuntime,
              (checked, total) => {
                setAiStatus(`Проверяю длительность: ${checked} из ${total}`);
                setAiProgress(Math.round((checked / total) * 100));
              },
            )
          : staticResult.movies.slice(0, AI_RESULT_LIMIT);

        setAiMovies(resultMovies);
        setAiStatus(
          resultMovies.length
            ? `Готово — просмотрено ${staticResult.indexSize.toLocaleString('ru-RU')} фильмов локально`
            : `Среди лучших совпадений нет фильмов короче ${intent.maxRuntime} минут`,
        );
        setAiProgress(100);
        return;
      } catch (staticIndexError) {
        console.warn('Static movie index is unavailable, using TMDB fallback:', staticIndexError);
        setAiStatus('Локальный индекс недоступен — собираю запасную подборку из TMDB');
        setAiProgress(5);
      }

      const responses = await Promise.all(
        Array.from({ length: AI_CANDIDATE_PAGES }, (_, index) =>
          tmdbService.discoverMovies({ ...intent, page: index + 1 }),
        ),
      );
      const candidates = Array.from(
        new Map(responses.flatMap(({ results }) => results).map((movie) => [movie.id, movie])).values(),
      );
      setAiCheckedCount(candidates.length);

      if (!candidates.length) {
        setAiStatus('По этим условиям ничего не нашлось — попробуйте описать запрос чуть шире');
        return;
      }

      const genreNames = new Map(genres.map((genre) => [genre.id, genre.name]));

      try {
        const semanticScores = await rankWithBrowserModel(
          query,
          candidates.map((movie) => ({
            id: movie.id,
            text: formatMovieForEmbedding(movie, genreNames),
          })),
          ({ message, progress }) => {
            setAiStatus(message);
            setAiProgress(progress);
          },
        );
        const scoresById = new Map(semanticScores.map(({ id, score }) => [id, score]));
        const rankedMovies = [...candidates].sort(
          (left, right) => (scoresById.get(right.id) ?? -1) - (scoresById.get(left.id) ?? -1),
        );

        setAiMovies(rankedMovies.slice(0, AI_RESULT_LIMIT));
        setAiStatus(`Готово — запасная подборка из ${candidates.length} фильмов отсортирована локально`);
        setAiProgress(100);
      } catch (modelError) {
        console.warn('Browser AI model is unavailable, using catalog order:', modelError);
        setAiMovies(candidates.slice(0, AI_RESULT_LIMIT));
        setAiStatus('Модель недоступна — показываю подборку по жанрам и ограничениям');
        setAiProgress(undefined);
      }
    } catch (error) {
      console.error('Failed to load AI recommendations:', error);
      setAiMovies([]);
      setAiStatus('Не удалось получить фильмы. Проверьте соединение и попробуйте ещё раз');
      setAiProgress(undefined);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className={`home ${mode === 'ai' ? 'home--ai' : ''}`}>
      <div className="home__hero">
        <div className="home__mode-switch" role="tablist" aria-label="Режим поиска">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'regular'}
            className={mode === 'regular' ? 'home__mode-btn home__mode-btn--active' : 'home__mode-btn'}
            onClick={() => setMode('regular')}
          >
            Regular
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'ai'}
            className={mode === 'ai' ? 'home__mode-btn home__mode-btn--active' : 'home__mode-btn'}
            onClick={() => setMode('ai')}
          >
            <span className="home__mode-spark">✦</span> AI
          </button>
        </div>

        <h1 className="home__title">{mode === 'regular' ? 'Поиск фильмов' : 'Что посмотрим сегодня?'}</h1>
        <p className="home__subtitle">
          {mode === 'regular'
            ? 'Найдите и сохраните любимые фильмы'
            : 'Опишите настроение или ситуацию — мы подберём подходящее кино'}
        </p>

        {mode === 'regular' ? (
          <div className="home__search">
            <SearchBar onSearch={setSearchQuery} />
          </div>
        ) : (
          <AiSearch
            loading={aiLoading}
            lastQuery={aiQuery}
            status={aiStatus}
            progress={aiProgress}
            onSearch={handleAiSearch}
          />
        )}
      </div>

      <div className="home__container">
        {mode === 'regular' && !searchQuery && (
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

        {mode === 'regular' ? (
          <div className="home__results">
          {searchQuery && (
            <h2 className="home__results-title">
              Результаты поиска для "{searchQuery}"
            </h2>
          )}
          {/* TODO: добавить пагинацию для большого количества результатов */}
          <MovieGrid movies={movies} loading={loading} />
          </div>
        ) : (
          <div className="home__results home__results--ai">
            {aiQuery ? (
              <>
                <div className="home__ai-results-heading">
                  <div>
                    <span>AI-подборка</span>
                    <h2>Фильмы для вашего настроения</h2>
                  </div>
                  {!aiLoading && aiCheckedCount > 0 && (
                    <p>
                      Показано {aiMovies.length} · просмотрено {aiCheckedCount.toLocaleString('ru-RU')}
                    </p>
                  )}
                </div>
                <MovieGrid movies={aiMovies} loading={aiLoading} />
              </>
            ) : (
              <div className="home__ai-empty">
                <span>✦</span>
                <h2>Ваша персональная подборка появится здесь</h2>
                <p>Можно писать свободно — например, описать день, настроение или компанию.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
