import { restoreCache, saveCache } from '@actions/cache';
import {
  addPath,
  getBooleanInput,
  getInput,
  info,
  warning,
  setFailed,
} from '@actions/core';
import { exec } from '@actions/exec';
import {
  downloadTool,
  extractZip,
  extractTar,
  cacheDir,
} from '@actions/tool-cache';
import { join } from 'path';
import { clean } from 'semver';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
const GITHUB_API = {
  owner: 'gohugoio',
  repo: 'hugo',
  baseUrl: 'https://api.github.com',
  get releaseApiUrl() {
    return `${this.baseUrl}/repos/${this.owner}/${this.repo}/releases`;
  },
  get rateLimitUrl() {
    return `${this.baseUrl}/rate_limit`;
  },
};
const ARCH_MAP = new Map([
  ['x64', '64bit'],
  ['arm', 'ARM'],
  ['arm64', 'ARM64'],
]);
class ActionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ActionError';
  }
}
const getEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new ActionError(
      `Environment variable ${name} is required but not defined`,
    );
  }
  return value;
};
const mapArchitecture = (source) => {
  const target = ARCH_MAP.get(source);
  if (!target) {
    throw new ActionError(`Architecture ${source} is not supported`);
  }
  return target;
};
const initializeConfig = () => {
  const isWindows = process.platform === 'win32';
  const extended = getBooleanInput('extended');
  const githubToken = getInput('github-token');
  return {
    isWindows,
    cacheDirectory: getEnv('RUNNER_TOOL_CACHE'),
    extended,
    version: getInput('version') || 'latest',
    args: getInput('args') || 'version',
    osPlatform: getEnv('RUNNER_OS'),
    osArch: mapArchitecture(process.arch),
    executable: isWindows ? `${GITHUB_API.repo}.exe` : GITHUB_API.repo,
    extension: isWindows ? '.zip' : '.tar.gz',
    githubToken: githubToken || undefined,
  };
};
async function fetchRelease(version, config) {
  const headers = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (config.githubToken) {
    headers['Authorization'] = `token ${config.githubToken}`;
  }
  const url =
    version === 'latest'
      ? `${GITHUB_API.releaseApiUrl}/latest`
      : `${GITHUB_API.releaseApiUrl}/tags/${version}`;
  info(`Fetching release information from: ${url}`);
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new ActionError(`Failed to fetch release: ${response.statusText}`);
  }
  return await response.json();
}
async function handleCache(config, key) {
  try {
    const cachePath = join(
      config.cacheDirectory,
      `${GITHUB_API.repo}${config.extended ? '_extended' : ''}`,
    );
    const cachedPath = await restoreCache([cachePath], key);
    if (cachedPath) {
      info(`Cache restored from key: ${key}`);
      addPath(cachedPath);
      return cachedPath;
    }
    info(`No cache found for key: ${key}`);
    return undefined;
  } catch (error) {
    warning(
      `Cache restoration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    return undefined;
  }
}
async function saveToCache(config, semver, key) {
  const cachePath = join(
    config.cacheDirectory,
    `${GITHUB_API.repo}${config.extended ? '_extended' : ''}`,
    semver,
    config.osArch,
  );
  try {
    await saveCache([cachePath], key);
    info(`Cache saved successfully with key: ${key}`);
  } catch (error) {
    warning(
      `Failed to save cache: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
async function verifyChecksum(downloadPath, release, assetName, config) {
  const checksumAsset = release.assets?.find((a) => a.name === 'checksums.txt');
  if (!checksumAsset) {
    warning('No checksum file found in release');
    return;
  }
  const headers = {
    Accept: 'application/vnd.github.v3.raw',
  };
  if (config.githubToken) {
    headers['Authorization'] = `token ${config.githubToken}`;
  }
  info(`Fetching checksum file from: ${checksumAsset.browser_download_url}`);
  const checksumResponse = await fetch(checksumAsset.browser_download_url, {
    headers,
  });
  if (!checksumResponse.ok) {
    warning('Failed to download checksum file');
    return;
  }
  const checksumContent = await checksumResponse.text();
  const checksumLines = checksumContent.split('\n');
  const checksumMap = new Map();
  for (const line of checksumLines) {
    const [checksum, file] = line.trim().split(/\s+/);
    if (checksum && file) {
      checksumMap.set(file, checksum);
    }
  }
  const expectedChecksum = checksumMap.get(assetName);
  if (!expectedChecksum) {
    warning(`No checksum found for asset ${assetName}`);
    return;
  }
  const fileBuffer = await fs.readFile(downloadPath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  const actualChecksum = hashSum.digest('hex');
  if (actualChecksum !== expectedChecksum.toLowerCase()) {
    throw new ActionError(
      `Checksum verification failed for ${assetName}. Expected: ${expectedChecksum}, Actual: ${actualChecksum}`,
    );
  }
  info(`Checksum verification passed for ${assetName}`);
}
async function installHugo(semver, downloadUrl, assetName, config, release) {
  info(`Downloading Hugo from: ${downloadUrl}`);
  const downloadPath = await downloadTool(downloadUrl);
  await verifyChecksum(downloadPath, release, assetName, config);
  let extractedFolder;
  if (config.isWindows) {
    extractedFolder = await extractZip(downloadPath);
  } else {
    extractedFolder = await extractTar(downloadPath);
  }
  const cachedPath = await cacheDir(
    extractedFolder,
    `${GITHUB_API.repo}${config.extended ? '_extended' : ''}`,
    semver,
    config.osArch,
  );
  addPath(cachedPath);
  info(`Hugo executable cached at: ${cachedPath}`);
  return cachedPath;
}
async function main() {
  try {
    const config = initializeConfig();
    const release = await fetchRelease(config.version, config);
    if (!release.tag_name) {
      throw new ActionError(
        `Invalid Hugo version ${config.version}: ${release.message || 'No tag name found'}`,
      );
    }
    const semver =
      clean(release.tag_name) || release.tag_name.replace(/^v/, '');
    const cacheKey = `${config.osPlatform}-${config.osArch}-${GITHUB_API.repo}${config.extended ? '_extended' : ''}-${semver}`;
    const cachedPath = await handleCache(config, cacheKey);
    if (!cachedPath) {
      const assetName = `${GITHUB_API.repo}${config.extended ? '_extended' : ''}_${semver}_${config.osPlatform}-${config.osArch}${config.extension}`;
      const asset = release.assets?.find((a) => a.name === assetName);
      if (!asset) {
        throw new ActionError(
          `Asset ${assetName} not found in release ${release.tag_name}`,
        );
      }
      const downloadUrl = asset.browser_download_url;
      await installHugo(semver, downloadUrl, assetName, config, release);
      await saveToCache(config, semver, cacheKey);
    }
    const argsArray = config.args.split(' ').filter((arg) => arg.length > 0);
    info(`Executing command: ${config.executable} ${argsArray.join(' ')}`);
    await exec(config.executable, argsArray);
    info('Hugo execution completed successfully.');
  } catch (error) {
    setFailed(
      `Action failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
main();
//# sourceMappingURL=main.js.map
