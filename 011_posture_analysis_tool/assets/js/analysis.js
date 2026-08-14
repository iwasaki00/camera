import{angle3,angleLine,mid}from"./utils.js";
const result=(key,label,value,unit,limit,positive=false)=>{const severity=positive?Math.abs(value-180):Math.abs(value);return{key,label,value,unit,severity,comment:severity<limit*.45?"ほぼ基準内です":severity<limit?"軽度の偏りが見られます":"比較的大きな偏りがあります"}};
export function analyzePose(p,mode){
  const shoulder=mid(p[11],p[12]),hip=mid(p[23],p[24]),ankle=mid(p[27],p[28]),ear=mid(p[7],p[8]);let items=[];
  if(mode==="front")items=[result("head","頭の傾き",angleLine(p[7],p[8]),"°",5),result("shoulder","肩の左右差",angleLine(p[11],p[12]),"°",4),result("pelvis","骨盤の左右差",angleLine(p[23],p[24]),"°",4),result("knee","膝の左右差",(p[25].y-p[26].y)*100,"%",3),result("center","身体中心の偏り",(shoulder.x+hip.x-ankle.x*2)*50,"%",3)];
  else{const s=mode==="left"?11:12,e=mode==="left"?7:8,h=mode==="left"?23:24,k=mode==="left"?25:26,a=mode==="left"?27:28;items=[result("head","頭部の前後位置",(p[e].x-p[s].x)*100,"%",4),result("shoulder","肩の前後位置",(p[s].x-p[h].x)*100,"%",4),result("pelvis","骨盤傾斜",90-Math.abs(angleLine(shoulder,hip)),"°",8),result("hip","股関節位置",(p[h].x-p[a].x)*100,"%",5),result("knee","膝の屈曲",angle3(p[h],p[k],p[a]),"°",12,true)];}
  const penalty=items.reduce((s,i)=>s+Math.min(16,i.severity*2),0);const score=Math.max(0,Math.round(100-penalty));return{mode,score,items,comment:score>=88?"全体として安定した姿勢です。":score>=72?"軽い偏りがあります。継続して比較しましょう。":"複数の偏りが見られます。無理のない範囲で確認してください。",points:{shoulder,hip,ankle,ear}};
}
