import { FormEvent, useEffect, useState } from 'react';
import type { Genre, Movie } from '../types/movie';
import {
  interruptLocalMovieChat,
  isLocalMovieChatSupported,
  loadLocalMovieChat,
  LOCAL_CHAT_DOWNLOAD_MIB,
  LOCAL_CHAT_MODEL,
  LOCAL_CHAT_VRAM_MIB,
  streamLocalMovieReply,
  type LocalChatHistoryMessage,
} from '../features/local-chat/localMovieChat';
import './LocalMovieChat.css';

interface LocalMovieChatProps {
  query: string;
  movies: Movie[];
  genres: Genre[];
}

interface DisplayMessage extends LocalChatHistoryMessage {
  id: string;
}

const STARTERS = [
  'Почему первые три фильма мне подходят?',
  'Что из этого лучше выбрать на вечер?',
  'Сравни первые два фильма',
];

const getErrorMessage = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : '';
  if (/WebGPU|GPUAdapter|shader-f16|device/i.test(message)) {
    return 'На этом устройстве WebGPU не смог запустить локальную LLM';
  }
  return message || 'Не удалось запустить локальную LLM';
};

const getProgressMessage = (text: string) => {
  if (/start to fetch params/i.test(text)) {
    return 'Начинаю загрузку весов модели';
  }

  const blocks = text.match(/cache\[(\d+)\/(\d+)\]:\s*(\d+)MB fetched/i);
  if (blocks) {
    return `Загружено ${blocks[1]} из ${blocks[2]} блоков · ${blocks[3]} MB`;
  }

  if (/cache/i.test(text)) {
    return 'Читаю модель из кэша браузера';
  }

  return 'Загружаю и запускаю модель в браузере';
};

export const LocalMovieChat = ({ query, movies, genres }: LocalMovieChatProps) => {
  const supported = isLocalMovieChatSupported();
  const [stage, setStage] = useState<'idle' | 'loading' | 'ready' | 'generating' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<DisplayMessage[]>([]);

  useEffect(() => {
    setMessages([]);
    setInput('');
  }, [query]);

  const startModel = async () => {
    setStage('loading');
    setError('');
    setProgress(0);
    setProgressText('Подготавливаю WebGPU');

    try {
      await loadLocalMovieChat((report) => {
        setProgress(Math.round(report.progress * 100));
        setProgressText(
          report.progress >= 1 ? 'Модель готова' : getProgressMessage(report.text),
        );
      });
      setProgress(100);
      setProgressText('Модель готова');
      setStage('ready');
    } catch (loadError) {
      setError(getErrorMessage(loadError));
      setStage('error');
    }
  };

  const sendMessage = async (value: string) => {
    const content = value.trim();
    if (!content || stage === 'generating') return;

    const userMessage: DisplayMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
    };
    const assistantId = crypto.randomUUID();
    const assistantMessage: DisplayMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
    };
    const history = [...messages, userMessage];

    setInput('');
    setError('');
    setMessages([...history, assistantMessage]);
    setStage('generating');

    try {
      const answer = await streamLocalMovieReply(
        { query, movies, genres },
        history,
        (text) => {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId ? { ...message, content: text } : message,
            ),
          );
        },
      );

      if (!answer) {
        throw new Error('Модель не смогла сформулировать ответ');
      }
      setStage('ready');
    } catch (generationError) {
      setMessages((current) => current.filter((message) => message.id !== assistantId));
      setError(getErrorMessage(generationError));
      setStage('ready');
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
  };

  return (
    <section className="local-chat" aria-label="Локальный AI-кинокритик">
      <div className="local-chat__heading">
        <div className="local-chat__icon" aria-hidden="true">LLM</div>
        <div>
          <span>Эксперимент · всё на устройстве</span>
          <h3>Локальный кинокритик</h3>
        </div>
        {stage === 'ready' || stage === 'generating' ? (
          <div className="local-chat__ready">● готов</div>
        ) : null}
      </div>

      {stage === 'idle' && (
        <div className="local-chat__intro">
          <p>
            Qwen3 обсудит текущую подборку и объяснит, почему фильмы подходят. Запросы и
            ответы не покидают браузер.
          </p>
          <div className="local-chat__requirements">
            <span>↓ ~{LOCAL_CHAT_DOWNLOAD_MIB} MB при первом запуске</span>
            <span>◇ ~{LOCAL_CHAT_VRAM_MIB} MB GPU-памяти</span>
            <span>WebGPU</span>
          </div>
          <button type="button" onClick={() => void startModel()} disabled={!supported}>
            {supported ? 'Загрузить и запустить LLM' : 'WebGPU недоступен'}
          </button>
          <small>{LOCAL_CHAT_MODEL}</small>
        </div>
      )}

      {stage === 'loading' && (
        <div className="local-chat__loading" aria-live="polite">
          <div>
            <span>{progressText}</span>
            <strong>{progress}%</strong>
          </div>
          <div
            className={`local-chat__progress${progress === 0 ? ' local-chat__progress--starting' : ''}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: progress === 0 ? '24%' : `${progress}%` }} />
          </div>
          <p>
            Первый запуск может занять несколько минут. Процент обновляется после крупных
            блоков, затем модель остаётся в кэше.
          </p>
        </div>
      )}

      {stage === 'error' && (
        <div className="local-chat__error">
          <p>{error}</p>
          <button type="button" onClick={() => void startModel()}>Повторить</button>
        </div>
      )}

      {(stage === 'ready' || stage === 'generating') && (
        <>
          <div className="local-chat__messages" aria-live="polite">
            {!messages.length && (
              <div className="local-chat__assistant-message">
                <span>LLM</span>
                <p>Модель готова. Можно обсудить восемь первых фильмов из подборки.</p>
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === 'user'
                    ? 'local-chat__user-message'
                    : 'local-chat__assistant-message'
                }
              >
                {message.role === 'assistant' && <span>LLM</span>}
                <p>{message.content || 'Думаю…'}</p>
              </div>
            ))}
          </div>

          {!messages.length && (
            <div className="local-chat__starters">
              {STARTERS.map((starter) => (
                <button key={starter} type="button" onClick={() => void sendMessage(starter)}>
                  {starter}
                </button>
              ))}
            </div>
          )}

          {error && <p className="local-chat__inline-error">{error}</p>}
          <form className="local-chat__form" onSubmit={handleSubmit}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Спросите о текущей подборке…"
              aria-label="Сообщение локальному кинокритику"
              disabled={stage === 'generating'}
            />
            {stage === 'generating' ? (
              <button
                type="button"
                onClick={() => interruptLocalMovieChat()}
                aria-label="Остановить ответ"
              >
                Стоп
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()}>Отправить</button>
            )}
          </form>
        </>
      )}
    </section>
  );
};
