import {Liquid,clamp,screenVector,orientationGravity} from './physics.js?v=2';
import {Rheoscopic} from './rheoscopic.js?v=1';
const $=id=>document.getElementById(id),canvas=$('fluid'),ctx=canvas.getContext('2d',{alpha:false});
const panel=$('panel');
const STORAGE_KEY='pocket-fluid-v3';
// New 1.0× matches the former 0.6×: the solver itself is unchanged.
const MOTION_BASELINE=.6;
let prefs={level:'bottle',fill:34,response:1,look:'dots',color:'#37dd78',backdrop:true,rheoscopic:false};
try {
  const current=localStorage.getItem(STORAGE_KEY);
  const saved=JSON.parse(current||localStorage.getItem('pocket-fluid-v2')||'null');
  if(saved){
    if(['bottle','slides','funnel','pins'].includes(saved.level))prefs.level=saved.level;
    if(['dots','water'].includes(saved.look))prefs.look=saved.look;
    if(Number.isFinite(saved.fill))prefs.fill=clamp(saved.fill,15,60);
    if(Number.isFinite(saved.response)){
      // Preserve a manually lowered old setting, including 0.6 -> new 1.0.
      // The old default of 1.0 adopts the new, gentler normal setting.
      const value=current?saved.response:(saved.response===1?1:saved.response/MOTION_BASELINE);
      prefs.response=clamp(value,.3,2.7);
    }
    if(/^#[0-9a-f]{6}$/i.test(saved.color))prefs.color=saved.color.toLowerCase();
    if(typeof saved.backdrop==='boolean')prefs.backdrop=saved.backdrop;
    if(typeof saved.rheoscopic==='boolean')prefs.rheoscopic=saved.rheoscopic;
  }
}catch{}
const save=()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(prefs));}catch{}};
let rheo=null;
let sim,W,H,dpr,sx,sy,background,liquidCanvas,liquidCtx,liquidImage;
let motion=false,permissionPending=false,orientationTime=-Infinity,motionTime=-Infinity,linearTime=-Infinity;
let gravity={x:0,y:1},linear={x:0,y:0},pointer=null;
let lastTime=0,accumulator=0,frame=0,fpsTime=0,fps=60,lastTouch=performance.now();
let tipTimer,hasInteracted=false,hideAfterClose=false,paused=false,keyboard=new Set();
const DT=1/120;
const angle=()=>screen.orientation?.angle??Number(window.orientation??0);
let palette=[],theme;
const mix=(a,b,t)=>a.map((v,i)=>Math.round(v+(b[i]-v)*t));
const rgb=c=>`rgb(${c.join(',')})`;
function applyColor(){
 const selected=[1,3,5].map(i=>parseInt(prefs.color.slice(i,i+2),16));
 // Very dark custom colors retain enough luminance to see the water.
 const lift=Math.max(0,85-Math.max(...selected)),base=selected.map(v=>v+lift);
 const white=[255,255,255];
 theme={
   background:rgb(mix([4,6,8],base,.025)),recess:rgb(mix([10,14,17],base,.055)),
   wall:rgb(mix([30,35,40],base,.25)),wallFill:rgb(mix([12,18,22],base,.08)),
   water:base.map(v=>Math.round(v*.84)),edge:mix(base,white,.44)
 };
 const lo=base.map(v=>Math.round(v*.84)),hi=mix(base,white,.43);
 palette=Array.from({length:16},(_,i)=>rgb(mix(lo,hi,i/15)));
 const root=document.documentElement.style;
 root.setProperty('--bg',theme.background);
 root.setProperty('--accent',rgb(mix(base,white,.32)));
 root.setProperty('--accent-hover',rgb(mix(base,white,.5)));
 root.setProperty('--control',rgb(mix([15,20,24],base,.055)));
 root.setProperty('--control-hover',rgb(mix([23,30,35],base,.10)));
 root.setProperty('--well',rgb(mix([5,9,13],base,.025)));
 root.setProperty('--selected',rgb(mix([25,32,38],base,.18)));
 root.setProperty('--panel',rgb(mix([10,15,19],base,.035)));
 document.querySelector('meta[name="theme-color"]').content=theme.background;
 $('color').value=prefs.color;
 for(const button of document.querySelectorAll('[data-color]'))button.setAttribute('aria-pressed',String(button.dataset.color===prefs.color));
 cacheBackground();
}
function cacheBackground(){
 if(!background||!sim)return;
 const bg=background.getContext('2d');bg.setTransform(dpr,0,0,dpr,0,0);
 bg.fillStyle=theme.background;bg.fillRect(0,0,W,H);
 if(!prefs.backdrop)return;
 bg.fillStyle=theme.recess;bg.beginPath();
 for(let y=1;y<sim.ny-1;y++)for(let x=1;x<sim.nx-1;x++){
   const px=(x-.5)*sx,py=(y-.5)*sy,r=Math.min(sx,sy)*.38;
   bg.moveTo(px+r,py);bg.arc(px,py,r,0,Math.PI*2);
 }
 bg.fill();
}
function tip(text,ms=3000){$('tip').textContent=text;$('tip').classList.add('show');clearTimeout(tipTimer);tipTimer=setTimeout(()=>$('tip').classList.remove('show'),ms);}
function setStatus(){
 const now=performance.now();
 $('status').textContent=paused?'Paused':(motion?(now-Math.max(orientationTime,motionTime)<1600?'Motion live':'Waiting for motion'):'Drag to stir')+' · '+fps+' fps';
}
function resize(){
 const old=sim;
 W=innerWidth;H=innerHeight;dpr=Math.min(devicePixelRatio||1,2);
 canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
 const pitch=Math.max(8,Math.min(W,H)/36,Math.max(W,H)/78);
 const nx=Math.round(W/pitch)+2,ny=Math.round(H/pitch)+2;
 // Preserve water and momentum through address-bar resizes and rotation.
 if(!old||old.nx!==nx||old.ny!==ny){
   sim=new Liquid(nx,ny,prefs.level,prefs.fill/100);
   if(old){
     sim.count=Math.min(old.count,sim.capacity);
     const rx=(nx-2)/(old.nx-2),ry=(ny-2)/(old.ny-2);
     for(let i=0;i<sim.count;i++){
       sim.x[i]=1+(old.x[i]-1)*rx;sim.y[i]=1+(old.y[i]-1)*ry;
       sim.vx[i]=old.vx[i]*rx;sim.vy[i]=old.vy[i]*ry;sim.collide(i);
     }
     // Particle count is conserved; density scales with the new grid area.
     sim.restDensity=old.restDensity/(rx*ry);
     sim.transfer(true);sim.updateDensity();
   }
 }
 sx=W/(sim.nx-2);sy=H/(sim.ny-2);
 background=document.createElement('canvas');background.width=canvas.width;background.height=canvas.height;
 cacheBackground();
 liquidCanvas=document.createElement('canvas');liquidCanvas.width=(sim.nx-2)*3;liquidCanvas.height=(sim.ny-2)*3;
 liquidCtx=liquidCanvas.getContext('2d');liquidImage=liquidCtx.createImageData(liquidCanvas.width,liquidCanvas.height);
 pointer=null;accumulator=0;
}
function drawDots(){
 ctx.drawImage(background,0,0,W,H);
 const {nx,ny,density:d,solid}=sim,r=Math.min(sx,sy)*.40;
 // Batch by shade; compute the density and speed only once per pixel.
 const paths=Array.from({length:16},()=>new Path2D());
 for(let y=1;y<ny-1;y++)for(let x=1;x<nx-1;x++){
   const i=x+y*nx;if(solid[i]||d[i]<.30)continue;
   const surface=Math.min(d[i-1],d[i+1],d[i-nx],d[i+nx]);
   const speed=Math.hypot(sim.u[i],sim.v[i]);
   const shade=clamp(Math.floor((surface<.7?8:1)+Math.min(5,speed*.025)+Math.min(2,d[i]*.5)),0,15);
   const px=(x-.5)*sx,py=(y-.5)*sy,rr=r*Math.min(1,.5+d[i]*.65),path=paths[shade];
   path.moveTo(px+rr,py);path.arc(px,py,rr,0,Math.PI*2);
 }
 for(let c=0;c<16;c++){ctx.fillStyle=palette[c];ctx.fill(paths[c]);}
}
function drawWater(){
 ctx.fillStyle=theme.background;ctx.fillRect(0,0,W,H);
 const sheen=prefs.rheoscopic?(rheo||=new Rheoscopic(sim)).sheen:null;
 const {nx,density:d}=sim,iw=liquidCanvas.width,ih=liquidCanvas.height,data=liquidImage.data;
 for(let y=0;y<ih;y++)for(let x=0;x<iw;x++){
   const gx=x/3+.5,gy=y/3+.5,ix=Math.floor(gx),iy=Math.floor(gy),tx=gx-ix,ty=gy-iy,k=ix+iy*nx;
   const value=(d[k]*(1-tx)+d[k+1]*tx)*(1-ty)+(d[k+nx]*(1-tx)+d[k+nx+1]*tx)*ty;
   const a=clamp((value-.48)*5,0,1),edge=1-clamp((value-.65)/1.7,0,1),i=(x+y*iw)*4;
   if(sheen){
     const shine=(sheen[k]*(1-tx)+sheen[k+1]*tx)*(1-ty)+(sheen[k+nx]*(1-tx)+sheen[k+nx+1]*tx)*ty;
     const light=.42+.84*shine,pearl=Math.pow(shine,3)*.28;
     for(let channel=0;channel<3;channel++){
       const base=theme.water[channel]*light;
       const lit=base+(255-base)*pearl;
       data[i+channel]=Math.round(lit+edge*.38*(theme.edge[channel]-lit));
     }
   }else{
     data[i]=Math.round(theme.water[0]+edge*(theme.edge[0]-theme.water[0]));
     data[i+1]=Math.round(theme.water[1]+edge*(theme.edge[1]-theme.water[1]));
     data[i+2]=Math.round(theme.water[2]+edge*(theme.edge[2]-theme.water[2]));
   }
   data[i+3]=Math.round(a*255);
 }
 liquidCtx.putImageData(liquidImage,0,0);ctx.imageSmoothingEnabled=true;ctx.drawImage(liquidCanvas,0,0,W,H);
 if(sheen)rheo.draw(ctx,W,H,sx,sy,liquidCanvas,theme);
}
function render(){
 if(rheo&&rheo.sim!==sim)rheo=null;
 prefs.look==='dots'?drawDots():drawWater();
 ctx.lineCap='round';
 for(const s of sim.shapes){
   const x1=(s.x1-1)*sx,y1=(s.y1-1)*sy,x2=(s.x2-1)*sx,y2=(s.y2-1)*sy;
   ctx.strokeStyle=theme.wall;ctx.lineWidth=s.r*2*Math.min(sx,sy)+2;
   ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2+.001,y2);ctx.stroke();
   ctx.strokeStyle=theme.wallFill;ctx.lineWidth=s.r*2*Math.min(sx,sy)-2;ctx.stroke();
 }
 if(pointer){ctx.strokeStyle='rgba(235,245,255,.4)';ctx.lineWidth=1;ctx.beginPath();ctx.arc((pointer.x-1)*sx,(pointer.y-1)*sy,4*Math.min(sx,sy),0,Math.PI*2);ctx.stroke();}
 ctx.strokeStyle='rgba(210,230,240,.15)';ctx.lineWidth=1;ctx.strokeRect(.5,.5,W-1,H-1);
}
function frameLoop(t){
 const elapsed=lastTime?Math.min(.05,(t-lastTime)/1000):DT;lastTime=t;
 if(!document.hidden){
   if(!paused){
   accumulator=Math.min(accumulator+elapsed,.05);
   const sensorFresh=t-linearTime<180;
   const a=sensorFresh?linear:{x:0,y:0};
   let g=gravity;
   if(keyboard.size){let x=(keyboard.has('ArrowRight')?1:0)-(keyboard.has('ArrowLeft')?1:0),y=(keyboard.has('ArrowDown')?1:0)-(keyboard.has('ArrowUp')?1:0);const m=Math.hypot(x,y)||1;g={x:x/m,y:y/m};}
   while(accumulator>=DT){
     // Sensors give acceleration, not impulses: never accumulate per event.
     const ax=clamp((g.x-a.x/9.81)*prefs.response*MOTION_BASELINE,-4,4),ay=clamp((g.y-a.y/9.81)*prefs.response*MOTION_BASELINE,-4,4);
     if(pointer&&t-pointer.time>50){const decay=Math.exp(-DT*32);pointer.vx*=decay;pointer.vy*=decay;}
     sim.step(DT,ax,ay,pointer);accumulator-=DT;
     if(prefs.look==='water'&&prefs.rheoscopic){
       if(!rheo||rheo.sim!==sim)rheo=new Rheoscopic(sim);
       rheo.update(DT);
     }
   }
   }else accumulator=0;
   render();
 }
 frame++;
 if(t-fpsTime>900){fps=Math.round(frame*1000/(t-fpsTime));frame=0;fpsTime=t;setStatus();}
 if(hasInteracted&&!paused&&!panel.open&&t-lastTouch>8000&&!pointer)document.body.classList.add('immersed');
 requestAnimationFrame(frameLoop);
}
function onOrientation(e){
 if(!motion||!Number.isFinite(e.beta)||!Number.isFinite(e.gamma))return;
 gravity=orientationGravity(e.beta,e.gamma,angle());orientationTime=performance.now();
}
function onMotion(e){
 if(!motion)return;
 const now=performance.now(),a=e.acceleration;
 if(a&&Number.isFinite(a.x)&&Number.isFinite(a.y)){
   // Device y points toward the phone's top; canvas y points down.
   const p=screenVector(a.x,-a.y,angle());
   linear={x:clamp(p.x,-35,35),y:clamp(p.y,-35,35)};motionTime=now;linearTime=now;
 }
 // Some browsers expose gravity only through DeviceMotion. Calibrate its
 // sign against orientation when both feeds are present before using it.
 const raw=e.accelerationIncludingGravity;
 if(raw&&Number.isFinite(raw.x)&&Number.isFinite(raw.y)){
   const g=screenVector(raw.x/9.81,-raw.y/9.81,angle());
   if(now-orientationTime<200&&Math.hypot(g.x,g.y)>.2){onMotion.gravitySign=(g.x*gravity.x+g.y*gravity.y)<0?-1:1;}
   if(now-orientationTime>600){const sign=onMotion.gravitySign??1;gravity={x:clamp(sign*g.x,-1,1),y:clamp(sign*g.y,-1,1)};motionTime=now;}
 }
}
async function enableMotion(){
 if(permissionPending)return;
 if(motion){motion=false;gravity={x:0,y:1};linear={x:0,y:0};$('motion').textContent='Enable motion';$('motion').classList.add('primary');setStatus();return;}
 const O=window.DeviceOrientationEvent,M=window.DeviceMotionEvent;
 if(!O&&!M){tip('No motion sensor here. Drag to stir, or use the arrow keys.');return;}
 permissionPending=true;
 try{
   // Start both requests inside the original tap (iOS user activation).
   const requests=[O&&typeof O.requestPermission==='function'?O.requestPermission():Promise.resolve(O?'granted':'unsupported'),M&&typeof M.requestPermission==='function'?M.requestPermission():Promise.resolve(M?'granted':'unsupported')];
   const granted=await Promise.allSettled(requests);
   const ok=granted.some(r=>r.status==='fulfilled'&&r.value==='granted');
   if(!ok){tip('Motion permission is off. You can still stir by dragging. Tap Enable motion to try again.',5000);return;}
   motion=true;orientationTime=-Infinity;motionTime=-Infinity;
   $('motion').textContent='Motion on';$('motion').classList.remove('primary');
   tip('Hold your phone upright. Tilt to pour; give it a quick shake to splash.',4000);
   setTimeout(()=>{if(motion&&performance.now()-Math.max(orientationTime,motionTime)>2500)tip('No sensor readings yet. On iPhone, open this page in Safari and allow Motion & Orientation access.',6500);},3000);
 }catch{tip('Motion could not start. Open in Safari or Chrome and try again; dragging still works.',5000);}
 finally{permissionPending=false;setStatus();}
}
addEventListener('deviceorientation',onOrientation,{passive:true});addEventListener('devicemotion',onMotion,{passive:true});
function wake(){lastTouch=performance.now();hasInteracted=true;document.body.classList.remove('immersed');}
canvas.addEventListener('pointerdown',e=>{
 if(!e.isPrimary)return;wake();if(paused)return;canvas.setPointerCapture(e.pointerId);
 pointer={id:e.pointerId,x:e.clientX/sx+1,y:e.clientY/sy+1,vx:0,vy:0,time:performance.now()};
});
canvas.addEventListener('pointermove',e=>{
 if(!pointer||pointer.id!==e.pointerId)return;
 const t=performance.now(),dt=Math.max(.004,(t-pointer.time)/1000),x=e.clientX/sx+1,y=e.clientY/sy+1;
 pointer.vx=clamp((x-pointer.x)/dt,-220,220);pointer.vy=clamp((y-pointer.y)/dt,-220,220);
 pointer.x=x;pointer.y=y;pointer.time=t;lastTouch=t;
});
for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>{pointer=null;});
document.addEventListener('pointerdown',e=>{if(e.target!==canvas)wake();},{passive:true});
$('restore').onclick=wake;
$('motion').onclick=enableMotion;
$('settings').onclick=()=>{wake();panel.showModal();};$('close').onclick=()=>panel.close();
panel.addEventListener('click',e=>{if(e.target===panel){const r=panel.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)panel.close();}});
panel.addEventListener('close',()=>{
 if(hideAfterClose){document.body.classList.add('immersed');lastTouch=-Infinity;hideAfterClose=false;}else wake();
});
$('level').value=prefs.level;$('level').onchange=e=>{prefs.level=e.target.value;sim.makeLevel(prefs.level);for(let i=0;i<sim.count;i++)sim.collide(i);save();wake();tip(prefs.level==='bottle'?'Just the water. No obstacles.':'Tip your phone to pour through the '+prefs.level+'.',2200);};
function refill(){setPaused(false);sim=new Liquid(sim.nx,sim.ny,prefs.level,prefs.fill/100);pointer=null;accumulator=0;}
$('fill').value=prefs.fill;$('fill-value').textContent=prefs.fill+'%';
$('fill').oninput=e=>{$('fill-value').textContent=e.target.value+'%';};
$('fill').onchange=e=>{prefs.fill=Number(e.target.value);refill();save();};
$('response').value=prefs.response;$('response-value').textContent=prefs.response.toFixed(1)+'×';
$('response').oninput=e=>{prefs.response=Number(e.target.value);$('response-value').textContent=prefs.response.toFixed(1)+'×';save();};
function setPaused(value){
 paused=value;pointer=null;accumulator=0;lastTime=0;keyboard.clear();linear={x:0,y:0};
 $('pause').textContent=paused?'Resume':'Pause';$('pause').setAttribute('aria-pressed',String(paused));
 $('resume').hidden=!paused;setStatus();wake();
}
$('pause').onclick=()=>setPaused(!paused);$('resume').onclick=()=>setPaused(false);
for(const button of document.querySelectorAll('[data-color]'))button.onclick=()=>{prefs.color=button.dataset.color;applyColor();save();};
$('color').oninput=e=>{prefs.color=e.target.value;applyColor();save();};
$('backdrop').checked=prefs.backdrop;
$('backdrop').onchange=e=>{prefs.backdrop=e.target.checked;cacheBackground();save();};
$('rheoscopic').checked=prefs.rheoscopic;
$('rheoscopic').onchange=e=>{prefs.rheoscopic=e.target.checked;rheo=null;save();};
function setLook(look){prefs.look=look;rheo=null;$('rheo-option').hidden=look!=='water';$('backdrop').closest('.toggle-row').hidden=look!=='dots';for(const id of ['dots','water'])$(id).setAttribute('aria-pressed',String(id===look));save();}
for(const id of ['dots','water'])$(id).onclick=()=>setLook(id);setLook(prefs.look);
$('reset').onclick=()=>{refill();panel.close();};
$('splash').onclick=()=>{setPaused(false);for(let i=0;i<sim.count;i++){const x=(sim.x[i]/sim.nx-.5);sim.vx[i]+=75;sim.vy[i]-=95*(1-x*x);}panel.close();};
$('hide').onclick=()=>{hideAfterClose=true;panel.close();};
$('fullscreen').onclick=async()=>{
 try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else{panel.close();tip('For fullscreen on iPhone: Share → Add to Home Screen.',5000);}}
 catch{panel.close();tip('Fullscreen is unavailable here. On iPhone, use Share → Add to Home Screen.',5000);}
};
document.addEventListener('keydown',e=>{
 if(panel.open||['INPUT','SELECT','BUTTON','A'].includes(e.target.tagName))return;
 if(e.key.startsWith('Arrow')){e.preventDefault();keyboard.add(e.key);wake();}
 if(e.key.toLowerCase()==='r')refill();
 if(e.code==='Space'&&!e.repeat){e.preventDefault();setPaused(!paused);}
});
addEventListener('keyup',e=>keyboard.delete(e.key));addEventListener('blur',()=>{keyboard.clear();pointer=null;linear={x:0,y:0};});
document.addEventListener('visibilitychange',()=>{lastTime=0;accumulator=0;pointer=null;keyboard.clear();linear={x:0,y:0};});
let resizeTimer;addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(resize,100);});
applyColor();resize();fpsTime=performance.now();requestAnimationFrame(frameLoop);
tip('A little water in your phone. Enable motion, or drag to stir.',4500);
