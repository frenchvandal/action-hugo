// main.ts
import { restoreCache, saveCache } from '@actions/cache';
import {
  addPath,
  getBooleanInput,
  getIDToken,
  getInput,
  info,
  warning,
  setFailed,
  platform,
  summary,
} from '@actions/core';
import { exec } from '@actions/exec';
import {
  downloadTool,
  extractZip,
  extractTar,
  cacheDir,
} from '@actions/tool-cache';
import { join } from 'path';
import { clean } from 'semver';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import Credential, { Config } from '@alicloud/credentials';
import { env, cwd } from 'process';

// Types et interfaces
interface GithubRelease {
  tag_name?: string;
  assets?: Array<{ name: string; browser_download_url: string }>;
  message?: string;
}

interface ActionConfig {
  isWindows: boolean;
  cacheDirectory: string;
  extended: boolean;
  version: string;
  args: string;
  osPlatform: string;
  osArch: string;
  executable: string;
  extension: string;
  githubToken?: string;
}

// Constants
const GITHUB_API = {
  owner: 'gohugoio',
  repo: 'hugo',
  baseUrl: 'https://api.github.com',
  get releaseApiUrl(): string {
    return `${this.baseUrl}/repos/${this.owner}/${this.repo}/releases`;
  },
} as const;

const ARCH_MAP = new Map<string, string>([
  ['x64', '64bit'],
  ['arm', 'ARM'],
  ['arm64', 'ARM64'],
]);

// Utilitaires
class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionError';
  }
}

const getEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new ActionError(
      `Environment variable ${name} is required but not defined`,
    );
  }
  return value;
};

const mapArchitecture = (source: string): string => {
  const target = ARCH_MAP.get(source);
  if (!target) {
    throw new ActionError(`Architecture ${source} is not supported`);
  }
  return target;
};

// Fonction pour capitaliser la première lettre
const capitalizeFirstLetter = (str: string): string => {
  if (!str) return str;
  return `${str.charAt(0).toUpperCase()}${str.slice(1)}`;
};

// Configuration initiale de l'action
const initializeConfig = (): ActionConfig => {
  const isWindows = platform.isWindows;
  const extended = getBooleanInput('extended');
  const githubToken = getInput('github-token');
  return {
    isWindows,
    cacheDirectory: getEnv('RUNNER_TOOL_CACHE'),
    extended,
    version: getInput('version') || 'latest',
    args: getInput('args') || 'version',
    osPlatform: platform.platform, // 'win32' | 'darwin' | 'linux' | etc.
    osArch: mapArchitecture(platform.arch), // '64bit' | 'ARM' | 'ARM64'
    executable: isWindows ? `${GITHUB_API.repo}.exe` : GITHUB_API.repo,
    extension: isWindows ? '.zip' : '.tar.gz',
    githubToken: githubToken || undefined,
  };
};

// Gestion des releases GitHub
const fetchRelease = async (
  version: string,
  config: ActionConfig,
): Promise<GithubRelease> => {
  const headers: HeadersInit = {
    Accept: 'application/vnd.github.v3+json',
  };

  if (config.githubToken) {
    headers.Authorization = `token ${config.githubToken}`;
  }

  const url =
    version === 'latest'
      ? `${GITHUB_API.releaseApiUrl}/latest`
      : `${GITHUB_API.releaseApiUrl}/tags/${version}`;

  info(`Fetching release information from: ${url}`);
  summary.addRaw(`Fetching release information from: [${url}](${url})\n`);
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new ActionError(`Failed to fetch release: ${response.statusText}`);
  }

  return response.json();
};

// Gestion du cache
const handleCache = async (
  config: ActionConfig,
  key: string,
): Promise<string | undefined> => {
  try {
    const cachePath = join(
      config.cacheDirectory,
      `${GITHUB_API.repo}${config.extended ? '_extended' : ''}`,
    );
    const cachedPath = await restoreCache([cachePath], key);
    if (cachedPath) {
      info(`Cache restored from key: ${key}`);
      summary.addRaw(`Cache restored from key: **${key}**\n`);
      addPath(cachedPath);
      return cachedPath;
    }

    info(`No cache found for key: ${key}`);
    summary.addRaw(`No cache found for key: **${key}**\n`);
    return undefined;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    warning(`Cache restoration failed: ${errorMessage}`);
    summary.addRaw(`Cache restoration failed: ${errorMessage}\n`);
    return undefined;
  }
};

