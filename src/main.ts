import { setFailed, getInput, info } from '@actions/core';
import { exec } from '@actions/exec';
import { hugoExec } from './installer';
import { restoreCache, saveCache } from '@actions/cache';

(async (): Promise<void> => {
  try {
    //const paths = ['/opt/hostedtoolcache/hugo/0.81.0/x64/'];
    //const key = 'hugo-v0.81.0';
    //const cacheKey = await restoreCache(paths, key);

    //if (cacheKey) {
    //  await exec(`/opt/hostedtoolcache/hugo/0.81.0/x64/hugo ${getInput('args')}`);
    //} else {
    await exec(`${await hugoExec()} ${getInput('args')}`);

    //  const cacheId = await saveCache(paths, key);
    //  info(`cacheId: ${cacheId}`);
    //}
  } catch (e) {
    setFailed(`Action failed with error: ${e.message}`);
  }
})();
