// Transient video presentation only. Never modifies editor/template coordinates.
export function outputOptions(value={}) {
  const number=(v,f)=>Number.isFinite(Number(v))?Math.max(0,Math.min(1,Number(v))):f;
  return Object.freeze({aspect:value.aspect==='vertical'?'vertical':'original',framing:value.framing==='fill'?'fill':'fit',
    centerX:number(value.centerX,.5),centerY:number(value.centerY,.5),title:String(value.title||'').slice(0,160),
    titleTime:['start','all','end'].includes(value.titleTime)?value.titleTime:'none',fade:!!value.fade});
}
export function outputPlacement(sw,sh,w,h,options) {
  const fill=options.aspect==='vertical'&&options.framing==='fill';
  const scale=(fill?Math.max:Math.min)(w/sw,h/sh),width=sw*scale,height=sh*scale;
  return {x:fill?(w-width)*options.centerX:(w-width)/2,y:fill?(h-height)*options.centerY:(h-height)/2,width,height};
}
export function titleVisible(o,seconds,duration){return !!o.title&&(o.titleTime==='all'||o.titleTime==='start'&&seconds<2||o.titleTime==='end'&&seconds>=duration-2);}
export function fadeOpacity(seconds,duration){return Math.max(0,Math.min(1,seconds/.4,(duration-seconds)/.4));}
export function titleLines(ctx,text,maxWidth,maxLines=4) {
  const lines=[];let line='';
  for(const char of Array.from(text)){if(char==='\n'||ctx.measureText(line+char).width>maxWidth&&line){lines.push(line);line=char==='\n'?'':char;}else line+=char;}
  if(line)lines.push(line);
  if(lines.length>maxLines){lines.length=maxLines;let last=lines[maxLines-1];while(last&&ctx.measureText(last+'…').width>maxWidth)last=last.slice(0,-1);lines[maxLines-1]=last+'…';}
  return lines;
}
const titleLayouts=new Map();
function titleLayout(ctx,text,width,height) {
  const key=JSON.stringify([text,width,height]);if(titleLayouts.has(key))return titleLayouts.get(key);
  const margin=width*.08;let size=Math.max(12,Math.round(Math.min(width*.065,height*.065))),lines,font;
  do {
    font=`600 ${size}px -apple-system, BlinkMacSystemFont, "Yu Gothic", sans-serif`;ctx.font=font;
    lines=titleLines(ctx,text,width-2*margin,1000);
    if(lines.length*size*1.4+size<=height*.38||size<=12)break;
    size--;
  }while(true);
  const maxLines=Math.max(1,Math.floor((height*.38-size)/(size*1.4)));
  if(lines.length>maxLines)lines=titleLines(ctx,text,width-2*margin,maxLines);
  const layout={font,lines,size,margin,lineHeight:size*1.4,band:lines.length*size*1.4+size};
  if(titleLayouts.size>=8)titleLayouts.delete(titleLayouts.keys().next().value);
  titleLayouts.set(key,layout);return layout;
}
export function drawRecordingOutput(ctx,source,width,height,options,seconds=0,duration=30) {
  const p=outputPlacement(source.width,source.height,width,height,options);
  // This path also preserves the previous original-aspect transfer exactly.
  ctx.fillStyle=options.aspect==='vertical'?'#202b2b':'#000';ctx.fillRect(0,0,width,height);
  ctx.drawImage(source,p.x,p.y,p.width,p.height);
  if(titleVisible(options,seconds,duration)) {
    ctx.save();const {font,size,margin,lines,lineHeight,band}=titleLayout(ctx,options.title,width,height);ctx.font=font;
    const y=height*.9-band;ctx.fillStyle='rgba(0,0,0,.65)';ctx.fillRect(margin*.5,y,width-margin,band);
    ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='top';
    lines.forEach((line,i)=>ctx.fillText(line,width/2,y+size*.5+i*lineHeight,width-2*margin));ctx.restore();
  }
  if(options.fade){ctx.save();ctx.fillStyle=`rgba(0,0,0,${1-fadeOpacity(seconds,duration)})`;ctx.fillRect(0,0,width,height);ctx.restore();}
}
