import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import modelConfig from '../../movie-index.config.json';
import type { Movie } from '../types/movie';

interface SemanticCandidate {
  id: number;
  text: string;
}

interface RankRequest {
  type: 'rank';
  requestId: string;
  query: string;
  candidates: SemanticCandidate[];
}

interface SearchIndexRequest {
  type: 'search-index';
  requestId: string;
  query: string;
  includeGenres: number[];
  excludeGenres: number[];
  referenceTitle?: string;
  limit: number;
}

interface DisposeRequest {
  type: 'dispose';
}

interface MovieIndexManifest {
  version: number;
  generatedAt: string;
  count: number;
  dimensions: number;
  model: {
    id: string;
    revision: string;
    dtype: string;
    queryPrefix: string;
  };
  quantization: {
    type: string;
    scale: number;
  };
  files: {
    movies: string;
    embeddings: string;
  };
}

interface LoadedMovieIndex {
  manifest: MovieIndexManifest;
  movies: Movie[];
  embeddings: Int8Array;
}

type WorkerRequest = RankRequest | SearchIndexRequest | DisposeRequest;
type SearchStage = 'index' | 'model' | 'ranking';

const FALLBACK_BATCH_SIZE = 8;
const QUALITY_WEIGHT = 0.12;
const REFERENCE_SEMANTIC_WEIGHT = 0.74;
const REFERENCE_GENRE_WEIGHT = 0.18;
const REFERENCE_QUALITY_WEIGHT = 0.08;
const ANIMATION_MISMATCH_PENALTY = 0.08;
const ANIMATION_GENRE_ID = 16;

env.useBrowserCache = true;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
let movieIndexPromise: Promise<LoadedMovieIndex> | null = null;
let loadingRequestId: string | null = null;

const postProgress = (
  requestId: string,
  stage: SearchStage,
  message: string,
  progress?: number,
) => {
  self.postMessage({ type: 'progress', requestId, stage, message, progress });
};

const getExtractor = (requestId: string) => {
  loadingRequestId = requestId;

  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', modelConfig.modelId, {
      revision: modelConfig.modelRevision,
      dtype: modelConfig.modelDtype as 'q8',
      progress_callback: (info) => {
        if (!loadingRequestId) return;

        if (info.status === 'progress_total') {
          postProgress(
            loadingRequestId,
            'model',
            'Загружаю AI-модель в браузер',
            Math.round(info.progress),
          );
        } else if (info.status === 'ready') {
          postProgress(loadingRequestId, 'model', 'AI-модель готова', 100);
        }
      },
    }).catch((error: unknown) => {
      extractorPromise = null;
      throw error;
    });
  }

  return extractorPromise;
};

