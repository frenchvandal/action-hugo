import { gitHubRelease } from './github';
import { info, addPath } from '@actions/core';
import { downloadTool, extractZip, extractTar, cacheDir } from '@actions/tool-cache';

const IS_WINDOWS: boolean = process.platform === 'win32';

export async function hugoExec(): Promise<string> {
  info(`Hugo version: ${gitHubRelease.tag_name}`);
  info(`Downloading ${gitHubRelease.downloadUrl} …`);

  const downloadPath: string = await downloadTool(await gitHubRelease.getRelease());

  let extractedFolder: string;
  if (IS_WINDOWS) {
    extractedFolder = await extractZip(downloadPath);
  } else {
    extractedFolder = await extractTar(downloadPath);
  }

  const semver: string = gitHubRelease?.semver ?? gitHubRelease.tag_name.replace(/^v/, '');
  //const cachedPath: string = await cacheDir(extractedFolder, 'hugo', gitHubRelease.semver!);
  const cachedPath: string = await cacheDir(extractedFolder, 'hugo', semver);

  addPath(cachedPath);

  info(`Running ${gitHubRelease.executable} …`);
  return gitHubRelease.executable;
}
