// Optional exact v0.9.0 comparison. Writes only ignored build-check artifacts;
// never changes the working source, Git state or a published build.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const rev=process.env.BLEND_BASELINE_REV??'HEAD';
const prefix=execFileSync('git',['rev-parse','--show-prefix'],{encoding:'utf8'}).trim();
const read=file=>execFileSync('git',['show',`${rev}:${prefix}${file}`],{encoding:'utf8'});
if(!read('src/uiSettings.ts').includes('0.9.0-final-polish-part-blend'))throw Error('Select a v0.9.0 revision with BLEND_BASELINE_REV');
const rewrite=code=>code.replaceAll('"../featureRenderer"','"/src/featureRenderer"').replaceAll('"./blinkDropGame"','"/src/game/blinkDropGame"').replaceAll('"./blinkDropMasks"','"/src/game/blinkDropMasks"');
await mkdir(new URL('../build-check/',import.meta.url),{recursive:true});
await writeFile(new URL('../build-check/baselineCompleted.ts',import.meta.url),rewrite(read('src/game/completedBlend.ts')));
await writeFile(new URL('../build-check/baselineRenderer.ts',import.meta.url),rewrite(read('src/game/blinkDropRenderer.ts')).replace('"./completedBlend"','"./baselineCompleted"'));
console.log('Prepared ignored v0.9.0 renderer for ?baseline=1 comparison');
