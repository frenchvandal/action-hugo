import { setFailed, getInput, info } from '@actions/core';
import { exec } from '@actions/exec';
import { hugoExec } from './installer';
import { restoreCache, saveCache } from '@actions/cache';

(async (): Promise<void> => {
  try {
    const paths = ['/opt/hostedtoolcache/hugo/0.81.0/x64/'];
    const key = 'hugo-v0.81.0';
    const cacheKey = await restoreCache(paths, key);
    info(`cacheKey: ${cacheKey}`);

    //await exec(`${await hugoExec()} ${getInput('args')}`);

    await exec('/opt/hostedtoolcache/hugo/0.81.0/x64/hugo');

    const cacheId = await saveCache(paths, key);
    info(`cacheId: ${cacheId}`);
  } catch (e) {
    setFailed(`Action failed with error: ${e.message}`);
  }
})();
