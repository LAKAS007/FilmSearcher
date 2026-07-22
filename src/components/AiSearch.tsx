import { FormEvent, useEffect, useState } from 'react';
import type { Movie } from '../types/movie';
import './AiSearch.css';

export interface AiSearchRequest {
  query: string;
  referenceMovie?: Movie;
}

interface AiSearchProps {
  loading: boolean;
  lastQuery: string;
  status: string;
  progress?: number;
  onSearch: (request: AiSearchRequest) => void;
  onSuggestTitles: (query: string, limit?: number) => Promise<Movie[]>;
}

const SUGGESTIONS = [
  'Что-нибудь лёгкое после тяжёлого дня',
  'Страшное, но без романтики',
  'Фантастика до двух часов',
];

const SIMILARITY_CUE =
  /(?:^|[^\p{L}\p{N}])(?:похож\p{L}*|как)(?=$|[^\p{L}\p{N}])|в\s+духе|\b(?:similar|like)\b/iu;

const getMovieYear = (movie: Movie) => movie.release_date?.slice(0, 4) || 'год неизвестен';

export const AiSearch = ({
  loading,
  lastQuery,
  status,
  progress,
  onSearch,
  onSuggestTitles,
}: AiSearchProps) => {
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'free' | 'similar'>('free');
  const [titleQuery, setTitleQuery] = useState('');
  const [titleSuggestions, setTitleSuggestions] = useState<Movie[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<Movie>();
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');

  useEffect(() => {
    if (searchMode !== 'similar' || selectedMovie || titleQuery.trim().length < 2) {
      setTitleSuggestions([]);
      setSuggestionsLoading(false);
      setSuggestionsError('');
      return;
    }

    let active = true;
    const timeoutId = window.setTimeout(() => {
      setSuggestionsLoading(true);
      setSuggestionsError('');

      void onSuggestTitles(titleQuery.trim(), 6)
        .then((movies) => {
          if (active) setTitleSuggestions(movies);
        })
        .catch(() => {
          if (active) {
            setTitleSuggestions([]);
            setSuggestionsError('Не удалось открыть локальный каталог');
          }
        })
        .finally(() => {
          if (active) setSuggestionsLoading(false);
        });
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [onSuggestTitles, searchMode, selectedMovie, titleQuery]);

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    setQuery('');
    onSearch({ query: trimmed });
  };

  const openSimilarSearch = () => {
    setSearchMode('similar');
    setSelectedMovie(undefined);
    setTitleQuery('');
    setTitleSuggestions([]);
  };

  const closeSimilarSearch = () => {
    setSearchMode('free');
    setSelectedMovie(undefined);
    setTitleQuery('');
    setTitleSuggestions([]);
    setSuggestionsError('');
  };

  const submitSimilarSearch = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedMovie || loading) return;

    onSearch({
      query: `Похожее на ${selectedMovie.title}`,
      referenceMovie: selectedMovie,
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(query);
  };

  return (
    <div className="ai-search">
      <div className="ai-search__conversation" aria-live="polite">
        <div className="ai-search__message ai-search__message--assistant">
          <span className="ai-search__avatar">AI</span>
          <p>Расскажите, что вам хочется посмотреть — можно описать настроение, компанию или даже свой день.</p>
        </div>

        {lastQuery && (
          <>
            <div className="ai-search__message ai-search__message--user">
              <p>{lastQuery}</p>
            </div>
            <div className="ai-search__message ai-search__message--assistant ai-search__message--compact">
              <span className="ai-search__avatar">AI</span>
              <div className="ai-search__status">
                <p>{status || (loading ? 'Подбираю варианты…' : 'Вот что лучше всего подходит под ваш запрос')}</p>
                {loading && typeof progress === 'number' && (
                  <div
                    className="ai-search__progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                  >
                    <span style={{ width: `${progress}%` }} />
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {!lastQuery && (
        <div className="ai-search__suggestions">
          <button type="button" onClick={openSimilarSearch}>
            🎬 Похожее на любимый фильм
          </button>
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => submit(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {searchMode === 'free' ? (
        <>
          {SIMILARITY_CUE.test(query) && (
            <button className="ai-search__intent" type="button" onClick={openSimilarSearch}>
              <span className="ai-search__intent-icon" aria-hidden="true">🎬</span>
              <span>
                <strong>Найти похожий фильм</strong>
                <small>Выбрать точное название из каталога</small>
              </span>
              <span aria-hidden="true">→</span>
            </button>
          )}
          <form className="ai-search__form" onSubmit={handleSubmit}>
            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit(query);
                }
              }}
              placeholder="Например: уютный фильм для дождливого вечера, без тяжёлой драмы…"
              aria-label="Опишите, что хотите посмотреть"
              rows={2}
            />
            <button type="submit" disabled={!query.trim() || loading} aria-label="Найти фильмы">
              <span>Найти</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <p className="ai-search__hint">Enter — отправить · Shift + Enter — новая строка</p>
        </>
      ) : (
        <form className="ai-search__reference" onSubmit={submitSimilarSearch}>
          <div className="ai-search__reference-heading">
            <div>
              <span>Режим поиска</span>
              <strong>Похожее на конкретный фильм</strong>
            </div>
            <button type="button" onClick={closeSimilarSearch} aria-label="Вернуться к обычному AI-поиску">
              ×
            </button>
          </div>

          <label className="ai-search__title-field">
            <span>Название фильма</span>
            <input
              value={titleQuery}
              onChange={(event) => {
                setTitleQuery(event.target.value);
                setSelectedMovie(undefined);
              }}
              placeholder="Например, Джентльмены"
              aria-autocomplete="list"
              aria-expanded={Boolean(titleSuggestions.length)}
              autoFocus
            />
          </label>

          {!selectedMovie && (suggestionsLoading || suggestionsError || titleSuggestions.length > 0) && (
            <div className="ai-search__title-results" role="listbox">
              {suggestionsLoading && <p>Ищу в локальном каталоге…</p>}
              {!suggestionsLoading && suggestionsError && <p>{suggestionsError}</p>}
              {!suggestionsLoading &&
                !suggestionsError &&
                titleSuggestions.map((movie) => (
                  <button
                    key={movie.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      setSelectedMovie(movie);
                      setTitleQuery(movie.title);
                      setTitleSuggestions([]);
                    }}
                  >
                    {movie.poster_path ? (
                      <img
                        src={`https://image.tmdb.org/t/p/w92${movie.poster_path}`}
                        alt=""
                      />
                    ) : (
                      <span className="ai-search__poster-placeholder" aria-hidden="true">🎬</span>
                    )}
                    <span>
                      <strong>{movie.title}</strong>
                      <small>{getMovieYear(movie)}</small>
                    </span>
                  </button>
                ))}
            </div>
          )}

          {selectedMovie && (
            <div className="ai-search__selected-movie">
              <span aria-hidden="true">✓</span>
              <div>
                <strong>{selectedMovie.title}</strong>
                <small>{getMovieYear(selectedMovie)} · фильм выбран из каталога</small>
              </div>
            </div>
          )}

          <button className="ai-search__reference-submit" type="submit" disabled={!selectedMovie || loading}>
            Найти похожие
            <span aria-hidden="true">→</span>
          </button>
        </form>
      )}
      <p className="ai-search__model-note">
        AI работает локально · модель и каталог загружаются в браузер, запросы никуда не отправляются
      </p>
    </div>
  );
};
