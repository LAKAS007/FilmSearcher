import { appendFile, copyFile, mkdir, readFile, stat, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env, pipeline } from '@huggingface/transformers';

const parseArguments = () => {
  const values = new Map(
    process.argv.slice(2).map((argument) => {
      const [key, value = 'true'] = argument.replace(/^--/, '').split('=');
      return [key, value];
    }),
  );

  return {
    source: values.get('source') ?? '.cache/movie-index/movies.source.json',
    output: values.get('output') ?? 'public/movie-index',
    batchSize: Number(values.get('batch-size') ?? 64),
    limit: values.has('limit') ? Number(values.get('limit')) : undefined,
  };
};

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));

const formatMovieForEmbedding = (movie, genreNames, passagePrefix) => {
  const genres = movie.genre_ids
    ?.map((genreId) => genreNames.get(genreId))
    .filter(Boolean)
    .join(', ');
  const year = movie.release_date?.slice(0, 4);

  return `${passagePrefix}${[
    movie.title,
    year && `Year: ${year}`,
    genres && `Genres: ${genres}`,
    `Rating: ${Number(movie.vote_average ?? 0).toFixed(1)}`,
    movie.overview && `Description: ${movie.overview.slice(0, 1_200)}`,
  ]
    .filter(Boolean)
    .join('. ')}`;
};

const toPublicMovie = (movie) => ({
  id: movie.id,
  title: movie.title,
  poster_path: movie.poster_path ?? null,
  backdrop_path: movie.backdrop_path ?? null,
  overview: movie.overview ?? '',
  release_date: movie.release_date ?? '',
  vote_average: movie.vote_average ?? 0,
  vote_count: movie.vote_count ?? 0,
  popularity: movie.popularity ?? 0,
  genre_ids: movie.genre_ids ?? [],
  original_language: movie.original_language ?? '',
});

const quantize = (data, scale) => {
  const result = new Int8Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    result[index] = Math.max(-127, Math.min(127, Math.round(data[index] * scale)));
  }
  return result;
};