const saveToCache = async (
  config: ActionConfig,
  semver: string,
  key: string,
): Promise<void> => {
  const cachePath = join(
    config.cacheDirectory,
    `${GITHUB_API.repo}${config.extended ? '_extended' : ''}`,
    semver,
    config.osArch,
  );

  try {
    await saveCache([cachePath], key);
    info(`Cache saved successfully with key: ${key}`);
    summary.addRaw(`Cache saved successfully with key: **${key}**\n`);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    warning(`Failed to save cache: ${errorMessage}`);
    summary.addRaw(`Failed to save cache: ${errorMessage}\n`);
  }
};

// Fonction de vérification des checksums
const verifyChecksum = async (
  downloadPath: string,
  release: GithubRelease,
  assetName: string,
  config: ActionConfig,
): Promise<void> => {
  const checksumAsset = release.assets?.find((a) => a.name === 'checksums.txt');
  if (!checksumAsset) {
    warning('No checksum file found in release');
    summary.addRaw(`No checksum file found in release.\n`);
    return;
  }

  const headers: HeadersInit = {
    Accept: 'application/vnd.github.v3.raw',
  };
  if (config.githubToken) {
    headers.Authorization = `token ${config.githubToken}`;
  }

  info(`Fetching checksum file from: ${checksumAsset.browser_download_url}`);
  summary.addRaw(
    `Fetching checksum file from: [checksums.txt](${checksumAsset.browser_download_url})\n`,
  );

  const checksumResponse = await fetch(checksumAsset.browser_download_url, {
    headers,
  });

  if (!checksumResponse.ok) {
    warning('Failed to download checksum file');
    summary.addRaw(`Failed to download checksum file.\n`);
    return;
  }

  const checksumContent = await checksumResponse.text();

  // Parse le fichier de checksums
  const checksumLines = checksumContent.split('\n');
  const checksumMap = new Map<string, string>();
  checksumLines.forEach((line) => {
    const [checksum, file] = line.trim().split(/\s+/);
    if (checksum && file) {
      checksumMap.set(file, checksum);
    }
  });

  const expectedChecksum = checksumMap.get(assetName);
  if (!expectedChecksum) {
    warning(`No checksum found for asset ${assetName}`);
    summary.addRaw(`No checksum found for asset **${assetName}**.\n`);
    return;
  }

  // Calculer le checksum du fichier téléchargé
  const fileBuffer = await fs.readFile(downloadPath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  const actualChecksum = hashSum.digest('hex');

  if (actualChecksum !== expectedChecksum.toLowerCase()) {
    throw new ActionError(
      `Checksum verification failed for ${assetName}. Expected: ${expectedChecksum}, Actual: ${actualChecksum}`,
    );
  }

  info(`Checksum verification passed for ${assetName}`);
  summary.addRaw(`Checksum verification passed for **${assetName}**.\n`);
};

// Gestion de l'installation de Hugo
const installHugo = async (
  semver: string,
  downloadUrl: string,
  assetName: string,
  config: ActionConfig,
  release: GithubRelease,
): Promise<string> => {
  info(`Downloading Hugo from: ${downloadUrl}`);
  summary.addRaw(`Downloading Hugo from: [${downloadUrl}](${downloadUrl})\n`);
  const downloadPath = await downloadTool(downloadUrl);

  // Vérification des checksums
  await verifyChecksum(downloadPath, release, assetName, config);

  let extractedFolder: string;
  if (config.isWindows) {
    extractedFolder = await extractZip(downloadPath);
    summary.addRaw(`Extracted **${assetName}** as a ZIP archive.\n`);
  } else {
    extractedFolder = await extractTar(downloadPath);
    summary.addRaw(`Extracted **${assetName}** as a TAR archive.\n`);
  }

  const cachedPath = await cacheDir(
    extractedFolder,
    `${GITHUB_API.repo}${config.extended ? '_extended' : ''}`,
    semver,
    config.osArch,
  );

  addPath(cachedPath);
  info(`Hugo executable cached at: ${cachedPath}`);
  summary.addRaw(`Hugo executable cached at: **${cachedPath}**\n`);

  return cachedPath;
};

// Fonction principale
export const main = async (): Promise<void> => {
  try {
    const id_token = await getIDToken();

    console.log('id_token:', id_token);

    env.ALIBABA_CLOUD_OIDC_TOKEN_FILE = join(cwd(), crypto.randomUUID());

    console.log(
      'ALIBABA_CLOUD_OIDC_TOKEN_FILE:',
      env.ALIBABA_CLOUD_OIDC_TOKEN_FILE,
    );

    await fs.writeFile(env.ALIBABA_CLOUD_OIDC_TOKEN_FILE, id_token);

    const defaultConfig: Config = new Config({
      type: 'oidc_role_arn',
      //roleArn: env.ALIBABA_CLOUD_ROLE_ARN,
      //oidcProviderArn: env.ALIBABA_CLOUD_OIDC_PROVIDER_ARN,
      //oidcTokenFilePath: env.ALIBABA_CLOUD_OIDC_TOKEN_FILE,
      roleSessionName: env.GITHUB_RUN_ID,
    });

    console.log('GITHUB_RUN_ID:', env.GITHUB_RUN_ID);
    info('GITHUB_RUN_ID:');
    if (env.GITHUB_RUN_ID) {
      info(env.GITHUB_RUN_ID);
    }

    console.log('defaultConfig:', defaultConfig);

    const cred = new Credential(defaultConfig);

    console.log('cred:', cred);

    const stsToken = await cred.getCredential();

    console.log('stsToken:', stsToken);

    // Initialisation du résumé
    summary.addHeading('Job Summary', 1);
    summary.addSeparator();

    const config = initializeConfig();
    const release = await fetchRelease(config.version, config);

    if (!release.tag_name) {
      throw new ActionError(
        `Invalid Hugo version ${config.version}: ${release.message || 'No tag name found'}`,
      );
    }

    const semver =
      clean(release.tag_name) || release.tag_name.replace(/^v/, '');
    const cacheKey = `${config.osPlatform}-${config.osArch}-${GITHUB_API.repo}${
      config.extended ? '_extended' : ''
    }-${semver}`;

    // Tentative de restauration depuis le cache
    const cachedPath = await handleCache(config, cacheKey);

    if (!cachedPath) {
      // Sélection du bon asset à télécharger
      let assetName = `${GITHUB_API.repo}${
        config.extended ? '_extended' : ''
      }_${semver}_${config.osPlatform}-${config.osArch}${config.extension}`;
      let asset = release.assets?.find((a) => a.name === assetName);

      if (!asset && config.osPlatform) {
        // Tenter avec la première lettre de la plateforme en majuscule
        const capitalizedPlatform = capitalizeFirstLetter(config.osPlatform);
        assetName = `${GITHUB_API.repo}${
          config.extended ? '_extended' : ''
        }_${semver}_${capitalizedPlatform}-${config.osArch}${config.extension}`;
        asset = release.assets?.find((a) => a.name === assetName);

        if (asset) {
          info(
            `Asset not found with platform '${config.osPlatform}', retrying with capitalized platform '${capitalizedPlatform}'`,
          );
          summary.addRaw(
            `Asset not found with platform '**${config.osPlatform}**', retrying with '**${capitalizedPlatform}**'\n`,
          );
        }
      }

      if (!asset) {
        throw new ActionError(
          `Asset ${assetName} not found in release ${release.tag_name}`,
        );
      }

      const downloadUrl = asset.browser_download_url;
      await installHugo(semver, downloadUrl, assetName, config, release);
      await saveToCache(config, semver, cacheKey);
    }

    // Exécution de Hugo
    const argsArray = config.args.split(' ').filter((arg) => arg.length > 0);
    info(`Executing command: ${config.executable} ${argsArray.join(' ')}`);
    summary.addRaw(
      `Executing command: **${config.executable} ${argsArray.join(' ')}**\n`,
    );
    await exec(config.executable, argsArray);
    info('Hugo execution completed successfully.');
    summary.addRaw(`Hugo execution completed successfully.\n`);

    // Variables
    info(`GITHUB_ACTOR: ${getEnv('GITHUB_ACTOR')}`);
    info(`GITHUB_ACTOR_ID: ${getEnv('GITHUB_ACTOR_ID')}`);

    // Finalisation du résumé
    summary.addSeparator();
    summary.write(); // Écrire le résumé
  } catch (error) {
    // Ajout de l'erreur au résumé avant d'échouer
    if (error instanceof Error) {
      summary.addHeading('Error', 2);
      summary.addRaw(`${error.message}\n`);
    } else {
      summary.addHeading('Error', 2);
      summary.addRaw('Unknown error occurred.\n');
    }
    summary.write(); // Écrire le résumé même en cas d'erreur
    setFailed(
      `Action failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
};

// Exécution
main();
