import { Env } from '@expo/eas-build-job';
import spawnAsync from '@expo/spawn-async';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';

import Log from './log';

export interface SentrySourcemapTarget {
  platform: string;
  runtimeVersion: string;
  updateId?: string;
  updateUUID?: string;
}

export interface UploadSourcemapsToSentryOptions {
  appVersion: string;
  branch: string;
  outputDir: string;
  packageRunner: string;
  projectDir: string;
  targets: SentrySourcemapTarget[];
  skipIfMissingAuthToken?: boolean;
}

export interface UploadSourcemapsToSentryResult {
  uploadedCount: number;
  skippedCount: number;
}

function computeUpdateUUID({
  branch,
  runtimeVersion,
  updateId,
  stringifiedMetadata,
}: {
  branch: string;
  runtimeVersion: string;
  updateId: string;
  stringifiedMetadata: string;
}): string {
  const hashInput = `${stringifiedMetadata}::${updateId}::${branch}::${runtimeVersion}`;
  const sha256Hash = crypto.createHash('sha256').update(hashInput).digest('hex');
  return `${sha256Hash.slice(0, 8)}-${sha256Hash.slice(8, 12)}-${sha256Hash.slice(12, 16)}-${sha256Hash.slice(16, 20)}-${sha256Hash.slice(20, 32)}`;
}

function isReleaseAlreadyExistsError(error: unknown): boolean {
  const maybeError = error as { stderr?: string; stdout?: string; message?: string };
  const text = [maybeError.stderr, maybeError.stdout, maybeError.message]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return text.includes('already exists');
}

export async function uploadSourcemapsToSentry({
  appVersion,
  branch,
  outputDir,
  packageRunner,
  projectDir,
  targets,
  skipIfMissingAuthToken = true,
}: UploadSourcemapsToSentryOptions): Promise<UploadSourcemapsToSentryResult> {
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
  if (!sentryAuthToken) {
    if (skipIfMissingAuthToken) {
      Log.withInfo('⚠️ SENTRY_AUTH_TOKEN not set, skipping sourcemap upload to Sentry');
      return { uploadedCount: 0, skippedCount: targets.length };
    }
    throw new Error('SENTRY_AUTH_TOKEN is not set');
  }

  let uploadedCount = 0;
  let skippedCount = 0;
  let stringifiedMetadata: string | null = null;

  const resolveStringifiedMetadata = (): string => {
    if (stringifiedMetadata) {
      return stringifiedMetadata;
    }
    const metadataJson = JSON.parse(
      fs.readFileSync(path.join(projectDir, outputDir, 'metadata.json'), 'utf8')
    );
    stringifiedMetadata = JSON.stringify(metadataJson);
    return stringifiedMetadata;
  };

  for (const { updateId, updateUUID, platform, runtimeVersion } of targets) {
    let resolvedUpdateUUID = updateUUID;
    if (!resolvedUpdateUUID) {
      if (!updateId) {
        Log.withInfo(`⚠️ Missing updateId for ${platform}, skipping sourcemap upload`);
        skippedCount += 1;
        continue;
      }
      resolvedUpdateUUID = computeUpdateUUID({
        branch,
        runtimeVersion,
        updateId,
        stringifiedMetadata: resolveStringifiedMetadata(),
      });
    }

    const sentryRelease = `${appVersion}-${platform}-${resolvedUpdateUUID}`;
    const jsDir = path.join(projectDir, outputDir, '_expo', 'static', 'js', platform);

    if (!fs.existsSync(jsDir)) {
      Log.withInfo(`⚠️ Sourcemap directory not found for ${platform}, skipping`);
      skippedCount += 1;
      continue;
    }

    const dirEntries = fs.readdirSync(jsDir);
    const hbcFile = dirEntries.find(fileName => fileName.endsWith('.hbc'));
    const mapFile = dirEntries.find(fileName => fileName.endsWith('.hbc.map'));
    if (!hbcFile || !mapFile) {
      Log.withInfo(`⚠️ Bundle or sourcemap not found for ${platform}, skipping`);
      skippedCount += 1;
      continue;
    }

    const bundlePath = path.join(jsDir, hbcFile);
    const sourcemapPath = path.join(jsDir, mapFile);

    try {
      await spawnAsync(packageRunner, ['sentry-cli', 'releases', 'new', sentryRelease], {
        cwd: projectDir,
        env: process.env as Env,
      });
    } catch (error) {
      if (!isReleaseAlreadyExistsError(error)) {
        throw error;
      }
    }

    await spawnAsync(
      packageRunner,
      [
        'sentry-cli',
        'sourcemaps',
        'upload',
        '--release',
        sentryRelease,
        '--bundle',
        bundlePath,
        '--bundle-sourcemap',
        sourcemapPath,
        '--no-rewrite',
      ],
      {
        cwd: projectDir,
        env: process.env as Env,
      }
    );

    await spawnAsync(packageRunner, ['sentry-cli', 'releases', 'finalize', sentryRelease], {
      cwd: projectDir,
      env: process.env as Env,
    });

    uploadedCount += 1;
    Log.withInfo(`✅ Sourcemaps uploaded for ${platform} (release: ${sentryRelease})`);
  }

  return { uploadedCount, skippedCount };
}
