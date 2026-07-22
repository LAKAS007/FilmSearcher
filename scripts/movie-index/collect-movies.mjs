import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API_BASE_URL = 'https://api.themoviedb.org/3';
const DEFAULT_TARGET = 50_000;
const DEFAULT_YEAR_FROM = 1900;
const DEFAULT_YEAR_TO = new Date().getFullYear();
const REQUEST_BATCH_SIZE = 5;
const REQUEST_BATCH_DELAY_MS = 300;
const CHECKPOINT_EVERY_YEARS = 5;

const parseArguments = () => {
  const values = new Map(
    process.argv.slice(2).map((argument) => {
      const [key, value = 'true'] = argument.replace(/^--/, '').split('=');
      return [key, value];
    }),
  );

  return {
    target: Number(values.get('target') ?? DEFAULT_TARGET),
    yearFrom: Number(values.get('year-from') ?? DEFAULT_YEAR_FROM),
    yearTo: Number(values.get('year-to') ?? DEFAULT_YEAR_TO),
    minVotes: Number(values.get('min-votes') ?? 5),
    language: values.get('language') ?? 'en-US',
    output: values.get('output') ?? '.cache/movie-index/movies.source.json',
    checkpoint: values.get('checkpoint') ?? '.cache/movie-index/catalog.checkpoint.json',
  };
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const readJsonIfExists = async (filePath) => {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const fetchJson = async (url, attempt = 0) => {
  const response = await fetch(url);

  if (response.ok) return response.json();

  if ((response.status === 429 || response.status >= 500) && attempt < 6) {
    const retryAfter = Number(response.headers.get('retry-after'));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 750 * 2 ** attempt;
    await delay(backoff);
    return fetchJson(url, attempt + 1);
  }

  throw new Error(`TMDB request failed: ${response.status} ${response.statusText}`);
};

const makeApiUrl = (endpoint, apiKey, parameters = {}) => {
  const url = new URL(`${API_BASE_URL}${endpoint}`);
  url.searchParams.set('api_key', apiKey);

  Object.entries(parameters).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });

  return url;
};

const baseYearWeight = (year, currentYear) => {
  const age = currentYear - year;
  if (age <= 10) return 1_600;
  if (age <= 30) return 1_000;
  if (age <= 60) return 350;
  return 30;
};

const buildYearQuotas = (years, target) => {
  const currentYear = Math.max(...years);
  const weights = years.map((year) => baseYearWeight(year, currentYear));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const quotas = weights.map((weight) => Math.max(1, Math.floor((weight / totalWeight) * target)));
  let missing = target - quotas.reduce((total, quota) => total + quota, 0);

  for (let index = 0; missing > 0; index = (index + 1) % quotas.length) {
    quotas[index] += 1;
    missing -= 1;
  }

  return new Map(years.map((year, index) => [year, quotas[index]]));
};

const isUsableMovie = (movie) =>
  movie &&
  typeof movie.id === 'number' &&
  typeof movie.title === 'string' &&
  movie.title.trim() &&
  typeof movie.overview === 'string' &&
  movie.overview.trim();

