import type { Movie } from '../../types/movie';

export interface SemanticCandidate {
  id: number;
  text: string;
}

export interface SemanticScore {
  id: number;
  score: number;
}

export interface StaticIndexSearchResult {
  movies: Movie[];
  candidateCount: number;
  indexSize: number;
}

export interface SemanticSearchProgress {
  stage: 'index' | 'model' | 'ranking';
  message: string;
  progress?: number;
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
  limit: number;
}

interface ProgressResponse extends SemanticSearchProgress {
  type: 'progress';
  requestId: string;
}

interface RankResultResponse {
  type: 'rank-result';
  requestId: string;
  scores: SemanticScore[];
}

interface IndexResultResponse extends StaticIndexSearchResult {
  type: 'index-result';
  requestId: string;
}

interface ErrorResponse {
  type: 'error';
  requestId: string;
  message: string;
}

type WorkerResponse = ProgressResponse | RankResultResponse | IndexResultResponse | ErrorResponse;

interface PendingRankRequest {
  kind: 'rank';
  resolve: (scores: SemanticScore[]) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: SemanticSearchProgress) => void;
}

interface PendingIndexRequest {
  kind: 'index';
  resolve: (result: StaticIndexSearchResult) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: SemanticSearchProgress) => void;
}

type PendingRequest = PendingRankRequest | PendingIndexRequest;

class BrowserSemanticSearch {
  private readonly worker = new Worker(new URL('../../workers/embedding.worker.ts', import.meta.url), {
    type: 'module',
  });

  private readonly pending = new Map<string, PendingRequest>();

  constructor() {
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
    window.addEventListener('beforeunload', this.dispose, { once: true });
  }

  rank(
    query: string,
    candidates: SemanticCandidate[],
    onProgress?: (progress: SemanticSearchProgress) => void,
  ): Promise<SemanticScore[]> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { kind: 'rank', resolve, reject, onProgress });

      const request: RankRequest = {
        type: 'rank',
        requestId,
        query,
        candidates,
      };

      this.worker.postMessage(request);
    });
  }

  searchIndex(
    query: string,
    filters: { includeGenres?: number[]; excludeGenres?: number[]; limit?: number },
    onProgress?: (progress: SemanticSearchProgress) => void,
  ): Promise<StaticIndexSearchResult> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { kind: 'index', resolve, reject, onProgress });

      const request: SearchIndexRequest = {
        type: 'search-index',
        requestId,
        query,
        includeGenres: filters.includeGenres ?? [],
        excludeGenres: filters.excludeGenres ?? [],
        limit: filters.limit ?? 60,
      };

      this.worker.postMessage(request);
    });
  }

  private readonly handleMessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const request = this.pending.get(response.requestId);
    if (!request) return;

    if (response.type === 'progress') {
      request.onProgress?.({
        stage: response.stage,
        message: response.message,
        progress: response.progress,
      });
      return;
    }

    this.pending.delete(response.requestId);

    if (response.type === 'error') {
      request.reject(new Error(response.message));
      return;
    }

    if (response.type === 'rank-result' && request.kind === 'rank') {
      request.resolve(response.scores);
      return;
    }

    if (response.type === 'index-result' && request.kind === 'index') {
      request.resolve({
        movies: response.movies,
        candidateCount: response.candidateCount,
        indexSize: response.indexSize,
      });
      return;
    }

    request.reject(new Error('AI worker вернул ответ неожиданного типа'));
  };

  private readonly handleWorkerError = (event: ErrorEvent) => {
    const error = new Error(event.message || 'Не удалось запустить браузерную AI-модель');
    this.pending.forEach(({ reject }) => reject(error));
    this.pending.clear();
  };

  private readonly dispose = () => {
    this.worker.postMessage({ type: 'dispose' });
    window.setTimeout(() => this.worker.terminate(), 250);
  };
}

let semanticSearch: BrowserSemanticSearch | null = null;

const getSemanticSearch = () => {
  semanticSearch ??= new BrowserSemanticSearch();
  return semanticSearch;
};

export const searchStaticMovieIndex = (
  query: string,
  filters: { includeGenres?: number[]; excludeGenres?: number[]; limit?: number },
  onProgress?: (progress: SemanticSearchProgress) => void,
) => getSemanticSearch().searchIndex(query, filters, onProgress);

export const rankWithBrowserModel = (
  query: string,
  candidates: SemanticCandidate[],
  onProgress?: (progress: SemanticSearchProgress) => void,
) => getSemanticSearch().rank(query, candidates, onProgress);
