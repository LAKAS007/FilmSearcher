import { FormEvent, useState } from 'react';
import './AiSearch.css';

interface AiSearchProps {
  loading: boolean;
  lastQuery: string;
  status: string;
  progress?: number;
  onSearch: (query: string) => void;
}

const SUGGESTIONS = [
  'Что-нибудь лёгкое после тяжёлого дня',
  'Страшное, но без романтики',
  'Фантастика до двух часов',
];

export const AiSearch = ({ loading, lastQuery, status, progress, onSearch }: AiSearchProps) => {
  const [query, setQuery] = useState('');

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    setQuery('');
    onSearch(trimmed);
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
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => submit(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
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
      <p className="ai-search__model-note">
        AI работает локально · модель и каталог загружаются в браузер, запросы никуда не отправляются
      </p>
    </div>
  );
};
