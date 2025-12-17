import { Command } from 'commander';

// VERSION is replaced at build time by tsup
declare const __VERSION__: string;

export const versionCommand = new Command('version')
  .description('Print the version number')
  .action(() => {
    console.log(typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev');
  });
