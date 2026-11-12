import { DEFAULT_COMPOSITE, defaultAppearance, COLOR_RANGES } from './composite-color.js?v=0.7.1';
const $=id=>document.getElementById(id);
const labels={brightness:'明るさ',contrast:'コントラスト',saturation:'彩度',temperature:'色温度（−寒色 / ＋暖色）',tint:'色かぶり（−緑 / ＋マゼンタ）',grain:'質感 / 固定粒子',blendStrength:'このパーツの補正強度',edgeSoftness:'追加の境界ぼかし',edgeContrast:'コミカルの境界強調'};
export class CompositeUI {
  constructor({read,selected,changed,compare}) {
    Object.assign(this,{read,selected,changed,compare});this.controls=[];
    $('composite-mode').addEventListener('change',e=>{read().mode=e.target.value;this.sync();changed();});
    $('composite-strength').addEventListener('input',e=>{read().blendStrength=Number(e.target.value);this.sync();changed();});
    for(const [id,key]of [['composite-auto','autoMatch'],['composite-texture','textureEnabled']])$(id).addEventListener('change',e=>{read()[key]=e.target.checked;changed();});
    for(const [key,[min,max]]of Object.entries(COLOR_RANGES)) {
      const label=document.createElement('label'),input=document.createElement('input'),output=document.createElement('output');
      label.className='slider-label';label.htmlFor=`color-${key}`;label.append(labels[key],output);
      Object.assign(input,{id:label.htmlFor,type:'range',min,max,step:1});$('composite-controls').append(label,input);
      input.addEventListener('input',()=>{const part=selected();if(part&&read().mode!=='original'){part.appearance[read().mode][key]=Number(input.value);changed();this.sync();}});
      this.controls.push({key,input,output});
    }
    $('composite-reset').addEventListener('click',()=>{const part=selected();if(part&&read().mode!=='original'){part.appearance[read().mode]=defaultAppearance()[read().mode];this.sync();changed();}});
    const button=$('composite-before');
    this.setCompare=active=>{if(this.comparing===active)return;this.comparing=active;button.setAttribute('aria-pressed',String(active));$('composite-compare-state').textContent=active?'補正前を表示中':'';compare(active);};
    button.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();button.setPointerCapture(e.pointerId);this.setCompare(true);});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>this.setCompare(false));
    button.addEventListener('keydown',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();this.setCompare(true);}});
    button.addEventListener('keyup',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();this.setCompare(false);}});
    button.addEventListener('blur',()=>this.setCompare(false));window.addEventListener('blur',()=>this.setCompare(false));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.setCompare(false);});
  }
  sync(name='') {
    const composite=this.read()||DEFAULT_COMPOSITE,part=this.selected(),editable=!!part&&composite.mode!=='original';
    $('composite-mode').value=composite.mode;$('composite-strength').value=composite.blendStrength;$('composite-strength-value').value=`${composite.blendStrength}%`;
    $('composite-auto').checked=composite.autoMatch;$('composite-texture').checked=composite.textureEnabled;
    $('composite-auto').disabled=composite.mode!=='natural';
    if(name)$('composite-part-name').textContent=name;
    const settings=part?.appearance?.[composite.mode==='original'?'natural':composite.mode]||defaultAppearance().natural;
    for(const {key,input,output}of this.controls){input.disabled=!editable||(key==='edgeContrast'&&composite.mode!=='comic');input.value=settings[key];output.value=`${settings[key]}${['temperature','tint','grain'].includes(key)?' pt':'%'}`;}
    $('composite-reset').disabled=!editable;
  }
}
