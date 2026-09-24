import {Liquid,clamp,screenVector,orientationGravity} from './physics.js?v=2';
const $=id=>document.getElementById(id),canvas=$('fluid'),ctx=canvas.getContext('2d',{alpha:false});
const panel=$('panel');
let prefs={level:'bottle',fill:34,response:1,look:'dots'};
try {
  const saved=JSON.parse(localStorage.getItem('pocket-fluid-v2')||'null');
  if(saved){
    if(['bottle','slides','funnel','pins'].includes(saved.level))prefs.level=saved.level;
    if(['dots','water'].includes(saved.look))prefs.look=saved.look;
    if(Number.isFinite(saved.fill))prefs.fill=clamp(saved.fill,15,60);
    if(Number.isFinite(saved.response))prefs.response=clamp(saved.response,.6,1.6);
  }
}catch{}
const save=()=>{try{localStorage.setItem('pocket-fluid-v2',JSON.stringify(prefs));}catch{}};
let sim,W,H,dpr,sx,sy,background,liquidCanvas,liquidCtx,liquidImage;
let motion=false,permissionPending=false,orientationTime=-Infinity,motionTime=-Infinity,linearTime=-Infinity;
let gravity={x:0,y:1},linear={x:0,y:0},pointer=null;
let lastTime=0,accumulator=0,frame=0,fpsTime=0,fps=60,lastTouch=performance.now();
let tipTimer,hasInteracted=false,hideAfterClose=false,keyboard=new Set();
const DT=1/120;
const angle=()=>screen.orientation?.angle??Number(window.orientation??0);
const palette=Array.from({length:16},(_,i)=>`rgb(${Math.round(44+i*7)},${Math.round(186+i*4)},${Math.round(93+i*7)})`);
function tip(text,ms=3000){$('tip').textContent=text;$('tip').classList.add('show');clearTimeout(tipTimer);tipTimer=setTimeout(()=>$('tip').classList.remove('show'),ms);}
function setStatus(){
 const now=performance.now();
 $('status').textContent=(motion?(now-Math.max(orientationTime,motionTime)<1600?'Motion live':'Waiting for motion'):'Drag to stir')+' · '+fps+' fps';
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
 const bg=background.getContext('2d');bg.setTransform(dpr,0,0,dpr,0,0);
 bg.fillStyle='#06100c';bg.fillRect(0,0,W,H);
 bg.fillStyle='#102018';bg.beginPath();
 for(let y=1;y<sim.ny-1;y++)for(let x=1;x<sim.nx-1;x++){
   const px=(x-.5)*sx,py=(y-.5)*sy,r=Math.min(sx,sy)*.38;
   bg.moveTo(px+r,py);bg.arc(px,py,r,0,Math.PI*2);
 }
 bg.fill();
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
 ctx.fillStyle='#06100c';ctx.fillRect(0,0,W,H);
 const {nx,density:d}=sim,iw=liquidCanvas.width,ih=liquidCanvas.height,data=liquidImage.data;
 for(let y=0;y<ih;y++)for(let x=0;x<iw;x++){
   const gx=x/3+.5,gy=y/3+.5,ix=Math.floor(gx),iy=Math.floor(gy),tx=gx-ix,ty=gy-iy,k=ix+iy*nx;
   const value=(d[k]*(1-tx)+d[k+1]*tx)*(1-ty)+(d[k+nx]*(1-tx)+d[k+nx+1]*tx)*ty;
   const a=clamp((value-.48)*5,0,1),edge=1-clamp((value-.65)/1.7,0,1),i=(x+y*iw)*4;
   data[i]=Math.round(32+edge*102);data[i+1]=Math.round(185+edge*63);data[i+2]=Math.round(98+edge*80);data[i+3]=Math.round(a*255);
 }
 liquidCtx.putImageData(liquidImage,0,0);ctx.imageSmoothingEnabled=true;ctx.drawImage(liquidCanvas,0,0,W,H);
}
function render(){
 prefs.look==='dots'?drawDots():drawWater();
 ctx.lineCap='round';
 for(const s of sim.shapes){
   const x1=(s.x1-1)*sx,y1=(s.y1-1)*sy,x2=(s.x2-1)*sx,y2=(s.y2-1)*sy;
   ctx.strokeStyle='#46624f';ctx.lineWidth=s.r*2*Math.min(sx,sy)+2;
   ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2+.001,y2);ctx.stroke();
   ctx.strokeStyle='#172d20';ctx.lineWidth=s.r*2*Math.min(sx,sy)-2;ctx.stroke();
 }
 if(pointer){ctx.strokeStyle='#d0ffdf66';ctx.lineWidth=1;ctx.beginPath();ctx.arc((pointer.x-1)*sx,(pointer.y-1)*sy,4*Math.min(sx,sy),0,Math.PI*2);ctx.stroke();}
 ctx.strokeStyle='#91c8a226';ctx.lineWidth=1;ctx.strokeRect(.5,.5,W-1,H-1);
}
function frameLoop(t){
 const elapsed=lastTime?Math.min(.05,(t-lastTime)/1000):DT;lastTime=t;
 if(!document.hidden){
   accumulator=Math.min(accumulator+elapsed,.05);
   const sensorFresh=t-linearTime<180;
   const a=sensorFresh?linear:{x:0,y:0};
   let g=gravity;
   if(keyboard.size){let x=(keyboard.has('ArrowRight')?1:0)-(keyboard.has('ArrowLeft')?1:0),y=(keyboard.has('ArrowDown')?1:0)-(keyboard.has('ArrowUp')?1:0);const m=Math.hypot(x,y)||1;g={x:x/m,y:y/m};}
   while(accumulator>=DT){
     // Sensors give acceleration, not impulses: never accumulate per event.
     const ax=clamp((g.x-a.x/9.81)*prefs.response,-4,4),ay=clamp((g.y-a.y/9.81)*prefs.response,-4,4);
     if(pointer&&t-pointer.time>50){const decay=Math.exp(-DT*32);pointer.vx*=decay;pointer.vy*=decay;}
     sim.step(DT,ax,ay,pointer);accumulator-=DT;
   }
   render();
 }
 frame++;
 if(t-fpsTime>900){fps=Math.round(frame*1000/(t-fpsTime));frame=0;fpsTime=t;setStatus();}
 if(hasInteracted&&!panel.open&&t-lastTouch>8000&&!pointer)document.body.classList.add('immersed');
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
 if(!e.isPrimary)return;wake();canvas.setPointerCapture(e.pointerId);
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
function refill(){sim=new Liquid(sim.nx,sim.ny,prefs.level,prefs.fill/100);pointer=null;accumulator=0;}
$('fill').value=prefs.fill;$('fill-value').textContent=prefs.fill+'%';
$('fill').oninput=e=>{$('fill-value').textContent=e.target.value+'%';};
$('fill').onchange=e=>{prefs.fill=Number(e.target.value);refill();save();};
$('response').value=prefs.response;$('response-value').textContent=prefs.response.toFixed(1)+'×';
$('response').oninput=e=>{prefs.response=Number(e.target.value);$('response-value').textContent=prefs.response.toFixed(1)+'×';save();};
function setLook(look){prefs.look=look;for(const id of ['dots','water'])$(id).setAttribute('aria-pressed',String(id===look));save();}
for(const id of ['dots','water'])$(id).onclick=()=>setLook(id);setLook(prefs.look);
$('reset').onclick=()=>{refill();panel.close();};
$('splash').onclick=()=>{for(let i=0;i<sim.count;i++){const x=(sim.x[i]/sim.nx-.5);sim.vx[i]+=75;sim.vy[i]-=95*(1-x*x);}panel.close();};
$('hide').onclick=()=>{hideAfterClose=true;panel.close();};
$('fullscreen').onclick=async()=>{
 try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else{panel.close();tip('For fullscreen on iPhone: Share → Add to Home Screen.',5000);}}
 catch{panel.close();tip('Fullscreen is unavailable here. On iPhone, use Share → Add to Home Screen.',5000);}
};
document.addEventListener('keydown',e=>{
 if(panel.open||['INPUT','SELECT','BUTTON','A'].includes(e.target.tagName))return;
 if(e.key.startsWith('Arrow')){e.preventDefault();keyboard.add(e.key);wake();}
 if(e.key.toLowerCase()==='r')refill();
});
addEventListener('keyup',e=>keyboard.delete(e.key));addEventListener('blur',()=>{keyboard.clear();pointer=null;linear={x:0,y:0};});
document.addEventListener('visibilitychange',()=>{lastTime=0;accumulator=0;pointer=null;keyboard.clear();linear={x:0,y:0};});
let resizeTimer;addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(resize,100);});
resize();fpsTime=performance.now();requestAnimationFrame(frameLoop);
tip('A little water in your phone. Enable motion, or drag to stir.',4500);
