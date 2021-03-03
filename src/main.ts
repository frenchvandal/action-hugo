import { setFailed, getInput } from '@actions/core';
import { exec } from '@actions/exec';
import { hugoExec } from './installer';

(async (): Promise<void> => {
  try {
    await exec(`${await hugoExec()} ${getInput('args')}`);
  } catch (e) {
    setFailed(`Action failed with error: ${e.message}`);
  }
})();
