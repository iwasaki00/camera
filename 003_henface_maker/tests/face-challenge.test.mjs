import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const transpile=async file=>ts.transpileModule(await fs.readFile(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2020}}).outputText;
const url=js=>'data:text/javascript;base64,'+Buffer.from(js).toString('base64');
const gameURL=url(await transpile('../src/game/blinkDropGame.ts')),game=await import(gameURL);
const c=await import(url((await transpile('../src/game/faceChallenge.ts')).replace('"./blinkDropGame"',JSON.stringify(gameURL))));
const g={pose:{center:{x:240,y:240},scale:130,angle:0},skinOutline:[{x:100,y:100},{x:380,y:100},{x:380,y:550},{x:100,y:550}],parts:{}};
for(const [i,kind] of game.BLINK_DROP_PARTS.entries())g.parts[kind]={center:{x:[305,175,240,240][i],y:[240,240,320,410][i]},dropHeight:[30,30,42,35][i],contour:[]};
for(const kind of ['rightBrow','leftBrow'])g.parts[kind]={center:{x:240,y:200},dropHeight:30,contour:[]};
assert.equal(c.GAME_TITLE,'カオストップ！');assert.equal(c.CHALLENGES.length,5);assert.equal(game.createBlinkDropSession().gameMode,'free');
for(const difficulty of game.BLINK_DROP_DIFFICULTIES)for(const definition of c.CHALLENGES){
  const run=c.createChallengeRun(definition.id,difficulty);
  assert.deepEqual(run.scores,[null,null,null,null]);
  for(let i=0;i<4;i++){
    const target=run.targets[i],motion=game.fallingStateAt(game.createBlinkDropSession('playing',difficulty),target.progress*game.DIFFICULTY_MODES[difficulty].durationMs);
    for(const key of ['verticalOffset','horizontalOffset','rotation','scale'])assert.equal(target[key],motion[key],difficulty+'/'+definition.id+' reachable simultaneous '+key);
    assert(target.progress>0&&target.progress<1);assert(target.scale>=.8&&target.scale<=1.2);
    const goal=c.challengeTargetPosition(g,i,target);
    assert.equal(c.challengePartScore(g,i,target,goal,target,difficulty,definition.id),100);
    const bad={x:goal.x+.3,y:goal.y+.5};assert(c.challengePartScore(g,i,target,bad,target,difficulty,definition.id)<100);
    if(['EASY','NORMAL','HARD'].includes(difficulty))assert.equal(c.challengePartScore(g,i,target,{x:goal.x+10,y:goal.y},target,difficulty,definition.id),100,'vertical modes never penalize impossible X');
    if(difficulty==='MONSTER'&&definition.id==='chaosFace'){
      assert(c.challengePartScore(g,i,target,goal,{...target,rotation:target.rotation+.5},difficulty,definition.id)<100);
      assert(c.challengePartScore(g,i,target,goal,{...target,scale:target.scale+.4},difficulty,definition.id)<100);
    }
  }
  console.log('PASS '+difficulty+' / '+definition.code+': four reachable targets, exact 100, displaced penalty');
}
{
  const perfect=c.createChallengeRun('perfect','NORMAL'),forehead=c.createChallengeRun('foreheadEyes','NORMAL'),mouth=c.createChallengeRun('highMouth','NORMAL');
  assert(perfect.targets.every(t=>t.verticalOffset===0));assert(forehead.targets[0].verticalOffset<0&&forehead.targets[1].verticalOffset<0);
  assert.equal(forehead.targets[2].verticalOffset,0);assert(mouth.targets[3].verticalOffset<0);
  assert.equal(new Set(c.createChallengeRun('scattered','NORMAL').targets.map(t=>t.verticalOffset)).size,4);
  const target=c.createChallengeRun('chaosFace','MONSTER').targets[0],p=c.challengeTargetPosition(g,0,target);
  const moved={...g,pose:{center:{x:200,y:210},scale:130*1.2,angle:.4},parts:Object.fromEntries(Object.entries(g.parts).map(([k,r])=>[k,{...r,center:{x:200+(r.center.x-240)*1.2,y:210+(r.center.y-240)*1.2},dropHeight:r.dropHeight*1.2}])),skinOutline:g.skinOutline.map(q=>({x:200+(q.x-240)*1.2,y:210+(q.y-240)*1.2}))};
  const movedGoal=c.challengeTargetPosition(moved,0,target);assert(Math.hypot(movedGoal.x-p.x,movedGoal.y-p.y)<1e-12);
  assert.equal(c.challengePartScore(moved,0,target,movedGoal,target,'MONSTER','chaosFace'),100);
  console.log('PASS template semantics and face-local scale/translation/rotation invariance');
}
for(const difficulty of game.BLINK_DROP_DIFFICULTIES){
  let session={...game.beginBlinkDrop(game.createBlinkDropSession('countdown',difficulty),100),gameMode:'challenge',challenge:c.createChallengeRun('chaosFace',difficulty)};
  for(let i=0;i<4;i++){
    const target=session.challenge.targets[i],now=session.partStartedAt+target.progress*game.DIFFICULTY_MODES[difficulty].durationMs;
    const original=session.challenge;
    session=c.recordChallengeCatch(game.catchBlinkDropPart(session,now,c.challengeTargetPosition(g,i,target),{x:0,y:-.3}),g);
    assert.equal(session.challenge.scores[i],100);assert.equal(original.scores[i],null,'immutable score');
    assert.equal(c.recordChallengeCatch(session,g),session,'same turn cannot score twice');
    session=game.advanceBlinkDrop(session,now+450);
  }
  assert.equal(session.phase,'completed');assert.deepEqual(c.challengeResult(session.challenge),{score:100,rank:'PERFECT'});
  const free=game.createBlinkDropSession();assert.equal(c.recordChallengeCatch(free,g),free);
  console.log('PASS '+difficulty+': four scored turns, final PERFECT, FREE unaffected');
}
for(const [score,rank] of [[100,'PERFECT'],[95,'PERFECT'],[94,'GREAT'],[80,'GREAT'],[79,'GOOD'],[60,'GOOD'],[59,'CLOSE'],[40,'CLOSE'],[39,'MISS'],[0,'MISS']])assert.equal(c.challengeRank(score),rank);
assert.deepEqual(c.challengeResult({...c.createChallengeRun('perfect','NORMAL'),scores:[100,80,60,40]}),{score:70,rank:'GOOD'});
console.log('PASS five rank boundaries and four-part aggregate');
