#!/usr/bin/env node
// Poster Agent, 2026-11-10. Apache-2.0. No implicit paid/network requests.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {defaultProviders,detectProviders,planImage,generateImage} from './image-provider.mjs';
import {applyGeneratedAsset} from './image-assets.mjs';
import {ProjectStore} from './project-store.mjs';
import {createFitPreview} from './image-fit.mjs';
async function main(){
  const [command,project,file,...flags]=process.argv.slice(2);
  const providers=defaultProviders();
  if(command==='detect'){console.log(JSON.stringify(await detectProviders(providers),null,2));return;}
  if(!project||!file)throw new Error('Usage: image.mjs {plan|generate|apply|fit-preview} PROJECT REQUEST.json [--allow-paid-request --request-hash HASH]');
  const request=JSON.parse(fs.readFileSync(file,'utf8'));
  const known=flags.filter(f=>f.startsWith('--'));if(known.some(f=>!['--allow-paid-request','--request-hash'].includes(f)))throw new Error('Unknown option');
  let result;
  if(command==='fit-preview')result=await createFitPreview(project,request);
  else if(command==='plan')result=await planImage(project,request,{providers});
  else if(command==='generate'){
    const at=flags.indexOf('--request-hash');
    result=await generateImage(project,request,{providers,authorization:{allowPaid:flags.includes('--allow-paid-request'),requestHash:at<0?null:flags[at+1]}});
    if(result.status!=='success')process.exitCode=1;
  } else if(command==='apply')result=await applyGeneratedAsset(new ProjectStore(project),request);
  else throw new Error('Unknown image command');
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(e=>{console.error(JSON.stringify({error:e.code||'IMAGE_ERROR',message:e.message}));process.exitCode=1;});
