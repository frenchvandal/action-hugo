import { restoreCache, saveCache } from '@actions/cache';
import { addPath, getInput, info, setFailed, warning } from '@actions/core';
import { exec } from '@actions/exec';
import { HttpClient } from '@actions/http-client';
import { cacheDir, downloadTool, extractTar, extractZip } from '@actions/tool-cache';
import { join } from 'path';
import { clean } from 'semver';

enum Tool {
  Owner = 'gohugoio',
  Repo = 'hugo',
}

interface ReleaseJson {
  tag_name: string;
}

const releaseUrl = `https://github.com/${Tool.Owner}/${Tool.Repo}/releases/`;

async function getRelease(userAgent: string, version: string): Promise<ReleaseJson | null> {
  const http: HttpClient = new HttpClient(userAgent);
  return (await http.getJson<ReleaseJson>(`${releaseUrl}${version}`)).result;
}

function getOS(): string {
  if (process.env['RUNNER_OS']) {
    return process.env['RUNNER_OS'];
  } else {
    switch (process.platform) {
      case 'linux':
        return 'Linux';
      case 'darwin':
        return 'macOS';
      case 'win32':
        return 'Windows';
      default:
        throw new Error(`${process.platform} is not supported`);
    }
  }
}

function getCacheDirectory(): string {
  if (process.env['RUNNER_TOOL_CACHE']) {
    return process.env['RUNNER_TOOL_CACHE'];
  } else {
    throw new Error('Expected RUNNER_TOOL_CACHE to be defined');
  }
}

const cacheDirectory: string = getCacheDirectory();
const extended: string = getInput('extended').toLowerCase() === 'true' ? '_extended' : '';
const version: string = getInput('version');
const args: string = getInput('args');
const isWindows: boolean = process.platform === 'win32';
const osPlatform: string = getOS();
const osArch: string = process.arch;
const userAgent = `Node.js/${process.version.substr(1)} (${osPlatform}; ${osArch})`;
const executable: string = isWindows === true ? `${Tool.Repo}.exe` : Tool.Repo;
const extension: string = isWindows === true ? '.zip' : '.tar.gz';

async function hugoExec(semver: string, downloadUrl: string): Promise<string> {
  const downloadPath: string = await downloadTool(downloadUrl);

  let extractedFolder: string;
  if (isWindows) {
    extractedFolder = await extractZip(downloadPath);
  } else {
    extractedFolder = await extractTar(downloadPath);
  }

  const cachedPath: string = await cacheDir(extractedFolder, Tool.Repo, semver);

  addPath(cachedPath);

  info(`Running ${executable} …`);
  return executable;
}

(async (): Promise<void> => {
  try {
    const hugoRelease: ReleaseJson | null = await getRelease(userAgent, version);

    if (!hugoRelease) {
      throw new Error(`Hugo version ${version} not found`);
    }
    const tagName: string = hugoRelease.tag_name;
    const semver: string = clean(tagName) ?? tagName.replace(/^v/, '');
    const path: string = join(cacheDirectory, `${Tool.Repo}${extended}`, semver, process.arch);
    const paths: string[] = Array.from(path);
    const key = `${Tool.Repo}${extended}-${semver}`;
    const cacheKey: string | undefined = await restoreCache(paths, key);

    if (cacheKey) {
      addPath(path);
      await exec(`${executable} ${args}`);
    } else {
      const downloadUrl = `${releaseUrl}download/${tagName}/${Tool.Repo}${extended}_${semver}_${osPlatform}-64bit${extension}`;
      await exec(`${await hugoExec(semver, downloadUrl)} ${getInput('args')}`);

      try {
        const cacheId = await saveCache(paths, key);
        info(`cacheId: ${cacheId}`);
      } catch (error) {
        warning(`Saving cache failed with ${error.message}`);
      }
    }
  } catch (error) {
    setFailed(`Action failed with error: ${error.message}`);
  }
})();
