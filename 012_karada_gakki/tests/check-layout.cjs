const fs=require("fs"),http=require("http"),{spawn}=require("child_process"),os=require("os"),path=require("path");
(async()=>{
 const root=process.cwd(),profile=fs.mkdtempSync(path.join(os.tmpdir(),"karada-layout-"));
 const server=http.createServer((req,res)=>{
  const p=path.join(root,decodeURIComponent(req.url.split("?")[0]==="/"?"/index.html":req.url.split("?")[0]));
  if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(p,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader("Content-Type",p.endsWith(".js")?"text/javascript":p.endsWith(".css")?"text/css":"text/html");res.end(data);});
 });
 await new Promise(r=>server.listen(0,"127.0.0.1",r));
 const browser=spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",["--headless=new","--disable-gpu","--remote-debugging-port=0","--user-data-dir="+profile,"about:blank"],{windowsHide:true,stdio:["ignore","ignore","pipe"]});
 let ws,buf="";const address=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error("CDP timeout")),15000);
  browser.stderr.on("data",b=>{buf+=b;const m=buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
  browser.once("error",reject);
 });
 const httpUrl=address.replace("ws://","http://").replace(/\/devtools\/browser\/.*/,"");
 const targets=await (await fetch(httpUrl+"/json/list")).json();ws=new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
 await new Promise(r=>ws.addEventListener("open",r,{once:true}));
 let id=0;const pending=new Map();
 ws.addEventListener("message",e=>{const data=JSON.parse(e.data);if(pending.has(data.id)){const {resolve,reject}=pending.get(data.id);pending.delete(data.id);data.error?reject(data.error):resolve(data.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async(expression)=>{const r=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 try{
  await send("Page.navigate",{url:"http://127.0.0.1:"+server.address().port});
  for(let i=0;i<100;i++){if(await evaluate('document.readyState==="complete" && !!document.querySelector("#debugPanel")'))break;await new Promise(r=>setTimeout(r,30));}
  const results=[];
  for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[844,390]]){
   await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:true});
   const result=await evaluate(`(async()=>{
    document.querySelector("#startScreen").classList.remove("active");
    document.querySelector("#playScreen").classList.add("active");
    const strip=document.querySelector("#gestureStrip");
    strip.replaceChildren(...["a","b","c","d","e","f"].map(()=>Object.assign(document.createElement("span"),{className:"gesture-chip",textContent:"ジェスチャー"})));
    await new Promise(requestAnimationFrame);
    const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
    const controls=["#backButton","#settingsButton","[data-play-mode=face]","[data-play-mode=body]","#debugToggle"].map(rect);
    const result={width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,preview:rect(".camera-stage"),controls,debugHidden:getComputedStyle(document.querySelector("#debugPanel")).display==="none"};
    document.querySelector("#settingsDialog").showModal();
    await new Promise(requestAnimationFrame);
    const form=document.querySelector(".settings-sheet form");
    result.settings={height:form.clientHeight,scrollHeight:form.scrollHeight,overflowY:getComputedStyle(form).overflowY};
    document.querySelector("#settingsDialog").close();return result;
   })()`);
   results.push(result);
  }
  console.log(JSON.stringify(results.map(r=>({size:r.width+"x"+r.height,overflow:r.overflow,previewHeight:r.preview.height,controlsVisible:r.controls.every(c=>c.x>=0&&c.right<=r.width&&c.bottom<=r.height),debugHidden:r.debugHidden,settingsScroll:r.settings.scrollHeight>r.settings.height&&r.settings.overflowY==="auto"})),null,2));
  if(results.some(r=>r.overflow||!r.debugHidden||r.controls.some(c=>c.x<0||c.right>r.width||c.bottom>r.height||c.width<44||c.height<44)))throw new Error("Layout acceptance failed");
 }finally{ws.close();browser.kill();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