const main = async () => {
  const options = parseArguments();
  const apiKey = process.env.TMDB_API_KEY;

  if (!apiKey) {
    throw new Error('Set TMDB_API_KEY before running the catalog collector.');
  }
  if (!Number.isInteger(options.target) || options.target <= 0) {
    throw new Error('--target must be a positive integer.');
  }
  if (options.yearFrom > options.yearTo) {
    throw new Error('--year-from must be less than or equal to --year-to.');
  }

  const years = Array.from(
    { length: options.yearTo - options.yearFrom + 1 },
    (_, index) => options.yearTo - index,
  );
  const quotas = buildYearQuotas(years, options.target);
  const checkpoint = (await readJsonIfExists(options.checkpoint)) ?? {
    config: options,
    movies: [],
    completedYears: [],
    yearCounts: {},
  };

  const checkpointMatches =
    checkpoint.config?.target === options.target &&
    checkpoint.config?.yearFrom === options.yearFrom &&
    checkpoint.config?.yearTo === options.yearTo &&
    checkpoint.config?.minVotes === options.minVotes &&
    checkpoint.config?.language === options.language;

  if (!checkpointMatches) {
    throw new Error(
      `Checkpoint ${options.checkpoint} belongs to another configuration. Use a different --checkpoint path.`,
    );
  }

  const movies = checkpoint.movies;
  const completedYears = new Set(checkpoint.completedYears);
  const seenIds = new Set(movies.map(({ id }) => id));
  let yearsSinceCheckpoint = 0;
  let carry = 0;

  const genresResponse = await fetchJson(
    makeApiUrl('/genre/movie/list', apiKey, { language: options.language }),
  );

  const saveCheckpoint = async () => {
    await mkdir(path.dirname(options.checkpoint), { recursive: true });
    await writeFile(
      options.checkpoint,
      JSON.stringify({
        config: options,
        movies,
        completedYears: [...completedYears],
        yearCounts: checkpoint.yearCounts,
      }),
    );
    yearsSinceCheckpoint = 0;
  };

  const saveAndExit = async () => {
    console.log('\nSaving checkpoint before exit...');
    await saveCheckpoint();
    process.exit(130);
  };

  process.once('SIGINT', () => void saveAndExit());
  process.once('SIGTERM', () => void saveAndExit());

  for (const year of years) {
    const quota = quotas.get(year) ?? 0;

    if (completedYears.has(year)) {
      const alreadyAdded = checkpoint.yearCounts[year] ?? 0;
      carry = Math.max(0, quota + carry - alreadyAdded);
      continue;
    }

    const desiredForYear = Math.min(options.target - movies.length, quota + carry);
    if (desiredForYear <= 0) break;

    let addedForYear = 0;
    let nextPage = 1;
    let totalPages = 1;

    while (nextPage <= totalPages && nextPage <= 500 && addedForYear < desiredForYear) {
      const pages = Array.from(
        { length: Math.min(REQUEST_BATCH_SIZE, totalPages - nextPage + 1) },
        (_, index) => nextPage + index,
      );

      if (nextPage === 1) pages.splice(1);

      const responses = await Promise.all(
        pages.map((page) =>
          fetchJson(
            makeApiUrl('/discover/movie', apiKey, {
              include_adult: false,
              include_video: false,
              language: options.language,
              page,
              primary_release_year: year,
              sort_by: 'popularity.desc',
              'vote_count.gte': options.minVotes,
            }),
          ),
        ),
      );

      totalPages = Math.min(500, responses[0]?.total_pages ?? totalPages);

      for (const response of responses) {
        for (const movie of response.results ?? []) {
          if (addedForYear >= desiredForYear || movies.length >= options.target) break;
          if (!isUsableMovie(movie) || seenIds.has(movie.id)) continue;

          seenIds.add(movie.id);
          movies.push(movie);
          addedForYear += 1;
        }
      }

      nextPage += pages.length;
      if (nextPage <= totalPages && addedForYear < desiredForYear) {
        await delay(REQUEST_BATCH_DELAY_MS);
      }
    }

    checkpoint.yearCounts[year] = addedForYear;
    completedYears.add(year);
    carry = Math.max(0, desiredForYear - addedForYear);
    yearsSinceCheckpoint += 1;

    console.log(
      `${year}: +${addedForYear}/${desiredForYear}, total ${movies.length}/${options.target}`,
    );

    if (yearsSinceCheckpoint >= CHECKPOINT_EVERY_YEARS) await saveCheckpoint();
    if (movies.length >= options.target) break;
  }

  await saveCheckpoint();
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(
    options.output,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: 'TMDB discover/movie',
      config: options,
      genres: genresResponse.genres ?? [],
      movies: movies.slice(0, options.target),
    }),
  );

  console.log(`Catalog saved: ${options.output} (${Math.min(movies.length, options.target)} movies)`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
