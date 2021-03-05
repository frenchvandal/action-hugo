import { GitHubRelease, IS_WINDOWS } from './github';
import { addPath, info } from '@actions/core';
import { cacheDir, downloadTool, extractTar, extractZip } from '@actions/tool-cache';

export async function hugoExec(): Promise<string> {
  //info(`Hugo version: ${GitHubRelease.tag_name}`);
  //info(`Downloading ${GitHubRelease.downloadUrl} …`);
  info(`runner.os: ${process.env.RUNNER_OS}`);
  info(`runner.tool_cache: ${process.env.RUNNER_TOOL_CACHE}`);
  info(`github.action: ${process.env.GITHUB_ACTION}`);

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
