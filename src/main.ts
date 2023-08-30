import { restoreCache } from '@actions/cache';
import { addPath, getBooleanInput, getInput, info } from '@actions/core';
import { exec } from '@actions/exec';
import { join } from 'path';
import { clean } from 'semver';

interface ReleaseJson {
  tag_name: string;
}

const owner = 'gohugoio';
const repo = 'hugo';
const releaseUrl = `https://github.com/${owner}/${repo}/releases`;
const archMap = new Map<string, string>([
  ['x64', '64bit'],
  ['arm', 'ARM'],
  ['arm64', 'ARM64'],
]);

async function getRelease(version: string) {
  const request = await fetch(`${releaseUrl}/${version}`);
  const response = await request.json();
  info('response:');
  console.log(response);
  info('OK?');
  console.log(response.ok);
  return response;
}

const getEnv = function getValueFromEnvironmentVariable(name: string): string {
  const value: string | undefined = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} expected to be defined`);
  }
  return value;
};

const sourceToTarget = function convertSourceValueToTargetValue(
  source: string,
  map: Map<string, string>,
): string {
  const target: string | undefined = map.get(source);
  if (!target) throw new Error(`${source} is not supported`);
  return target;
};

const cacheDirectory: string = getEnv('RUNNER_TOOL_CACHE');
const extended: string = getBooleanInput('extended') ? '_extended' : '';
const version: string = getInput('version') || 'latest';
const args: string = getInput('args') || 'version';
const isWindows: boolean = process.platform === 'win32';
const osPlatform: string = getEnv('RUNNER_OS');
const osArch = sourceToTarget(process.arch, archMap);
const executable: string = isWindows === true ? `${repo}.exe` : repo;
const extension: string = isWindows === true ? '.zip' : '.tar.gz';

async function getHugoExec(
  semver: string,
  downloadUrl: string,
): Promise<string> {
  const { downloadTool } = await import('@actions/tool-cache');
  const downloadPath: string = await downloadTool(downloadUrl);

  let extractedFolder: string;
  if (isWindows) {
    const { extractZip } = await import('@actions/tool-cache');
    extractedFolder = await extractZip(downloadPath);
  } else {
    const { extractTar } = await import('@actions/tool-cache');
    extractedFolder = await extractTar(downloadPath);
  }

  const { cacheDir } = await import('@actions/tool-cache');

  const cachedPath: string = await cacheDir(
    extractedFolder,
    `${repo}${extended}`,
    semver,
    osArch,
  );

  addPath(cachedPath);

  info(`Running ${executable} …`);
  return executable;
}

(async (): Promise<void> => {
  try {
    const hugoRelease: ReleaseJson | null = await getRelease(version);
    if (!hugoRelease) throw Error(`Hugo version ${version} not found`);

    const tagName: string = hugoRelease.tag_name;
    const semver: string = clean(tagName) || tagName.replace(/^v/, '');

    const path: string[] = [];
    path.push(join(cacheDirectory, `${repo}${extended}`, semver, osArch));
    info('path:');
    info(path[0]);
    const key = `${osPlatform}-${osArch}-${repo}${extended}-${semver}`;
    info('key:');
    info(key);

    const cacheKey: string | undefined = await restoreCache(path, key);

    if (cacheKey) {
      info('cacheKey:');
      info(cacheKey);
      addPath(path[0]);
      await exec(`${executable} ${args}`);
    } else {
      info(`\u001b[38;5;4mNo cache found for key ${key}`);
      const downloadUrl = `${releaseUrl}/download/${tagName}/${repo}${extended}_${semver}_${osPlatform}-${osArch}${extension}`;
      await exec(`${await getHugoExec(semver, downloadUrl)} ${args}`);

      try {
        const { saveCache } = await import('@actions/cache');
        const cacheId: number = await saveCache(path, key);
        info(`Save Cache succeeded: cacheId ${cacheId}`);
      } catch (saveCacheError: any) {
        const { warning } = await import('@actions/core');
        warning(`Save Cache failed: ${saveCacheError.message}`);
      }
    }
  } catch (err: any) {
    const { setFailed } = await import('@actions/core');
    setFailed(`Action failed with error: ${err.message}`);
  }
})();
