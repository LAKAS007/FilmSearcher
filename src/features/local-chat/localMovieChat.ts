import type {
  ChatCompletionMessageParam,
  InitProgressReport,
  WebWorkerMLCEngine,
} from '@mlc-ai/web-llm';
import type { Genre, Movie } from '../../types/movie';

export const LOCAL_CHAT_MODEL = 'Qwen3-0.6B-q4f16_1-MLC';
export const LOCAL_CHAT_DOWNLOAD_MIB = 336;
export const LOCAL_CHAT_VRAM_MIB = 1404;

export interface LocalChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LocalMovieChatContext {
  query: string;
  movies: Movie[];
  genres: Genre[];
}

let enginePromise: Promise<WebWorkerMLCEngine> | null = null;
let chatWorker: Worker | null = null;
const progressListeners = new Set<(report: InitProgressReport) => void>();

const GENRE_NAMES_RU: Record<string, string> = {
  Action: 'боевик',
  Adventure: 'приключения',
  Animation: 'анимация',
  Comedy: 'комедия',
  Crime: 'криминал',
  Documentary: 'документальный',
  Drama: 'драма',
  Family: 'семейный',
  Fantasy: 'фэнтези',
  History: 'исторический',
  Horror: 'ужасы',
  Music: 'музыкальный',
  Mystery: 'детектив',
  Romance: 'мелодрама',
  'Science Fiction': 'фантастика',
  'TV Movie': 'телефильм',
  Thriller: 'триллер',
  War: 'военный',
  Western: 'вестерн',
};

const CHOICE_GENRE_INTENTS = [
  { pattern: /экшен|боевик|динамич/, genre: 'Action' },
  { pattern: /смеш|комеди|весел/, genre: 'Comedy' },
  { pattern: /страш|ужас/, genre: 'Horror' },
  { pattern: /роман|любов|мелодрам/, genre: 'Romance' },
  { pattern: /кримин|гангстер|ограб/, genre: 'Crime' },
  { pattern: /фантаст|космос|научн/, genre: 'Science Fiction' },
  { pattern: /фэнтези|магич|магия/, genre: 'Fantasy' },
  { pattern: /триллер|напряж/, genre: 'Thriller' },
  { pattern: /семейн|для детей/, genre: 'Family' },
];

export const isLocalMovieChatSupported = () =>
  window.isSecureContext && 'gpu' in navigator;

const notifyProgress = (report: InitProgressReport) => {
  progressListeners.forEach((listener) => listener(report));
};

const createEngine = async () => {
  const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
  chatWorker = new Worker(new URL('../../workers/local-chat.worker.ts', import.meta.url), {
    type: 'module',
  });

  try {
    return await CreateWebWorkerMLCEngine(chatWorker, LOCAL_CHAT_MODEL, {
      initProgressCallback: notifyProgress,
    });
  } catch (error) {
    chatWorker.terminate();
    chatWorker = null;
    enginePromise = null;
    throw error;
  }
};

export const loadLocalMovieChat = (onProgress: (report: InitProgressReport) => void) => {
  if (!isLocalMovieChatSupported()) {
    return Promise.reject(
      new Error('Для локального чата нужен браузер с WebGPU'),
    );
  }

  progressListeners.add(onProgress);
  enginePromise ??= createEngine();

  return enginePromise.finally(() => {
    progressListeners.delete(onProgress);
  });
};

const buildMovieContext = ({ query, movies, genres }: LocalMovieChatContext) => {
  const genreNames = new Map(genres.map((genre) => [genre.id, genre.name]));
  const movieList = movies.slice(0, 8).map((movie, index) => {
    const year = movie.release_date?.slice(0, 4) || 'год неизвестен';
    const movieGenres = movie.genre_ids
      ?.map((genreId) => genreNames.get(genreId))
      .filter((genre): genre is string => Boolean(genre))
      .map((genre) => GENRE_NAMES_RU[genre] ?? genre)
      .join(', ');

    return [
      `${index + 1}. ${movie.title} (${year})`,
      movieGenres && `жанры: ${movieGenres}`,
      `рейтинг: ${movie.vote_average.toFixed(1)}`,
      movie.overview && `краткое описание: ${movie.overview.slice(0, 220)}`,
    ]
      .filter(Boolean)
      .join('; ');
  });

  return [
    `ИСХОДНЫЙ ЗАПРОС: ${query}`,
    'ФИЛЬМЫ В ПОРЯДКЕ ВЫДАЧИ:',
    movieList.join('\n'),
  ].join('\n\n');
};

