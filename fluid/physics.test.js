import test from 'node:test';
import assert from 'node:assert/strict';
import {Liquid,orientationGravity,screenVector} from './physics.js';
const advance=(s,t,x=0,y=1)=>{for(let i=0;i<t*120;i++)s.step(1/120,x,y);};
function stats(s){let x=0,y=0,v=0;for(let i=0;i<s.count;i++){x+=s.x[i];y+=s.y[i];v+=s.vx[i]**2+s.vy[i]**2;}return{x:x/s.count,y:y/s.count,rms:Math.sqrt(v/s.count)};}
function contained(s){for(let i=0;i<s.count;i++){assert.ok(Number.isFinite(s.x[i]+s.y[i]+s.vx[i]+s.vy[i]));assert.ok(s.x[i]>=1.2549&&s.x[i]<=s.nx-1.2549);assert.ok(s.y[i]>=1.2549&&s.y[i]<=s.ny-1.2549);for(const o of s.shapes)assert.ok(s.distance(s.x[i],s.y[i],o)>=s.radius-.002);}}
test('gravity handles upright, flat, inverted and landscape phones',()=>{
 assert.ok(Math.abs(orientationGravity(90,45).x)<1e-8);
 assert.ok(Math.abs(orientationGravity(90,0).y-1)<1e-8);
 assert.ok(Math.abs(orientationGravity(-90,0).y+1)<1e-8);
 assert.deepEqual(orientationGravity(0,0),{x:0,y:0});
 assert.ok(Math.abs(orientationGravity(0,90,90).y-1)<1e-8);
 const p=screenVector(2,-3,90);assert.ok(Math.abs(p.x-3)<1e-8&&Math.abs(p.y-2)<1e-8);
});
test('a stationary bottle settles without losing liquid or self-exciting',()=>{
 const s=new Liquid(34,66),n=s.count,initial=stats(s);advance(s,4);const end=stats(s);
 contained(s);assert.equal(s.count,n);assert.ok(end.rms<4,`resting speed ${end.rms}`);
 assert.ok(Math.abs(end.y-initial.y)<2,'water volume should remain stable');
});
test('tilt reacts within a quarter second and keeps momentum',()=>{
 const s=new Liquid(34,66);advance(s,1);const before=stats(s);advance(s,.25,1,0);const after=stats(s);
 assert.ok(after.x>before.x+4,'water should cross the bottle quickly');
 assert.ok(after.rms>25,'water should still have momentum');contained(s);
});
test('all courses contain repeated strong shakes, and empty mode removes all obstacles',()=>{
 for(const level of ['bottle','slides','funnel','pins']){
   const s=new Liquid(30,58,level,.30),n=s.count;
   for(let j=0;j<6;j++)advance(s,.12,j%2?3:-3,j%3?1:-2);
   contained(s);assert.equal(s.count,n);
   s.makeLevel('bottle');assert.equal(s.shapes.length,0);
   assert.equal(s.solid.reduce((a,b)=>a+b,0),2*s.nx+2*(s.ny-2));
 }
});
