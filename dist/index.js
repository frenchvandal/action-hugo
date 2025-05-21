Object.defineProperty(exports, "__esModule", { value: true });
exports.main = void 0;
const tslib_1 = require("tslib");
// main.ts
const cache_1 = require("@actions/cache");
const core_1 = require("@actions/core");
const exec_1 = require("@actions/exec");
const tool_cache_1 = require("@actions/tool-cache");
const path_1 = require("path");
const semver_1 = require("semver");
const crypto = tslib_1.__importStar(require("crypto"));
const fs = tslib_1.__importStar(require("fs/promises"));
const credentials_1 = tslib_1.__importDefault(require("@alicloud/credentials"));
const process_1 = require("process");
const oss20190517_1 = tslib_1.__importStar(require("@alicloud/oss20190517")), $oss20190517 = oss20190517_1;
const $Util = tslib_1.__importStar(require("@alicloud/tea-util"));
const $OpenApi = tslib_1.__importStar(require("@alicloud/openapi-client"));
// Constants
const GITHUB_API = {
    owner: 'gohugoio',
    repo: 'hugo',
    baseUrl: 'https://api.github.com',
    get releaseApiUrl() {
        return `${this.baseUrl}/repos/${this.owner}/${this.repo}/releases`;
    }
};
const ARCH_MAP = new Map([
    ['x64', '64bit'],
    ['arm', 'ARM'],
    ['arm64', 'ARM64']
]);
// Utilitaires
class ActionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ActionError';
    }
}
const getEnv = (name) => {
    const value = process.env[name];
    if (!value) {
        throw new ActionError(`Environment variable ${name} is required but not defined`);
    }
    return value;
};
const mapArchitecture = (source) => {
    const target = ARCH_MAP.get(source);
    if (!target) {
        throw new ActionError(`Architecture ${source} is not supported`);
    }
    return target;
};
// Fonction pour capitaliser la première lettre
const capitalizeFirstLetter = (str) => {
    if (!str)
        return str;
    return `${str.charAt(0).toUpperCase()}${str.slice(1)}`;
};
// Configuration initiale de l'action
const initializeConfig = () => {
    const isWindows = core_1.platform.isWindows;
    const extended = (0, core_1.getBooleanInput)('extended');
    const githubToken = (0, core_1.getInput)('github-token');
    return {
        isWindows,
        cacheDirectory: getEnv('RUNNER_TOOL_CACHE'),
        extended,
        version: (0, core_1.getInput)('version') || 'latest',
        args: (0, core_1.getInput)('args') || 'version',
        osPlatform: core_1.platform.platform, // 'win32' | 'darwin' | 'linux' | etc.
        osArch: mapArchitecture(core_1.platform.arch), // '64bit' | 'ARM' | 'ARM64'
        executable: isWindows ? `${GITHUB_API.repo}.exe` : GITHUB_API.repo,
        extension: isWindows ? '.zip' : '.tar.gz',
        githubToken: githubToken || undefined
    };
};
// Gestion des releases GitHub
const fetchRelease = async (version, config) => {
    const headers = {
        Accept: 'application/vnd.github.v3+json'
    };
    if (config.githubToken) {
        headers.Authorization = `token ${config.githubToken}`;
    }
    const url = version === 'latest'
        ? `${GITHUB_API.releaseApiUrl}/latest`
        : `${GITHUB_API.releaseApiUrl}/tags/${version}`;
    (0, core_1.info)(`Fetching release information from: ${url}`);
    core_1.summary.addRaw(`Fetching release information from: [${url}](${url})\n`);
    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new ActionError(`Failed to fetch release: ${response.statusText}`);
    }
    return (await response.json());
};
// Gestion du cache
const handleCache = async (config, key) => {
    try {
        const cachePath = (0, path_1.join)(config.cacheDirectory, `${GITHUB_API.repo}${config.extended ? '_extended' : ''}`);
        const cachedPath = await (0, cache_1.restoreCache)([cachePath], key);
        if (cachedPath) {
            (0, core_1.info)(`Cache restored from key: ${key}`);
            core_1.summary.addRaw(`Cache restored from key: **${key}**\n`);
            (0, core_1.addPath)(cachedPath);
            return cachedPath;
        }
        (0, core_1.info)(`No cache found for key: ${key}`);
        core_1.summary.addRaw(`No cache found for key: **${key}**\n`);
        return undefined;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        (0, core_1.warning)(`Cache restoration failed: ${errorMessage}`);
        core_1.summary.addRaw(`Cache restoration failed: ${errorMessage}\n`);
        return undefined;
    }
};
const saveToCache = async (config, semver, key) => {
    const cachePath = (0, path_1.join)(config.cacheDirectory, `${GITHUB_API.repo}${config.extended ? '_extended' : ''}`, semver, config.osArch);
    try {
        await (0, cache_1.saveCache)([cachePath], key);
        (0, core_1.info)(`Cache saved successfully with key: ${key}`);
        core_1.summary.addRaw(`Cache saved successfully with key: **${key}**\n`);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        (0, core_1.warning)(`Failed to save cache: ${errorMessage}`);
        core_1.summary.addRaw(`Failed to save cache: ${errorMessage}\n`);
    }
};
// Fonction de vérification des checksums
const verifyChecksum = async (downloadPath, release, assetName, config) => {
    const checksumAsset = release.assets?.find((a) => a.name === 'checksums.txt');
    if (!checksumAsset) {
        (0, core_1.warning)('No checksum file found in release');
        core_1.summary.addRaw(`No checksum file found in release.\n`);
        return;
    }
    const headers = {
        Accept: 'application/vnd.github.v3.raw'
    };
    if (config.githubToken) {
        headers.Authorization = `token ${config.githubToken}`;
    }
    (0, core_1.info)(`Fetching checksum file from: ${checksumAsset.browser_download_url}`);
    core_1.summary.addRaw(`Fetching checksum file from: [checksums.txt](${checksumAsset.browser_download_url})\n`);
    const checksumResponse = await fetch(checksumAsset.browser_download_url, {
        headers
    });
    if (!checksumResponse.ok) {
        (0, core_1.warning)('Failed to download checksum file');
        core_1.summary.addRaw(`Failed to download checksum file.\n`);
        return;
    }
    const checksumContent = await checksumResponse.text();
    // Parse le fichier de checksums
    const checksumLines = checksumContent.split('\n');
    const checksumMap = new Map();
    checksumLines.forEach((line) => {
        const [checksum, file] = line.trim().split(/\s+/);
        if (checksum && file) {
            checksumMap.set(file, checksum);
        }
    });
    const expectedChecksum = checksumMap.get(assetName);
    if (!expectedChecksum) {
        (0, core_1.warning)(`No checksum found for asset ${assetName}`);
        core_1.summary.addRaw(`No checksum found for asset **${assetName}**.\n`);
        return;
    }
    // Calculer le checksum du fichier téléchargé
    const fileBuffer = await fs.readFile(downloadPath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    const actualChecksum = hashSum.digest('hex');
    if (actualChecksum !== expectedChecksum.toLowerCase()) {
        throw new ActionError(`Checksum verification failed for ${assetName}. Expected: ${expectedChecksum}, Actual: ${actualChecksum}`);
    }
    (0, core_1.info)(`Checksum verification passed for ${assetName}`);
    core_1.summary.addRaw(`Checksum verification passed for **${assetName}**.\n`);
};
// Gestion de l'installation de Hugo
const installHugo = async (semver, downloadUrl, assetName, config, release) => {
    (0, core_1.info)(`Downloading Hugo from: ${downloadUrl}`);
    core_1.summary.addRaw(`Downloading Hugo from: [${downloadUrl}](${downloadUrl})\n`);
    const downloadPath = await (0, tool_cache_1.downloadTool)(downloadUrl);
    // Vérification des checksums
    await verifyChecksum(downloadPath, release, assetName, config);
    let extractedFolder;
    if (config.isWindows) {
        extractedFolder = await (0, tool_cache_1.extractZip)(downloadPath);
        core_1.summary.addRaw(`Extracted **${assetName}** as a ZIP archive.\n`);
    }
    else {
        extractedFolder = await (0, tool_cache_1.extractTar)(downloadPath);
        core_1.summary.addRaw(`Extracted **${assetName}** as a TAR archive.\n`);
    }
    const cachedPath = await (0, tool_cache_1.cacheDir)(extractedFolder, `${GITHUB_API.repo}${config.extended ? '_extended' : ''}`, semver, config.osArch);
    (0, core_1.addPath)(cachedPath);
    (0, core_1.info)(`Hugo executable cached at: ${cachedPath}`);
    core_1.summary.addRaw(`Hugo executable cached at: **${cachedPath}**\n`);
    return cachedPath;
};
// Fonction principale
const main = async () => {
    try {
        const id_token = await (0, core_1.getIDToken)();
        console.log('id_token:', id_token);
        const tokenFile = crypto.randomUUID();
        (0, core_1.setSecret)(tokenFile);
        console.log('tokenFile:', tokenFile);
        process_1.env.ALIBABA_CLOUD_OIDC_TOKEN_FILE = (0, path_1.join)((0, process_1.cwd)(), tokenFile);
        process_1.env.ALIBABA_CLOUD_ROLE_SESSION_NAME = process_1.env.GITHUB_RUN_ID;
        console.log('ALIBABA_CLOUD_OIDC_TOKEN_FILE:', process_1.env.ALIBABA_CLOUD_OIDC_TOKEN_FILE);
        await fs.writeFile(process_1.env.ALIBABA_CLOUD_OIDC_TOKEN_FILE, id_token);
        //const defaultConfig: Config = new Config({
        //type: 'oidc_role_arn',
        //roleArn: env.ALIBABA_CLOUD_ROLE_ARN,
        //oidcProviderArn: env.ALIBABA_CLOUD_OIDC_PROVIDER_ARN,
        //oidcTokenFilePath: env.ALIBABA_CLOUD_OIDC_TOKEN_FILE,
        //roleSessionName: env.GITHUB_RUN_ID,
        //});
        console.log('GITHUB_RUN_ID:', process_1.env.GITHUB_RUN_ID);
        (0, core_1.info)('GITHUB_RUN_ID:');
        if (process_1.env.GITHUB_RUN_ID) {
            (0, core_1.info)(process_1.env.GITHUB_RUN_ID);
        }
        //console.log('defaultConfig:', defaultConfig);
        //const cred = new Credential(defaultConfig);
        const cred = new credentials_1.default();
        const defaultConfig = new $OpenApi.Config({
            credential: cred
        });
        defaultConfig.endpoint = 'oss-eu-central-1.aliyuncs.com';
        console.log('cred:', cred);
        const stsToken = await cred.getCredential();
        if (stsToken.accessKeyId &&
            stsToken.accessKeySecret &&
            stsToken.securityToken) {
            (0, core_1.setSecret)(stsToken.accessKeyId);
            (0, core_1.setSecret)(stsToken.accessKeySecret);
            (0, core_1.setSecret)(stsToken.securityToken);
        }
        console.log('stsToken:', stsToken);
        // Variables standard
        //exportVariable('ALIBABA_CLOUD_ACCESS_KEY_ID', stsToken.accessKeyId);
        //exportVariable('ALIBABA_CLOUD_ACCESS_KEY_SECRET', stsToken.accessKeySecret);
        //exportVariable('ALIBABA_CLOUD_SECURITY_TOKEN', stsToken.securityToken);
        // Compatibilité anciens noms
        //exportVariable('ALICLOUD_ACCESS_KEY', stsToken.accessKeyId);
        //exportVariable('ALICLOUD_SECRET_KEY', stsToken.accessKeySecret);
        //exportVariable('ALICLOUD_SECURITY_TOKEN', stsToken.securityToken);
        const OSS = new oss20190517_1.default(defaultConfig);
        console.log('OSS:', OSS);
        const request = new $oss20190517.ListObjectsV2Request({
            prefix: '',
            delimiter: '/',
            maxKeys: 100
        });
        const headers = { 'User-Agent': 'AlibabaCloud API Workbench' };
        let res;
        try {
            console.log('Requête:', JSON.stringify(request, null, 2));
            res = await OSS.listObjectsV2WithOptions('normcore-dev', request, headers, new $Util.RuntimeOptions({}));
            console.log('Structure complète de la réponse:', JSON.stringify(res, null, 2));
        }
        catch (error) {
            console.error('Erreur lors de la récupération des objets du bucket:', error);
            // Affichage détaillé de l'erreur
            if (error instanceof Error) {
                console.error('Message:', error.message);
                console.error('Stack:', error.stack);
            }
            // Vous pouvez également ajouter des logs pour le résumé si nécessaire
            (0, core_1.warning)(`Échec de la liste des objets dans le bucket normcore-dev: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
            core_1.summary.addRaw(`⚠️ Échec de la liste des objets dans le bucket **normcore-dev**\n`);
            // Optionnel: lancer à nouveau l'erreur ou la gérer d'une autre façon
            // throw error; // Si vous voulez que l'erreur soit propagée plus haut
        }
        // Initialisation du résumé
        core_1.summary.addHeading('Job Summary', 1);
        core_1.summary.addSeparator();
        const config = initializeConfig();
        const release = await fetchRelease(config.version, config);
        if (!release.tag_name) {
            throw new ActionError(`Invalid Hugo version ${config.version}: ${release.message || 'No tag name found'}`);
        }
        const semver = (0, semver_1.clean)(release.tag_name) || release.tag_name.replace(/^v/, '');
        const cacheKey = `${config.osPlatform}-${config.osArch}-${GITHUB_API.repo}${config.extended ? '_extended' : ''}-${semver}`;
        // Tentative de restauration depuis le cache
        const cachedPath = await handleCache(config, cacheKey);
        if (!cachedPath) {
            // Sélection du bon asset à télécharger
            let assetName = `${GITHUB_API.repo}${config.extended ? '_extended' : ''}_${semver}_${config.osPlatform}-${config.osArch}${config.extension}`;
            let asset = release.assets?.find((a) => a.name === assetName);
            if (!asset && config.osPlatform) {
                // Tenter avec la première lettre de la plateforme en majuscule
                const capitalizedPlatform = capitalizeFirstLetter(config.osPlatform);
                assetName = `${GITHUB_API.repo}${config.extended ? '_extended' : ''}_${semver}_${capitalizedPlatform}-${config.osArch}${config.extension}`;
                asset = release.assets?.find((a) => a.name === assetName);
                if (asset) {
                    (0, core_1.info)(`Asset not found with platform '${config.osPlatform}', retrying with capitalized platform '${capitalizedPlatform}'`);
                    core_1.summary.addRaw(`Asset not found with platform '**${config.osPlatform}**', retrying with '**${capitalizedPlatform}**'\n`);
                }
            }
            if (!asset) {
                throw new ActionError(`Asset ${assetName} not found in release ${release.tag_name}`);
            }
            const downloadUrl = asset.browser_download_url;
            await installHugo(semver, downloadUrl, assetName, config, release);
            await saveToCache(config, semver, cacheKey);
        }
        // Exécution de Hugo
        const argsArray = config.args.split(' ').filter((arg) => arg.length > 0);
        (0, core_1.info)(`Executing command: ${config.executable} ${argsArray.join(' ')}`);
        core_1.summary.addRaw(`Executing command: **${config.executable} ${argsArray.join(' ')}**\n`);
        await (0, exec_1.exec)(config.executable, argsArray);
        (0, core_1.info)('Hugo execution completed successfully.');
        core_1.summary.addRaw(`Hugo execution completed successfully.\n`);
        // Variables
        (0, core_1.info)(`GITHUB_ACTOR: ${getEnv('GITHUB_ACTOR')}`);
        (0, core_1.info)(`GITHUB_ACTOR_ID: ${getEnv('GITHUB_ACTOR_ID')}`);
        // Finalisation du résumé
        core_1.summary.addSeparator();
        core_1.summary.write(); // Écrire le résumé
    }
    catch (error) {
        // Ajout de l'erreur au résumé avant d'échouer
        if (error instanceof Error) {
            core_1.summary.addHeading('Error', 2);
            core_1.summary.addRaw(`${error.message}\n`);
        }
        else {
            core_1.summary.addHeading('Error', 2);
            core_1.summary.addRaw('Unknown error occurred.\n');
        }
        core_1.summary.write(); // Écrire le résumé même en cas d'erreur
        (0, core_1.setFailed)(`Action failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
};
exports.main = main;
// Exécution
(0, exports.main)();
//# sourceMappingURL=index.js.map
