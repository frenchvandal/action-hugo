import { IS_WINDOWS, GitHubRelease } from './github';
import { info, addPath } from '@actions/core';
import { downloadTool, extractZip, extractTar, cacheDir } from '@actions/tool-cache';

export async function hugoExec(): Promise<string> {
  info(`Hugo version: ${GitHubRelease.tag_name}`);
  info(`Downloading ${GitHubRelease.downloadUrl} …`);

  const downloadPath: string = await downloadTool(await GitHubRelease.getRelease());

  let extractedFolder: string;
  if (IS_WINDOWS) {
    extractedFolder = await extractZip(downloadPath);
  } else {
    extractedFolder = await extractTar(downloadPath);
  }

  const semver: string = GitHubRelease?.semver ?? GitHubRelease.tag_name.replace(/^v/, '');
  //const cachedPath: string = await cacheDir(extractedFolder, 'hugo', GitHubRelease.semver!);
  const cachedPath: string = await cacheDir(extractedFolder, 'hugo', semver);

  addPath(cachedPath);

  info(`Running ${GitHubRelease.executable} …`);
  return GitHubRelease.executable;
}
