import { Movie, MovieResponse, MovieDetails, Genre } from '../types/movie';

const API_KEY = '8265bd1679663a7ea12ac168da84d2e8'; // Public TMDB API key for demo
const BASE_URL = 'https://api.themoviedb.org/3';
export const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

class TMDBService {
  private async fetch<T>(endpoint: string): Promise<T> {
    const url = `${BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`TMDB API Error: ${response.statusText}`);
    }

    return response.json();
  }

  async getTrending(timeWindow: 'day' | 'week' = 'week'): Promise<Movie[]> {
    const data = await this.fetch<MovieResponse>(`/trending/movie/${timeWindow}`);
    return data.results;
  }

  async searchMovies(query: string, page: number = 1): Promise<MovieResponse> {
    if (!query.trim()) {
      return this.getPopular(page);
    }
    return this.fetch<MovieResponse>(`/search/movie?query=${encodeURIComponent(query)}&page=${page}`);
  }

  async getPopular(page: number = 1): Promise<MovieResponse> {
    return this.fetch<MovieResponse>(`/movie/popular?page=${page}`);
  }

  async getTopRated(page: number = 1): Promise<MovieResponse> {
    return this.fetch<MovieResponse>(`/movie/top_rated?page=${page}`);
  }

  async getMovieDetails(movieId: number): Promise<MovieDetails> {
    return this.fetch<MovieDetails>(`/movie/${movieId}`);
  }

  async getGenres(): Promise<Genre[]> {
    const data = await this.fetch<{ genres: Genre[] }>('/genre/movie/list');
    return data.genres;
  }

  async getMoviesByGenre(genreId: number, page: number = 1): Promise<MovieResponse> {
    return this.fetch<MovieResponse>(`/discover/movie?with_genres=${genreId}&page=${page}&sort_by=popularity.desc`);
  }

  getImageUrl(path: string | null, size: 'w200' | 'w300' | 'w500' | 'w780' | 'original' = 'w500'): string {
    if (!path) {
      return 'https://via.placeholder.com/500x750/1a1a1a/666666?text=No+Image';
    }
    return `${IMAGE_BASE_URL}/${size}${path}`;
  }
}

export const tmdbService = new TMDBService();
