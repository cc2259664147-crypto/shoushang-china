import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assertFileHashes, buildPreparation, validatePreparation } from './content-intake-core';

const root=resolve('.');
const preparation=buildPreparation(root);
validatePreparation(preparation);
assertFileHashes(root,preparation);
const outputIndex=process.argv.indexOf('--output');
if(outputIndex<0){
  console.log('V1 canonical content validated; historical intake records were preserved. Use --output <new-file.json> to write a diagnostic copy.');
}else{
  const argument=process.argv[outputIndex+1]; if(!argument) throw new Error('--output requires a new destination file');
  const output=resolve(argument);
  mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify(preparation,null,2)+'\n',{encoding:'utf8',flag:'wx'});
  console.log(`wrote diagnostic copy ${output}`);
}
