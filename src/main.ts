import { restoreCache, saveCache } from '@actions/cache';
import { addPath, getInput, info } from '@actions/core';
import { exec } from '@actions/exec';
import { cacheDir, downloadTool } from '@actions/tool-cache';
import { HttpClient } from '@actions/http-client';
import { join } from 'path';
import { clean } from 'semver';

interface ReleaseJson {
  tag_name: string;
}

const owner = 'gohugoio';
const repo = 'hugo';

const releaseUrl = `https://github.com/${owner}/${repo}/releases`;

async function getRelease(
  userAgent: string,
  version: string,
): Promise<ReleaseJson | null> {
  const http: HttpClient = new HttpClient(userAgent);
  return (await http.getJson<ReleaseJson>(`${releaseUrl}/${version}`)).result;
}

function getEnvValue(envKey: string): string {
  const envValue: string | undefined = process.env[`${envKey}`];
  if (!envValue) throw new Error(`Expected ${envKey} to be defined`);
  return envValue;
}

function getOsArch(arch: string = process.arch): string {
  switch (arch) {
    case 'x64':
      return '64bit';
    case 'arm64':
    case 'arm':
      return arch.toUpperCase();
    default:
      throw new Error(`${arch} is not supported`);
  }
}

const cacheDirectory: string = getEnvValue('RUNNER_TOOL_CACHE');
const extended: string =
  getInput('extended').toLowerCase().trim() === 'true' ? '_extended' : '';
const version: string = getInput('version') || 'latest';
const args: string = getInput('args') || 'version';
const isWindows: boolean = process.platform === 'win32';
const osPlatform: string = getEnvValue('RUNNER_OS');
const osArch = getOsArch();
const userAgent = `Node.js/${process.version.substr(
  1,
)} (${osPlatform}; ${osArch})`;
const executable: string = isWindows === true ? `${repo}.exe` : repo;
const extension: string = isWindows === true ? '.zip' : '.tar.gz';

async function getHugoExec(
  semver: string,
  downloadUrl: string,
): Promise<string> {
  const downloadPath: string = await downloadTool(downloadUrl);

  let extractedFolder: string;
  if (isWindows) {
    const { extractZip } = await import('@actions/tool-cache');
    extractedFolder = await extractZip(downloadPath);
  } else {
    const { extractTar } = await import('@actions/tool-cache');
    extractedFolder = await extractTar(downloadPath);
  }

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
    const hugoRelease: ReleaseJson | null = await getRelease(
      userAgent,
      version,
    );
    if (!hugoRelease) throw Error(`Hugo version ${version} not found`);

    const tagName: string = hugoRelease.tag_name;
    const semver: string = clean(tagName) || tagName.replace(/^v/, '');

    const path: string[] = [];
    path.push(join(cacheDirectory, `${repo}${extended}`, semver, osArch));
    const key = `${osPlatform}-${osArch}-${repo}${extended}-${semver}`;

    const cacheKey: string | undefined = await restoreCache(path, key);

    if (cacheKey) {
      addPath(path[0]);
      await exec(`${executable} ${args}`);
    } else {
      info(`\u001b[38;5;4mNo cache found for key ${key}`);
      const downloadUrl = `${releaseUrl}/download/${tagName}/${repo}${extended}_${semver}_${osPlatform}-${osArch}${extension}`;
      await exec(`${await getHugoExec(semver, downloadUrl)} ${args}`);

      try {
        //const { saveCache } = await import('@actions/cache');
        const cacheId = await saveCache(path, key);
        info(`Save Cache succeeded: cacheId ${cacheId}`);
      } catch (saveCacheError) {
        const { warning } = await import('@actions/core');
        warning(`Save Cache failed: ${saveCacheError.message}`);
      }
    }
  } catch (error) {
    const { setFailed } = await import('@actions/core');
    setFailed(`Action failed with error: ${error.message}`);
  }
})();
