/*
 * Rendering-only rheoscopic pigment. Reads the FLIP state without changing it.
 * Platelet directors rotate under local vorticity and strain (a 2D Jeffery-like
 * approximation); pigment and short pathlines follow existing fluid particles.
 * Inspired by the flow-visualization idea in Hlawatsch et al., Virtual
 * Rheoscopic Fluids: https://sites.cc.gatech.edu/people/home/turk/my_papers/rheoscopic_fluids.pdf
 * This is a qualitative optical effect, not a turbulence measurement.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const TAU=2*Math.PI;
export class Rheoscopic {
  constructor(sim){
    this.sim=sim;
    this.angle=new Float32Array(sim.count);
    this.shine=new Float32Array(sim.count);
    this.sheen=new Float32Array(sim.size);
    this.weight=new Float32Array(sim.size);
    this.rotation=new Float32Array(sim.size);
    this.stretch=new Float32Array(sim.size);
    this.cross=new Float32Array(sim.size);
    this.stride=Math.max(1,Math.ceil(sim.count/850));
    this.tracers=Math.ceil(sim.count/this.stride);
    this.history=11;this.cursor=0;this.samples=1;this.clock=0;
    this.tx=new Float32Array(this.tracers*this.history);
    this.ty=new Float32Array(this.tracers*this.history);
    for(let i=0;i<sim.count;i++){
      // Coherent initial orientation gives a subtle pearlescent grain at rest.
      // There is no wall-clock animation or fresh random noise per frame.
      this.angle[i]=.65*Math.sin(sim.x[i]*.71+sim.y[i]*.17)+.5*Math.sin(sim.y[i]*.49-sim.x[i]*.23)+(i*.61803398875%1)*.35;
    }
    for(let j=0;j<this.tracers;j++){this.tx[j]=sim.x[j*this.stride];this.ty[j]=sim.y[j*this.stride];}
    this.update(0);
  }
  update(dt){
    const {sim,angle,sheen,weight,rotation,stretch,cross,shine}=this;
    const {nx,ny,u,v,density,x,y,count}=sim;
    // MAC face velocities yield the local velocity gradient at cell centres.
    for(let cy=1;cy<ny-1;cy++)for(let cx=1;cx<nx-1;cx++){
      const k=cx+cy*nx;
      const wet=clamp((density[k]-.7)/2,0,1);
      const ux=u[k+1]-u[k],vy=v[k+nx]-v[k];
      const uy=(u[k+nx]+u[k+nx+1]-u[k-nx]-u[k-nx+1])*.25;
      const vx=(v[k+1]+v[k+nx+1]-v[k-1]-v[k+nx-1])*.25;
      rotation[k]=(vx-uy)*.5*wet;
      stretch[k]=(vy-ux)*.5*wet;cross[k]=(uy+vx)*.5*wet;
    }
    sheen.fill(0);weight.fill(0);
    for(let i=0;i<count;i++){
      const cx=clamp(x[i]-.5,0,nx-1.001),cy=clamp(y[i]-.5,0,ny-1.001);
      const ix=Math.floor(cx),iy=Math.floor(cy),fx=cx-ix,fy=cy-iy,k=ix+iy*nx;
      const a=(1-fx)*(1-fy),b=fx*(1-fy),c=(1-fx)*fy,d=fx*fy;
      const spin=a*rotation[k]+b*rotation[k+1]+c*rotation[k+nx]+d*rotation[k+nx+1];
      const sx=a*stretch[k]+b*stretch[k+1]+c*stretch[k+nx]+d*stretch[k+nx+1];
      const sy=a*cross[k]+b*cross[k+1]+c*cross[k+nx]+d*cross[k+nx+1];
      let theta=angle[i];
      if(dt>0){
        const rate=spin+.88*(sy*Math.cos(2*theta)+sx*Math.sin(2*theta));
        theta=(theta+clamp(rate*dt,-.55,.55))%TAU;angle[i]=theta;
      }
      // A fixed virtual light makes aligned flakes flash together in bands.
      const facing=.5+.5*Math.cos(2*theta-1.15);
      const glint=facing*facing*facing;
      const q=.07+.93*glint;
      shine[i]=q;
      sheen[k]+=q*a;weight[k]+=a;sheen[k+1]+=q*b;weight[k+1]+=b;
      sheen[k+nx]+=q*c;weight[k+nx]+=c;sheen[k+nx+1]+=q*d;weight[k+nx+1]+=d;
    }
    for(let k=0;k<sheen.length;k++)sheen[k]=weight[k]>1e-5?sheen[k]/weight[k]:.35;
    // Record material pathlines at a fixed rate; pause freezes the pigment too.
    this.clock+=dt;
    if(this.clock>=1/30){
      this.clock%=1/30;this.cursor=(this.cursor+1)%this.history;
      this.samples=Math.min(this.samples+1,this.history);
      const offset=this.cursor*this.tracers;
      for(let j=0;j<this.tracers;j++){this.tx[offset+j]=x[j*this.stride];this.ty[offset+j]=y[j*this.stride];}
    }
  }
  draw(ctx,width,height,sx,sy,liquidMask,theme){
    if(!this.canvas){this.canvas=document.createElement('canvas');this.ctx=this.canvas.getContext('2d');}
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    const c=this.ctx,{sim}=this;
    c.clearRect(0,0,width,height);
    c.globalCompositeOperation='source-over';c.lineCap='round';c.lineJoin='round';
    const rgb=theme.edge.map(v=>Math.round(v+(255-v)*.52));
    c.strokeStyle=`rgb(${rgb.join(',')})`;
    // Short, fading ribbons trace actual particle paths, so curls are visible.
    for(let age=this.samples-1;age>=0;age--){
      const h=(this.cursor-age+this.history)%this.history;
      const newer=(h+1)%this.history;
      c.globalAlpha=.085*Math.pow(1-age/this.history,1.6);
      c.lineWidth=Math.max(.55,Math.min(sx,sy)*.085);c.beginPath();
      for(let j=0;j<this.tracers;j++){
        const i=j*this.stride,k=h*this.tracers+j;
        const x1=this.tx[k],y1=this.ty[k];
        const x2=age===0?sim.x[i]:this.tx[newer*this.tracers+j];
        const y2=age===0?sim.y[i]:this.ty[newer*this.tracers+j];
        const dist=(x2-x1)**2+(y2-y1)**2;
        if(dist<.002||dist>64)continue;
        c.moveTo((x1-1)*sx,(y1-1)*sy);c.lineTo((x2-1)*sx,(y2-1)*sy);
      }
      c.stroke();
    }
    // Fine platelets share the same optical orientation as the broad sheen.
    c.lineWidth=Math.max(.6,Math.min(sx,sy)*.06);
    for(let band=0;band<3;band++){
      c.globalAlpha=.09+band*.09;c.beginPath();
      for(let j=0;j<this.tracers;j++){
        const i=j*this.stride,q=this.shine[i];
        if(Math.min(2,Math.floor(q*3))!==band)continue;
        const a=this.angle[i],len=.11+.1*q,dx=Math.cos(a)*len*sx,dy=Math.sin(a)*len*sy;
        const x=(sim.x[i]-1)*sx,y=(sim.y[i]-1)*sy;
        c.moveTo(x-dx,y-dy);c.lineTo(x+dx,y+dy);
      }
      c.stroke();
    }
    // Clip every streak to this frame's liquid, including its moving surface.
    c.globalAlpha=1;c.globalCompositeOperation='destination-in';
    c.drawImage(liquidMask,0,0,width,height);
    c.globalCompositeOperation='source-over';ctx.drawImage(this.canvas,0,0,width,height);
  }
}
