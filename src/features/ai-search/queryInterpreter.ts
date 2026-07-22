export interface MovieSearchIntent {
  includeGenres: number[];
  excludeGenres: number[];
  referenceTitle?: string;
  maxRuntime?: number;
  sortBy: 'popularity.desc' | 'vote_average.desc';
}

const GENRE_KEYWORDS: Array<{ genreId: number; words: string[] }> = [
  { genreId: 28, words: ['боевик', 'экшен', 'драйв', 'динамич'] },
  { genreId: 12, words: ['приключ', 'путешеств'] },
  { genreId: 16, words: ['мульт', 'анимац'] },
  { genreId: 35, words: ['комед', 'смешн', 'весел', 'лёгк', 'легк'] },
  { genreId: 18, words: ['драм'] },
  { genreId: 27, words: ['ужас', 'страшн', 'хоррор'] },
  { genreId: 53, words: ['триллер', 'напряж', 'саспенс'] },
  { genreId: 9648, words: ['детектив', 'загад', 'тайн'] },
  { genreId: 878, words: ['фантаст', 'космос', 'будущ'] },
  { genreId: 14, words: ['фэнтези', 'маг', 'сказоч'] },
  { genreId: 10749, words: ['романтик', 'любов'] },
  { genreId: 10751, words: ['семейн', 'с ребён', 'с ребен', 'с детьми'] },
  { genreId: 99, words: ['документал', 'реальн'] },
  { genreId: 80, words: ['криминал', 'гангстер', 'мафи'] },
  { genreId: 10752, words: ['военн', 'войн'] },
];

const EXCLUSION_MARKERS = ['без ', 'не хочу ', 'только не ', 'никак'];

const hasAny = (text: string, words: string[]) => words.some((word) => text.includes(word));

const REFERENCE_PATTERNS = [
  /(?:похож\p{L}*\s+на|в\s+духе)\s+(?:фильм\p{L}*\s+)?(.+)/iu,
  /(?:фильм|кино|что(?:-то)?|что-нибудь)\s+как\s+(?:фильм\p{L}*\s+)?(.+)/iu,
  /(?:movies?|films?|something)\s+(?:similar\s+to|like)\s+(.+)/iu,
];

const cleanReferenceTitle = (value: string) =>
  value
    .split(/[,;]|\s+(?:но|без|до|только\s+не|и\s+чтобы)\b/iu, 1)[0]
    .trim()
    .replace(/^[«»"'“”]+|[«»"'“”.!?]+$/gu, '')
    .trim();

export const extractReferenceTitle = (query: string) => {
  for (const pattern of REFERENCE_PATTERNS) {
    const match = query.match(pattern);
    if (!match) continue;

    const title = cleanReferenceTitle(match[1]);
    if (title.length >= 2) return title;
  }

  return undefined;
};

const isExcluded = (text: string, words: string[]) =>
  EXCLUSION_MARKERS.some((marker) =>
    words.some((word) => {
      const markerIndex = text.indexOf(marker);
      const wordIndex = text.indexOf(word, markerIndex + marker.length);
      return markerIndex >= 0 && wordIndex >= 0 && wordIndex - markerIndex < 35;
    }),
  );

export const interpretMovieQuery = (query: string): MovieSearchIntent => {
  const normalized = query.toLocaleLowerCase('ru-RU');
  const includeGenres: number[] = [];
  const excludeGenres: number[] = [];

  GENRE_KEYWORDS.forEach(({ genreId, words }) => {
    if (!hasAny(normalized, words)) return;
    if (isExcluded(normalized, words)) {
      excludeGenres.push(genreId);
    } else {
      includeGenres.push(genreId);
    }
  });

  const minutes = normalized.match(/(?:до|не больше)\s*(\d{2,3})\s*(?:мин|минут)/);
  const hours = normalized.match(/(?:до|не больше)\s*(\d(?:[.,]\d)?)\s*(?:час|ч)/);

  let maxRuntime: number | undefined;
  if (minutes) maxRuntime = Number(minutes[1]);
  if (hours) maxRuntime = Math.round(Number(hours[1].replace(',', '.')) * 60);
  if (!maxRuntime && /(?:до|не больше)\s*двух\s*час/.test(normalized)) maxRuntime = 120;
  if (!maxRuntime && /(?:до|не больше)\s*полутора\s*час/.test(normalized)) maxRuntime = 90;
  if (!maxRuntime && /(?:до|не больше)\s*(?:одного\s*)?часа?/.test(normalized)) maxRuntime = 60;
  if (!maxRuntime && hasAny(normalized, ['коротк', 'недолг'])) maxRuntime = 100;

  const wantsTopRated = hasAny(normalized, ['лучш', 'высокий рейтинг', 'высоким рейтинг']);

  return {
    includeGenres: [...new Set(includeGenres)],
    excludeGenres: [...new Set(excludeGenres)],
    referenceTitle: extractReferenceTitle(query),
    maxRuntime,
    sortBy: wantsTopRated ? 'vote_average.desc' : 'popularity.desc',
  };
};