const getGroundedChoice = (
  context: LocalMovieChatContext,
  question: string,
) => {
  const genreNames = new Map(context.genres.map((genre) => [genre.id, genre.name]));
  const limit = /(?:первых|этих)\s+(?:двух|2)/.test(question)
    ? 2
    : /(?:первых|этих)\s+(?:тр[её]х|3)/.test(question)
      ? 3
      : /(?:первых|этих)\s+(?:четыр[её]х|4)/.test(question)
        ? 4
        : 8;
  const candidates = context.movies.slice(0, limit);
  const genreIntent = CHOICE_GENRE_INTENTS.find(({ pattern }) => pattern.test(question));
  const movie = genreIntent
    ? candidates.find((candidate) =>
        candidate.genre_ids?.some(
          (genreId) => genreNames.get(genreId) === genreIntent.genre,
        ),
      ) ?? candidates[0]
    : candidates[0];
  const movieGenres = movie?.genre_ids
    ?.map((genreId) => genreNames.get(genreId))
    .filter((genre): genre is string => Boolean(genre))
    .map((genre) => GENRE_NAMES_RU[genre] ?? genre)
    .join(', ');

  return movie ? { movie, movieGenres } : null;
};

export const streamLocalMovieReply = async (
  context: LocalMovieChatContext,
  history: LocalChatHistoryMessage[],
  onText: (text: string) => void,
) => {
  if (!enginePromise) {
    throw new Error('Локальная модель ещё не загружена');
  }

  const engine = await enginePromise;
  const latestQuestion = history[history.length - 1]?.content.toLocaleLowerCase('ru-RU') ?? '';
  const asksForChoice = /выбер|выбрат|какой из|что из/.test(latestQuestion);
  const groundedChoice = asksForChoice
    ? getGroundedChoice(context, latestQuestion)
    : null;
  const responseRule = groundedChoice
    ? `Приложение уже выбрало фильм «${groundedChoice.movie.title}» по проверяемым жанрам (${groundedChoice.movieGenres || 'не указаны'}). Назови только этот фильм и одним предложением объясни выбор. Не меняй название и не выбирай другой фильм.`
    : /сравни|почему первые|объясни|разбери/.test(latestQuestion)
      ? 'В этом ответе разбери запрошенные фильмы по порядку отдельными короткими пунктами.'
      : 'Ответь прямо и кратко на последний вопрос.';
  const systemMessage = [
    'Ты — точный киноассистент. Отвечай только на русском.',
    'Используй исключительно факты из контекста ниже. Не выдумывай опыт, предпочтения или сюжет.',
    'Всегда называй конкретные фильмы. Не пиши общие советы без названий.',
    'Копируй названия посимвольно из контекста: не переводи и не изменяй их.',
    'Формат разбора: «1. Точное название — одно короткое объяснение связи с исходным запросом».',
    'Для выбора используй явные жанры: экшен — боевик, смешное — комедия, страшное — ужасы, романтика — мелодрама.',
    'Не используй Markdown, звёздочки и заголовки.',
    'Если данных не хватает или фильма нет в списке, прямо скажи об этом.',
    responseRule,
  ].join('\n');
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemMessage },
    {
      role: 'user',
      content: `Контекст приложения. Используй его как единственный источник:\n\n${buildMovieContext(context)}`,
    },
    {
      role: 'assistant',
      content: 'Контекст принят. Буду называть фильмы и опираться только на эти данные.',
    },
    ...history
      .filter((message) => message.role === 'user')
      .slice(-4)
      .map((message) => ({
      role: message.role,
      content: message.content,
      })),
  ];

  const chunks = await engine.chat.completions.create({
    messages,
    stream: true,
    max_tokens: 260,
    temperature: 0,
    top_p: 1,
    extra_body: {
      enable_thinking: false,
    },
  });

  let fullText = '';
  const visibleText = (text: string) => {
    const thinkingStart = text.indexOf('<think>');
    if (thinkingStart < 0) return text.replace(/\*\*/g, '');
    const thinkingEnd = text.lastIndexOf('</think>');
    const withoutThinking = thinkingEnd < thinkingStart
      ? text.slice(0, thinkingStart)
      : `${text.slice(0, thinkingStart)}${text.slice(thinkingEnd + 8)}`.trimStart();
    return withoutThinking.replace(/\*\*/g, '');
  };

  for await (const chunk of chunks) {
    const text = chunk.choices[0]?.delta.content ?? '';
    if (!text) continue;
    fullText += text;
    onText(visibleText(fullText));
  }

  return visibleText(fullText).trim();
};

export const interruptLocalMovieChat = () => {
  void enginePromise?.then((engine) => engine.interruptGenerate());
};
