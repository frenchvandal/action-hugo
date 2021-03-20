import { restoreCache } from '@actions/cache';
import { addPath, getInput, info } from '@actions/core';
import { exec } from '@actions/exec';
import { cacheDir, downloadTool } from '@actions/tool-cache';
import { HttpClient } from '@actions/http-client';
import { join } from 'path';
import { clean } from 'semver';

enum Tool {
  Owner = 'gohugoio',
  Repo = 'hugo',
}

interface ReleaseJson {
  tag_name: string;
}

const releaseUrl = `https://github.com/${Tool.Owner}/${Tool.Repo}/releases`;

async function getRelease(
  userAgent: string,
  version: string,
): Promise<ReleaseJson | null> {
  const http: HttpClient = new HttpClient(userAgent);
  return (await http.getJson<ReleaseJson>(`${releaseUrl}/${version}`)).result;
}

function getEnvValue(environmentVariable: string): string {
  const envKey: string | undefined = process.env[`${environmentVariable}`];
  if (!envKey) throw new Error(`Expected ${environmentVariable} to be defined`);
  return envKey;
}

function getOsArch(arch: string = process.arch): string {
  switch (arch) {
    case 'x64':
      return '64bit';
      break;
    case 'arm64':
    case 'arm':
      return arch.toUpperCase();
      break;
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
const executable: string = isWindows === true ? `${Tool.Repo}.exe` : Tool.Repo;
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
    `${Tool.Repo}${extended}`,
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
    const semver: string = clean(tagName) ?? tagName.replace(/^v/, '');

    const path: string[] = [];
    path.push(join(cacheDirectory, `${Tool.Repo}${extended}`, semver, osArch));
    const key = `${osPlatform}-${Tool.Repo}${extended}-${semver}`;

    const cacheKey: string | undefined = await restoreCache(path, key);

    if (cacheKey) {
      addPath(path[0]);
      await exec(`${executable} ${args}`);
    } else {
      info(`\u001b[38;5;4mNo cache found for key ${key}`);
      const downloadUrl = `${releaseUrl}/download/${tagName}/${Tool.Repo}${extended}_${semver}_${osPlatform}-${osArch}${extension}`;
      await exec(`${await getHugoExec(semver, downloadUrl)} ${args}`);

      try {
        const { saveCache } = await import('@actions/cache');
        const cacheId = await saveCache(path, key);
        info(`cacheId: ${cacheId}`);
      } catch (error) {
        const { warning } = await import('@actions/core');
        warning(`Tool caching failed: ${error.message}`);
      }
    }
  } catch (error) {
    const { setFailed } = await import('@actions/core');
    setFailed(`Action failed with error: ${error.message}`);
  }
})();
