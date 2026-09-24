/*
 * Staggered-grid FLIP/PIC liquid. Pressure projection and velocity transfer
 * adapted from Matthias Müller's Ten Minute Physics (MIT; see LICENSE).
 * Coordinates: cell units, +x right, +y down; velocities in cells/second.
 */
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function screenVector(x, y, degrees = 0) {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return {x: c*x - s*y, y: s*x + c*y};
}
export function orientationGravity(beta, gamma, angle = 0) {
  const b = beta * Math.PI/180, g = gamma * Math.PI/180;
  return screenVector(Math.cos(b)*Math.sin(g), Math.sin(b), angle);
}

export class Liquid {
  constructor(nx, ny, level = 'bottle', fill = 0.34) {
    this.nx = nx; this.ny = ny; this.size = nx*ny;
    for (const key of ['u','v','oldU','oldV','wu','wv','density']) this[key] = new Float32Array(this.size);
    this.solid = new Uint8Array(this.size);
    this.type = new Uint8Array(this.size); // 0 air, 1 liquid, 2 solid
    this.active = new Int32Array(this.size);
    this.capacity = Math.ceil(this.size*4);
    for (const key of ['x','y','vx','vy']) this[key] = new Float32Array(this.capacity);
    this.next = new Int32Array(this.capacity);
    this.hashWidth = Math.ceil(nx/.6); this.hashHeight = Math.ceil(ny/.6);
    this.head = new Int32Array(this.hashWidth*this.hashHeight);
    this.radius = 0.255;
    this.restDensity = 1/(0.55*0.55*Math.sqrt(3)/2);
    this.gravity = Math.min(nx-2,ny-2)*9.81/0.22;
    this.blend = .955; this.iterations = 60;
    this.makeLevel(level);
    this.seed(fill);
  }
  makeLevel(level) {
    this.level = level; this.shapes = [];
    const X = u => 1+u*(this.nx-2), Y = v => 1+v*(this.ny-2);
    const line = (a,b,c,d,r=.8) => this.shapes.push({x1:X(a),y1:Y(b),x2:X(c),y2:Y(d),r});
    const peg = (a,b,r=1.2) => line(a,b,a,b,r);
    if (level === 'slides') {
      line(.02,.32,.68,.42); line(.98,.51,.32,.61); line(.02,.70,.68,.80);
      peg(.80,.39); peg(.20,.58); peg(.81,.77);
    } else if (level === 'funnel') {
      line(.02,.33,.40,.49); line(.98,.33,.60,.49);
      line(.40,.49,.40,.70); line(.60,.49,.60,.70);
      line(.50,.77,.20,.87); line(.50,.77,.80,.87);
    } else if (level === 'pins') {
      for (let row=0;row<4;row++) for (const x of (row%2 ? [.33,.67] : [.18,.50,.82])) peg(x,.36+row*.13);
    }
    for (let y=0;y<this.ny;y++) for (let x=0;x<this.nx;x++) {
      this.solid[x+y*this.nx] = (x===0||y===0||x===this.nx-1||y===this.ny-1||this.inside(x+.5,y+.5)) ? 1 : 0;
    }
  }
  distance(x,y,s) {
    const dx=s.x2-s.x1, dy=s.y2-s.y1;
    const t=clamp(((x-s.x1)*dx+(y-s.y1)*dy)/(dx*dx+dy*dy||1),0,1);
    return Math.hypot(x-s.x1-t*dx,y-s.y1-t*dy)-s.r;
  }
  inside(x,y,pad=0) { return this.shapes.some(s => this.distance(x,y,s)<pad); }
  seed(fill) {
    this.count=0; this.fill=fill;
    const dx=.55, dy=dx*Math.sqrt(3)/2;
    const target=Math.floor((this.nx-2)*(this.ny-2)*fill/(dx*dy));
    // Bottle starts at rest; courses pour from above.
    for(let row=0,y=1.3;y<this.ny-1.3 && this.count<target;row++,y+=dy) {
      for(let x=1.3+(row%2)*dx/2;x<this.nx-1.3 && this.count<target;x+=dx) {
        const py=this.level==='bottle'?this.ny-y:y;
        if(this.inside(x,py,this.radius+.05)) continue;
        const i=this.count++; this.x[i]=x; this.y[i]=py;
        this.vx[i]=0; this.vy[i]=0;
      }
    }
    this.transfer(true); this.updateDensity();
  }
  collide(i) {
    const r=this.radius, nx=this.nx, ny=this.ny;
    let x=this.x[i],y=this.y[i],vx=this.vx[i],vy=this.vy[i];
    for(const s of this.shapes) {
      const dx=s.x2-s.x1,dy=s.y2-s.y1;
      const t=clamp(((x-s.x1)*dx+(y-s.y1)*dy)/(dx*dx+dy*dy||1),0,1);
      let ax=x-s.x1-t*dx,ay=y-s.y1-t*dy, d=Math.hypot(ax,ay), min=s.r+r;
      if(d<min) {
        if(d<1e-7){ax=-dy;ay=dx||1;d=Math.hypot(ax,ay);}
        const ux=ax/d,uy=ay/d;
        x=s.x1+t*dx+ux*min; y=s.y1+t*dy+uy*min;
        const vn=vx*ux+vy*uy;
        if(vn<0){vx-=vn*ux;vy-=vn*uy;}
      }
    }
    if(x<1+r){x=1+r;vx=Math.max(0,vx);}
    if(x>nx-1-r){x=nx-1-r;vx=Math.min(0,vx);}
    if(y<1+r){y=1+r;vy=Math.max(0,vy);}
    if(y>ny-1-r){y=ny-1-r;vy=Math.min(0,vy);}
    this.x[i]=x;this.y[i]=y;this.vx[i]=vx;this.vy[i]=vy;
  }
  separate() {
    const {head,next,hashWidth:hw,x,y,count}=this;
    head.fill(-1);
    for(let i=0;i<count;i++) {
      const k=clamp(Math.floor(x[i]/.6),0,hw-1)+clamp(Math.floor(y[i]/.6),0,this.hashHeight-1)*hw;
      next[i]=head[k];head[k]=i;
    }
    const min=this.radius*2,min2=min*min;
    for(let i=0;i<count;i++) {
      const bx=Math.floor(x[i]/.6),by=Math.floor(y[i]/.6);
      // Hash cells exceed particle diameter; visit the 3 × 3 neighbourhood.
      for(let yy=Math.max(0,by-1);yy<=Math.min(this.hashHeight-1,by+1);yy++) {
        for(let xx=Math.max(0,bx-1);xx<=Math.min(hw-1,bx+1);xx++) {
          for(let j=head[xx+yy*hw];j!==-1;j=next[j]) {
            if(j<=i)continue;
            const dx=x[j]-x[i],dy=y[j]-y[i],d2=dx*dx+dy*dy;
            if(d2<min2&&d2>1e-12) {
              const d=Math.sqrt(d2),s=(min-d)*.48/d;
              x[i]-=dx*s;y[i]-=dy*s;x[j]+=dx*s;y[j]+=dy*s;
            }
          }
        }
      }
    }
  }
  transfer(toGrid, blend=.96) {
    const {nx,ny,size,type,solid,count}=this;
    if(toGrid) {
      this.u.fill(0);this.v.fill(0);this.wu.fill(0);this.wv.fill(0);
      for(let i=0;i<size;i++)type[i]=solid[i]?2:0;
      for(let i=0;i<count;i++) {
        const k=Math.floor(this.x[i])+Math.floor(this.y[i])*nx;
        if(!solid[k])type[k]=1;
      }
      this.activeCount=0;
      for(let i=0;i<size;i++)if(type[i]===1)this.active[this.activeCount++]=i;
    }
    for(let c=0;c<2;c++) {
      const f=c?this.v:this.u,prev=c?this.oldV:this.oldU,weights=c?this.wv:this.wu;
      const vel=c?this.vy:this.vx,offset=c?nx:1;
      for(let i=0;i<count;i++) {
        const x=clamp(this.x[i]-(c?.5:0),.001,nx-1.001);
        const y=clamp(this.y[i]-(c?0:.5),.001,ny-1.001);
        const ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;
        const a=ix+iy*nx,b=a+1,d=a+nx,e=d+1;
        let wa=(1-tx)*(1-ty),wb=tx*(1-ty),wd=(1-tx)*ty,we=tx*ty;
        if(toGrid) {
          const v=vel[i];
          f[a]+=v*wa;weights[a]+=wa;f[b]+=v*wb;weights[b]+=wb;
          f[d]+=v*wd;weights[d]+=wd;f[e]+=v*we;weights[e]+=we;
        } else {
          if(type[a]===0&&type[a-offset]===0)wa=0;
          if(type[b]===0&&type[b-offset]===0)wb=0;
          if(type[d]===0&&type[d-offset]===0)wd=0;
          if(type[e]===0&&type[e-offset]===0)we=0;
          const w=wa+wb+wd+we;
          if(w>1e-7) {
            const pic=(wa*f[a]+wb*f[b]+wd*f[d]+we*f[e])/w;
            const delta=(wa*(f[a]-prev[a])+wb*(f[b]-prev[b])+wd*(f[d]-prev[d])+we*(f[e]-prev[e]))/w;
            vel[i]=(1-blend)*pic+blend*(vel[i]+delta);
          }
        }
      }
      if(toGrid) {
        for(let i=0;i<size;i++) {
          if(weights[i]>0)f[i]/=weights[i];
          if(solid[i]||solid[i-offset])f[i]=0;
        }
      }
    }
  }
  updateDensity() {
    const {nx,ny,density:d}=this;d.fill(0);
    for(let i=0;i<this.count;i++) {
      const x=clamp(this.x[i]-.5,0,nx-1.001),y=clamp(this.y[i]-.5,0,ny-1.001);
      const ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy,k=ix+iy*nx;
      d[k]+=(1-tx)*(1-ty);d[k+1]+=tx*(1-ty);d[k+nx]+=(1-tx)*ty;d[k+nx+1]+=tx*ty;
    }
  }
  project(dt,gx,gy,iterations=this.iterations) {
    const {u,v,nx,solid:s,active,activeCount,density}=this;
    this.oldU.set(u);this.oldV.set(v);
    for(let i=0;i<this.size;i++){
      if(!s[i]&&!s[i-1]&&(this.type[i]===1||this.type[i-1]===1))u[i]+=gx*this.gravity*dt;
      if(!s[i]&&!s[i-nx]&&(this.type[i]===1||this.type[i-nx]===1))v[i]+=gy*this.gravity*dt;
    }
    // A small, bounded density correction fixes compression without suction.
    for(let iter=0;iter<iterations;iter++) for(let a=0;a<activeCount;a++) {
      const i=active[a],l=1-s[i-1],r=1-s[i+1],t=1-s[i-nx],b=1-s[i+nx],sum=l+r+t+b;
      if(!sum)continue;
      const drift=Math.min(5,Math.max(0,density[i]-this.restDensity)*2.0);
      const divergence=u[i+1]-u[i]+v[i+nx]-v[i]-drift;
      const p=-divergence*1.85/sum;
      u[i]-=l*p;u[i+1]+=r*p;v[i]-=t*p;v[i+nx]+=b*p;
    }
  }
  step(dt,gx,gy,pointer=null) {
    // CFL substeps prevent spray tunnelling through a ramp or tank wall.
    let maxSpeed=0;
    for(let i=0;i<this.count;i++)maxSpeed=Math.max(maxSpeed,Math.hypot(this.vx[i],this.vy[i]));
    const n=clamp(Math.ceil((maxSpeed+Math.hypot(gx,gy)*this.gravity*dt)*dt/.7),1,5),h=dt/n;
    for(let sub=0;sub<n;sub++) {
      const drag=Math.exp(-.08*h);
      for(let i=0;i<this.count;i++) {
        this.vx[i]=this.vx[i]*drag;
        this.vy[i]=this.vy[i]*drag;
        if(pointer) {
          const dx=this.x[i]-pointer.x,dy=this.y[i]-pointer.y,d=Math.hypot(dx,dy),r=4;
          if(d<r) {
            const a=(1-Math.exp(-26*h))*(1-d/r);
            this.vx[i]+=(pointer.vx-this.vx[i])*a;this.vy[i]+=(pointer.vy-this.vy[i])*a;
          }
        }
        // Emergency stability bound, far above normal pouring velocity.
        const speed=Math.hypot(this.vx[i],this.vy[i]),limit=360;
        if(speed>limit){this.vx[i]*=limit/speed;this.vy[i]*=limit/speed;}

      }
      this.transfer(true);this.updateDensity();this.project(h,gx,gy);
      // Time-adjusted blend avoids extra damping when CFL adds substeps.
      this.transfer(false,Math.pow(this.blend,h*120));
      for(let i=0;i<this.count;i++){
        this.x[i]+=this.vx[i]*h;this.y[i]+=this.vy[i]*h;this.collide(i);
      }
      this.separate();
      for(let i=0;i<this.count;i++)this.collide(i);
    }
    this.updateDensity();
  }
}
