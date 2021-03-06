import { HttpClient } from '@actions/http-client';
import { clean } from 'semver';
import { getInput } from '@actions/core';

const USER_AGENT = `Node.js/${process.version.substr(1)} (${process.platform}; ${process.arch})`;
const IS_WINDOWS: boolean = process.platform === 'win32';

interface ReleaseJson {
  tag_name: string;
}

export class GitHubRelease {
  static tag_name: string;
  static semver: string | null;
  static downloadUrl: string;
  static executable: string = IS_WINDOWS ? 'hugo.exe' : 'hugo';

  private static releaseUrl = 'https://github.com/gohugoio/hugo/releases/';
  private static version: string = getInput('version');
  private static extended: string = getInput('extended').toLowerCase() === 'true' ? 'extended_' : '';
  private static platform: string | undefined = process.env.RUNNER_OS;
  private static extension: string = IS_WINDOWS ? '.zip' : '.tar.gz';

  private static _http: HttpClient = new HttpClient(USER_AGENT);

  static async getRelease(): Promise<string> {
    const release: ReleaseJson | null = (
      await GitHubRelease._http.getJson<ReleaseJson>(`${GitHubRelease.releaseUrl}${GitHubRelease.version}`)
    ).result;

    if (release === null) {
      throw new Error(`No release found for version ${GitHubRelease.releaseUrl}${GitHubRelease.version} …`);
    } else {
      GitHubRelease.tag_name = release.tag_name;
      GitHubRelease.semver = clean(GitHubRelease.tag_name);
      GitHubRelease.downloadUrl = `${GitHubRelease.releaseUrl}download/${GitHubRelease.tag_name}/hugo_${GitHubRelease.extended}${GitHubRelease.semver}_${GitHubRelease.platform}-64bit${GitHubRelease.extension}`;
      return GitHubRelease.downloadUrl;
    }
  }
}

export { IS_WINDOWS };
