import { HttpClient } from '@actions/http-client';
import { clean } from 'semver';
import { getInput } from '@actions/core';

interface releaseJson {
  tag_name: string;
}

export class gitHubRelease {
  static tag_name: string;
  static semver: string | null;
  static downloadUrl: string;
  static executable: string = process.platform === 'win32' ? 'hugo.exe' : 'hugo';

  private static releaseUrl = 'https://github.com/gohugoio/hugo/releases/';
  private static version: string = getInput('version');
  private static extended: string = getInput('extended').toLowerCase() === 'true' ? 'extended_' : '';
  private static platform: string =
    process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
  private static extension: string = process.platform === 'win32' ? '.zip' : '.tar.gz';

  private static _http: HttpClient = new HttpClient(
    `Node.js/${process.version.substr(1)} (${process.platform}; ${process.arch})`,
  );

  static async getRelease(): Promise<string> {
    const release: releaseJson | null = (
      await gitHubRelease._http.getJson<releaseJson>(`${gitHubRelease.releaseUrl}${gitHubRelease.version}`)
    ).result;

    if (release === null) {
      throw new Error(`No release found for version ${gitHubRelease.releaseUrl}${gitHubRelease.version} …`);
    } else {
      gitHubRelease.tag_name = release.tag_name;
      gitHubRelease.semver = clean(gitHubRelease.tag_name);
      gitHubRelease.downloadUrl = `${gitHubRelease.releaseUrl}download/${gitHubRelease.tag_name}/hugo_${gitHubRelease.extended}${gitHubRelease.semver}_${gitHubRelease.platform}-64bit${gitHubRelease.extension}`;
      return gitHubRelease.downloadUrl;
    }
  }
}
