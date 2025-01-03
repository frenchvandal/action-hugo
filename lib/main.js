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
const GITHUB_API = {
  owner: 'gohugoio',
  repo: 'hugo',
  get releaseUrl() {
    return `https://github.com/${this.owner}/${this.repo}/releases`;
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
  return {
    isWindows,
    cacheDirectory: getEnv('RUNNER_TOOL_CACHE'),
    extended: getBooleanInput('extended') ? '_extended' : '',
    version: getInput('version') || 'latest',
    args: getInput('args') || 'version',
    osPlatform: getEnv('RUNNER_OS'),
    osArch: mapArchitecture(process.arch),
    executable: isWindows ? `${GITHUB_API.repo}.exe` : GITHUB_API.repo,
    extension: isWindows ? '.zip' : '.tar.gz',
  };
};
async function fetchRelease(version) {
  const url = `${GITHUB_API.releaseUrl}/${version}`;
  info(`Fetching release information from: ${url}`);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new ActionError(`Failed to fetch release: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    throw new ActionError(
      `Failed to fetch release information: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
async function installHugo(semver, downloadUrl, config) {
  info(`Downloading Hugo from: ${downloadUrl}`);
  const downloadPath = await downloadTool(downloadUrl);
  const extractedFolder = config.isWindows
    ? await extractZip(downloadPath)
    : await extractTar(downloadPath);
  const cachedPath = await cacheDir(
    extractedFolder,
    `${GITHUB_API.repo}${config.extended}`,
    semver,
    config.osArch,
  );
  addPath(cachedPath);
  info(`Hugo executable cached at: ${cachedPath}`);
}
async function handleCache(config, paths, key) {
  try {
    const cacheKey = await restoreCache(paths, key);
    if (cacheKey) {
      info(`Cache restored from key: ${cacheKey}`);
      addPath(paths[0]);
      return true;
    }
    info(`No cache found for key: ${key}`);
    return false;
  } catch (error) {
    warning(
      `Cache restoration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    return false;
  }
}
async function saveToCache(paths, key) {
  try {
    const cacheId = await saveCache(paths, key);
    info(`Cache saved successfully with ID: ${cacheId}`);
  } catch (error) {
    warning(
      `Failed to save cache: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
async function main() {
  try {
    const config = initializeConfig();
    const release = await fetchRelease(config.version);
    if (!release.tag_name) {
      throw new ActionError(
        `Invalid Hugo version ${config.version}: ${release.error || 'No tag name found'}`,
      );
    }
    const semver =
      clean(release.tag_name) || release.tag_name.replace(/^v/, '');
    const cachePath = join(
      config.cacheDirectory,
      `${GITHUB_API.repo}${config.extended}`,
      semver,
      config.osArch,
    );
    const cacheKey = `${config.osPlatform}-${config.osArch}-${GITHUB_API.repo}${config.extended}-${semver}`;
    const cacheHit = await handleCache(config, [cachePath], cacheKey);
    if (!cacheHit) {
      const downloadUrl = `${GITHUB_API.releaseUrl}/download/${release.tag_name}/${GITHUB_API.repo}${config.extended}_${semver}_${config.osPlatform}-${config.osArch}${config.extension}`;
      await installHugo(semver, downloadUrl, config);
      await saveToCache([cachePath], cacheKey);
    }
    await exec(`${config.executable} ${config.args}`);
  } catch (error) {
    setFailed(
      `Action failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
main();
//# sourceMappingURL=main.js.map
