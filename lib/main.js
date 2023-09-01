import { restoreCache } from '@actions/cache';
import { addPath, getBooleanInput, getInput, info } from '@actions/core';
import { exec } from '@actions/exec';
import { join } from 'path';
import { clean } from 'semver';
const owner = 'gohugoio';
const repo = 'hugo';
const releaseUrl = `https://github.com/${owner}/${repo}/releases`;
const archMap = new Map([
  ['x64', '64bit'],
  ['arm', 'ARM'],
  ['arm64', 'ARM64'],
]);
async function getRelease(version) {
  info(`${releaseUrl}/${version}`);
  const request = await fetch(`${releaseUrl}/${version}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  const response = await request.json();
  info('response:');
  return response;
}
const getEnv = function getValueFromEnvironmentVariable(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} expected to be defined`);
  }
  return value;
};
const sourceToTarget = function convertSourceValueToTargetValue(source, map) {
  const target = map.get(source);
  if (!target) throw new Error(`${source} is not supported`);
  return target;
};
const cacheDirectory = getEnv('RUNNER_TOOL_CACHE');
const extended = getBooleanInput('extended') ? '_extended' : '';
const version = getInput('version') || 'latest';
const args = getInput('args') || 'version';
const isWindows = process.platform === 'win32';
const osPlatform = getEnv('RUNNER_OS');
const osArch = sourceToTarget(process.arch, archMap);
const executable = isWindows === true ? `${repo}.exe` : repo;
const extension = isWindows === true ? '.zip' : '.tar.gz';
async function getHugoExec(semver, downloadUrl) {
  const { downloadTool } = await import('@actions/tool-cache');
  const downloadPath = await downloadTool(downloadUrl);
  let extractedFolder;
  if (isWindows) {
    const { extractZip } = await import('@actions/tool-cache');
    extractedFolder = await extractZip(downloadPath);
  } else {
    const { extractTar } = await import('@actions/tool-cache');
    extractedFolder = await extractTar(downloadPath);
  }
  const { cacheDir } = await import('@actions/tool-cache');
  const cachedPath = await cacheDir(
    extractedFolder,
    `${repo}${extended}`,
    semver,
    osArch,
  );
  addPath(cachedPath);
  info(`Running ${executable} …`);
  return executable;
}
(async () => {
  try {
    const hugoRelease = await getRelease(version);
    if (!hugoRelease.tag_name)
      throw Error(`Hugo version ${version} ${hugoRelease.error}`);
    const tagName = hugoRelease.tag_name;
    const semver = clean(tagName) || tagName.replace(/^v/, '');
    const path = [];
    path.push(join(cacheDirectory, `${repo}${extended}`, semver, osArch));
    const key = `${osPlatform}-${osArch}-${repo}${extended}-${semver}`;
    const cacheKey = await restoreCache(path, key);
    if (cacheKey) {
      info(cacheKey);
      addPath(path[0]);
      await exec(`${executable} ${args}`);
    } else {
      info(`\u001b[38;5;4mNo cache found for key ${key}`);
      const downloadUrl = `${releaseUrl}/download/${tagName}/${repo}${extended}_${semver}_${osPlatform}-${osArch}${extension}`;
      await exec(`${await getHugoExec(semver, downloadUrl)} ${args}`);
      try {
        const { saveCache } = await import('@actions/cache');
        const cacheId = await saveCache(path, key);
        info(`Save Cache succeeded: cacheId ${cacheId}`);
      } catch (saveCacheError) {
        const { warning } = await import('@actions/core');
        warning(`Save Cache failed: ${saveCacheError.message}`);
      }
    }
  } catch (err) {
    const { setFailed } = await import('@actions/core');
    setFailed(`Action failed with error: ${err.message}`);
  }
})();
//# sourceMappingURL=main.js.map