const fetchOrThrow = async (url: URL, init?: RequestInit) => {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить ${url.pathname}: HTTP ${response.status}`);
  }
  return response;
};

const validateManifest = (manifest: MovieIndexManifest) => {
  if (
    manifest.version !== modelConfig.version ||
    manifest.dimensions !== modelConfig.dimensions ||
    manifest.model.id !== modelConfig.modelId ||
    manifest.model.revision !== modelConfig.modelRevision ||
    manifest.model.dtype !== modelConfig.modelDtype ||
    manifest.quantization.type !== modelConfig.quantization ||
    manifest.quantization.scale !== modelConfig.quantizationScale
  ) {
    throw new Error('Версия статического индекса не совпадает с браузерной AI-моделью');
  }
};

const loadMovieIndex = async (requestId: string): Promise<LoadedMovieIndex> => {
  postProgress(requestId, 'index', 'Загружаю каталог и готовые векторы');
  const baseUrl = new URL('/movie-index/', self.location.origin);
  const manifestUrl = new URL('manifest.json', baseUrl);
  const manifest = (await (await fetchOrThrow(manifestUrl, { cache: 'no-cache' })).json()) as MovieIndexManifest;

  validateManifest(manifest);

  const moviesUrl = new URL(manifest.files.movies, baseUrl);
  const embeddingsUrl = new URL(manifest.files.embeddings, baseUrl);
  moviesUrl.searchParams.set('v', manifest.generatedAt);
  embeddingsUrl.searchParams.set('v', manifest.generatedAt);

  const [moviesResponse, embeddingsResponse] = await Promise.all([
    fetchOrThrow(moviesUrl),
    fetchOrThrow(embeddingsUrl),
  ]);
  const [movies, embeddingsBuffer] = await Promise.all([
    moviesResponse.json() as Promise<Movie[]>,
    embeddingsResponse.arrayBuffer(),
  ]);
  const embeddings = new Int8Array(embeddingsBuffer);
  const expectedBytes = manifest.count * manifest.dimensions;

  if (movies.length !== manifest.count || embeddings.byteLength !== expectedBytes) {
    throw new Error(
      `Статический индекс повреждён: ожидалось ${manifest.count} фильмов и ${expectedBytes} байт`,
    );
  }

  postProgress(requestId, 'index', `Каталог загружен: ${manifest.count.toLocaleString('ru-RU')} фильмов`, 100);
  return { manifest, movies, embeddings };
};

const getMovieIndex = (requestId: string) => {
  if (!movieIndexPromise) {
    movieIndexPromise = loadMovieIndex(requestId).catch((error: unknown) => {
      movieIndexPromise = null;
      throw error;
    });
  }

  return movieIndexPromise;
};

const copyEmbedding = (data: Float32Array, dimensions: number) =>
  Float32Array.from(data.subarray(0, dimensions));

const embedQuery = async (requestId: string, query: string, message = 'Понимаю смысл запроса') => {
  postProgress(requestId, 'model', message);
  const extractor = await getExtractor(requestId);
  const output = await extractor(`${modelConfig.queryPrefix}${query}`, {
    pooling: 'mean',
    normalize: true,
  });
  const dimensions = output.dims[output.dims.length - 1];

  if (dimensions !== modelConfig.dimensions) {
    output.dispose();
    throw new Error(
      `AI-модель вернула ${dimensions ?? 0} измерений вместо ${modelConfig.dimensions}`,
    );
  }

  const embedding = copyEmbedding(output.data as Float32Array, dimensions);
  output.dispose();
  return embedding;
};

const dotProductFloat = (
  queryEmbedding: Float32Array,
  documentEmbeddings: Float32Array,
  documentOffset: number,
) => {
  let score = 0;
  for (let index = 0; index < queryEmbedding.length; index += 1) {
    score += queryEmbedding[index] * documentEmbeddings[documentOffset + index];
  }
  return score;
};

const dotProductInt8 = (
  queryEmbedding: Float32Array,
  documentEmbeddings: Int8Array,
  documentOffset: number,
  scale: number,
) => {
  let score = 0;
  for (let index = 0; index < queryEmbedding.length; index += 1) {
    score += queryEmbedding[index] * documentEmbeddings[documentOffset + index];
  }
  return score / scale;
};

const matchesGenres = (
  movie: Movie,
  includeGenres: number[],
  excludeGenres: number[],
) => {
  const genres = movie.genre_ids ?? [];
  return (
    includeGenres.every((genreId) => genres.includes(genreId)) &&
    excludeGenres.every((genreId) => !genres.includes(genreId))
  );
};

const getQualityPrior = (movie: Movie) => {
  const popularity = Math.min(Math.log1p(Math.max(0, movie.popularity ?? 0)) / 8, 1);
  const voteConfidence = Math.min(Math.log1p(Math.max(0, movie.vote_count ?? 0)) / 8, 1);
  const rating = Math.max(0, Math.min(1, movie.vote_average / 10)) * voteConfidence;
  return popularity * 0.6 + rating * 0.4;
};

const normalizeTitle = (title: string) =>
  title
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const copyNormalizedIndexEmbedding = (
  embeddings: Int8Array,
  offset: number,
  dimensions: number,
  scale: number,
) => {
  const embedding = new Float32Array(dimensions);
  let squaredNorm = 0;

  for (let index = 0; index < dimensions; index += 1) {
    const value = embeddings[offset + index] / scale;
    embedding[index] = value;
    squaredNorm += value * value;
  }

  const norm = Math.sqrt(squaredNorm) || 1;
  for (let index = 0; index < dimensions; index += 1) {
    embedding[index] /= norm;
  }

  return embedding;
};

const resolveReferenceMovie = async (
  request: SearchIndexRequest,
  movieIndex: LoadedMovieIndex,
) => {
  if (!request.referenceTitle) return undefined;

  const { movies, embeddings, manifest } = movieIndex;
  const normalizedReferenceTitle = normalizeTitle(request.referenceTitle);
  const exactIndex = movies.findIndex(
    (movie) => normalizeTitle(movie.title) === normalizedReferenceTitle,
  );

  if (exactIndex >= 0) return { index: exactIndex, movie: movies[exactIndex] };

  const titleEmbedding = await embedQuery(
    request.requestId,
    request.referenceTitle,
    `Ищу фильм-референс «${request.referenceTitle}»`,
  );
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < movies.length; index += 1) {
    const semanticScore = dotProductInt8(
      titleEmbedding,
      embeddings,
      index * manifest.dimensions,
      manifest.quantization.scale,
    );
    const score = semanticScore + QUALITY_WEIGHT * getQualityPrior(movies[index]);

    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }

  return bestIndex >= 0 ? { index: bestIndex, movie: movies[bestIndex] } : undefined;
};

const sharedGenreCount = (left: number[], right: Set<number>) =>
  left.reduce((count, genreId) => count + Number(right.has(genreId)), 0);

const searchStaticIndex = async (request: SearchIndexRequest) => {
  const movieIndex = await getMovieIndex(request.requestId);
  const { movies, embeddings, manifest } = movieIndex;
  const reference = await resolveReferenceMovie(request, movieIndex);
  const queryEmbedding = reference
    ? copyNormalizedIndexEmbedding(
        embeddings,
        reference.index * manifest.dimensions,
        manifest.dimensions,
        manifest.quantization.scale,
      )
    : await embedQuery(request.requestId, request.query);
  const referenceGenres = new Set(reference?.movie.genre_ids ?? []);
  const minimumSharedGenres = referenceGenres.size >= 3 ? 2 : Math.min(1, referenceGenres.size);
  const scored: Array<{ index: number; score: number }> = [];

  postProgress(request.requestId, 'ranking', `Сравниваю запрос с ${manifest.count.toLocaleString('ru-RU')} фильмов`, 0);

  for (let movieIndexPosition = 0; movieIndexPosition < movies.length; movieIndexPosition += 1) {
    const movie = movies[movieIndexPosition];
    const movieGenres = movie.genre_ids ?? [];
    const sharedGenres = reference ? sharedGenreCount(movieGenres, referenceGenres) : 0;
    const matchesReference =
      !reference ||
      (movie.id !== reference.movie.id && sharedGenres >= minimumSharedGenres);

    if (
      matchesReference &&
      matchesGenres(movie, request.includeGenres, request.excludeGenres)
    ) {
      const semanticScore = dotProductInt8(
        queryEmbedding,
        embeddings,
        movieIndexPosition * manifest.dimensions,
        manifest.quantization.scale,
      );

      if (reference) {
        const genreOverlap = sharedGenres / Math.max(1, referenceGenres.size);
        const animationMismatch =
          !referenceGenres.has(ANIMATION_GENRE_ID) && movieGenres.includes(ANIMATION_GENRE_ID);

        scored.push({
          index: movieIndexPosition,
          score:
            REFERENCE_SEMANTIC_WEIGHT * semanticScore +
            REFERENCE_GENRE_WEIGHT * genreOverlap +
            REFERENCE_QUALITY_WEIGHT * getQualityPrior(movie) -
            (animationMismatch ? ANIMATION_MISMATCH_PENALTY : 0),
        });
      } else {
        scored.push({
          index: movieIndexPosition,
          score: semanticScore + QUALITY_WEIGHT * getQualityPrior(movie),
        });
      }
    }

    const processed = movieIndexPosition + 1;
    if (processed % 5_000 === 0 || processed === movies.length) {
      postProgress(
        request.requestId,
        'ranking',
        `Проверено ${processed.toLocaleString('ru-RU')} из ${movies.length.toLocaleString('ru-RU')}`,
        Math.round((processed / movies.length) * 100),
      );
    }
  }

  scored.sort((left, right) => right.score - left.score);
  self.postMessage({
    type: 'index-result',
    requestId: request.requestId,
    movies: scored.slice(0, Math.max(1, request.limit)).map(({ index }) => movies[index]),
    candidateCount: scored.length,
    indexSize: movies.length,
    referenceMovie: reference?.movie,
  });
};

const rankCandidates = async (request: RankRequest) => {
  const extractor = await getExtractor(request.requestId);
  const queryEmbedding = await embedQuery(request.requestId, request.query);
  const scores: Array<{ id: number; score: number }> = [];

  for (let start = 0; start < request.candidates.length; start += FALLBACK_BATCH_SIZE) {
    const batch = request.candidates.slice(start, start + FALLBACK_BATCH_SIZE);
    const passages = batch.map(({ text }) => `${modelConfig.passagePrefix}${text}`);
    const output = await extractor(passages, { pooling: 'mean', normalize: true });
    const data = output.data as Float32Array;

    batch.forEach(({ id }, index) => {
      scores.push({
        id,
        score: dotProductFloat(queryEmbedding, data, index * modelConfig.dimensions),
      });
    });

    output.dispose();

    const processed = Math.min(start + batch.length, request.candidates.length);
    const progress = Math.round((processed / request.candidates.length) * 100);
    postProgress(
      request.requestId,
      'ranking',
      `Сравниваю запрос с фильмами: ${processed} из ${request.candidates.length}`,
      progress,
    );
  }

  scores.sort((left, right) => right.score - left.score);
  self.postMessage({ type: 'rank-result', requestId: request.requestId, scores });
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось выполнить семантический поиск';

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type === 'dispose') {
    movieIndexPromise = null;
    void extractorPromise
      ?.then((extractor) => extractor.dispose())
      .finally(() => self.close());
    return;
  }

  const task = request.type === 'search-index' ? searchStaticIndex(request) : rankCandidates(request);

  void task.catch((error: unknown) => {
    self.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: getErrorMessage(error),
    });
  });
});
