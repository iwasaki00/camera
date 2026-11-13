import {defaultAppearance} from '../../composite-color.js';
export function createLegacyPart(type,zIndex=0){
 const d={mouth:[24,10,.5,.65,1.5],leftEye:[14,7,.65,.38,3],rightEye:[14,7,.35,.38,3],nose:[12,16,.5,.52,3]}[type];
 return {id:type,partType:type,enabled:true,zIndex,targetRect:{x:50,y:50,width:d[0],height:d[1]},sourceRect:{x:d[2],y:d[3],zoom:d[4]},rotation:0,shape:'oval',feather:20,guides:{photo:true,camera:true},tracking:{offsetX:0,offsetY:0,widthScale:1,heightScale:1,rotation:0},appearance:defaultAppearance()};
}