const main = async () => {
  const options = parseArguments();
  const modelConfig = await readJson('movie-index.config.json');
  const source = await readJson(options.source);
  const movies = source.movies.slice(0, options.limit ?? source.movies.length);
  const genres = new Map(source.genres.map(({ id, name }) => [id, name]));

  if (!movies.length) throw new Error('The source catalog is empty.');
  if (!Number.isInteger(options.batchSize) || options.batchSize <= 0) {
    throw new Error('--batch-size must be a positive integer.');
  }

  const cacheDirectory = '.cache/transformers';
  const workDirectory = '.cache/movie-index';
  const checkpointPath = path.join(workDirectory, `embeddings-${movies.length}.checkpoint.json`);
  const partialEmbeddingsPath = path.join(workDirectory, `embeddings-${movies.length}.int8.part`);
  const existingCheckpoint = await readFile(checkpointPath, 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
  const processed = existingCheckpoint?.processed ?? 0;

  if (existingCheckpoint) {
    const checkpointMatches =
      existingCheckpoint.count === movies.length &&
      existingCheckpoint.dimensions === modelConfig.dimensions &&
      existingCheckpoint.modelId === modelConfig.modelId &&
      existingCheckpoint.modelRevision === modelConfig.modelRevision;

    if (!checkpointMatches) {
      throw new Error(`Embedding checkpoint ${checkpointPath} belongs to another index configuration.`);
    }

    const partialStats = await stat(partialEmbeddingsPath);
    const expectedBytes = processed * modelConfig.dimensions;
    if (partialStats.size < expectedBytes || partialStats.size % modelConfig.dimensions !== 0) {
      throw new Error(
        `Embedding checkpoint is inconsistent: expected at least ${expectedBytes} aligned bytes, found ${partialStats.size}.`,
      );
    }
    if (partialStats.size > expectedBytes) {
      console.log(`Truncating an unfinished batch from ${partialStats.size} to ${expectedBytes} bytes.`);
      await truncate(partialEmbeddingsPath, expectedBytes);
    }
  } else {
    await mkdir(workDirectory, { recursive: true });
    await writeFile(partialEmbeddingsPath, new Uint8Array());
  }

  env.cacheDir = cacheDirectory;
  let lastModelProgress = -1;
  console.log(`Loading ${modelConfig.modelId}...`);

  const extractor = await pipeline('feature-extraction', modelConfig.modelId, {
    revision: modelConfig.modelRevision,
    dtype: modelConfig.modelDtype,
    progress_callback: (info) => {
      if (info.status !== 'progress_total') return;
      const progress = Math.floor(info.progress / 10) * 10;
      if (progress !== lastModelProgress) {
        lastModelProgress = progress;
        console.log(`Model: ${progress}%`);
      }
    },
  });

  const startedAt = Date.now();

  try {
    for (let start = processed; start < movies.length; start += options.batchSize) {
      const batch = movies.slice(start, start + options.batchSize);
      const texts = batch.map((movie) =>
        formatMovieForEmbedding(movie, genres, modelConfig.passagePrefix),
      );
      const output = await extractor(texts, { pooling: 'mean', normalize: true });
      const dimensions = output.dims[output.dims.length - 1];

      if (dimensions !== modelConfig.dimensions) {
        output.dispose();
        throw new Error(`Expected ${modelConfig.dimensions} dimensions, received ${dimensions}.`);
      }

      const quantized = quantize(output.data, modelConfig.quantizationScale);
      output.dispose();
      await appendFile(partialEmbeddingsPath, Buffer.from(quantized.buffer));

      const completed = start + batch.length;
      await writeFile(
        checkpointPath,
        JSON.stringify({
          processed: completed,
          count: movies.length,
          dimensions: modelConfig.dimensions,
          modelId: modelConfig.modelId,
          modelRevision: modelConfig.modelRevision,
        }),
      );

      if (completed === movies.length || completed % (options.batchSize * 10) === 0) {
        const elapsedSeconds = (Date.now() - startedAt) / 1_000;
        const currentRunCount = completed - processed;
        const rate = currentRunCount / Math.max(elapsedSeconds, 0.001);
        const remainingSeconds = (movies.length - completed) / Math.max(rate, 0.001);
        console.log(
          `Embeddings: ${completed}/${movies.length} · ${rate.toFixed(1)} movies/s · ETA ${Math.ceil(remainingSeconds)}s`,
        );
      }
    }
  } finally {
    await extractor.dispose();
  }

  await mkdir(options.output, { recursive: true });
  await copyFile(partialEmbeddingsPath, path.join(options.output, 'embeddings.int8.bin'));
  await writeFile(
    path.join(options.output, 'movies.json'),
    JSON.stringify(movies.map(toPublicMovie)),
  );
  await writeFile(
    path.join(options.output, 'manifest.json'),
    JSON.stringify(
      {
        version: modelConfig.version,
        generatedAt: new Date().toISOString(),
        count: movies.length,
        dimensions: modelConfig.dimensions,
        model: {
          id: modelConfig.modelId,
          revision: modelConfig.modelRevision,
          dtype: modelConfig.modelDtype,
          pooling: 'mean',
          normalize: true,
          queryPrefix: modelConfig.queryPrefix,
          passagePrefix: modelConfig.passagePrefix,
        },
        quantization: {
          type: modelConfig.quantization,
          scale: modelConfig.quantizationScale,
        },
        files: {
          movies: 'movies.json',
          embeddings: 'embeddings.int8.bin',
        },
        source: {
          provider: 'TMDB',
          generatedAt: source.generatedAt,
          language: source.config?.language,
        },
      },
      null,
      2,
    ),
  );

  console.log(`Static index saved to ${options.output}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
