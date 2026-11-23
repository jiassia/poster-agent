// Poster Agent, 2026-11-10. Apache-2.0.
import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
export const PURPOSES=['composition-reference','background','decoration','subject','slot','fragment'];
export const digest=data=>createHash('sha256').update(data).digest('hex');
export const imageError=(code,message,retryable=false)=>Object.assign(new Error(message),{code,retryable});
export function crc32(data) {let c=0xffffffff;for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
// Verify PNG chunks, CRC, dimensions and decoded scanlines, including actual alpha.
// Conservative contract: non-interlaced, 8-bit PNG (the provider requests PNG).
export function inspectPNG(data) {
  const bad=()=>{throw imageError('INVALID_IMAGE','PNG 损坏或不是受支持的 8-bit 非交错 PNG');};
  if(data.length<45||data.length>64*1024*1024||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')bad();
  let header,ended=false;const idat=[];let trns;
  for(let at=8;at<data.length;) {
    if(at+12>data.length)bad();const n=data.readUInt32BE(at),end=at+n+12;
    if(end>data.length)bad();const type=data.toString('ascii',at+4,at+8),part=data.subarray(at+8,end-4);
    if(crc32(data.subarray(at+4,end-4))!==data.readUInt32BE(end-4))bad();
    if(!header&&type!=='IHDR')bad();
    if(type==='IHDR'){if(header||n!==13)bad();header=part;}
    if(type==='IDAT')idat.push(part);if(type==='tRNS')trns=part;
    at=end;if(type==='IEND'){ended=true;if(at!==data.length)bad();break;}
  }
  if(!header||!ended||!idat.length)bad();
  const width=header.readUInt32BE(0),height=header.readUInt32BE(4),color=header[9],channels=({0:1,2:3,3:1,4:2,6:4})[color];
  if(!width||!height||width*height>8294400||!channels||header[8]!==8||header[10]||header[11]||header[12])bad();
  const stride=width*channels;let raw;try{raw=inflateSync(Buffer.concat(idat),{maxOutputLength:(stride+1)*height});}catch{bad();}
  if(raw.length!==(stride+1)*height)bad();
  let prev=Buffer.alloc(stride),hasTransparency=false;
  const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
  for(let y=0;y<height;y++) {
    const filter=raw[y*(stride+1)];if(filter>4)bad();const row=Buffer.from(raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)));
    for(let i=0;i<stride;i++){const a=i>=channels?row[i-channels]:0,b=prev[i],c=i>=channels?prev[i-channels]:0;row[i]=(row[i]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;}
    for(let x=0;x<width&&!hasTransparency;x++) {
      const i=x*channels;
      hasTransparency=(color===6&&row[i+3]<255)||(color===4&&row[i+1]<255)||(color===3&&trns&&row[i]<trns.length&&trns[row[i]]<255)||(color===0&&trns?.length===2&&row[i]===trns.readUInt16BE())||(color===2&&trns?.length===6&&row[i]===trns.readUInt16BE(0)&&row[i+1]===trns.readUInt16BE(2)&&row[i+2]===trns.readUInt16BE(4));
    }
    prev=row;
  }
  return {width,height,hasTransparency:Boolean(hasTransparency),sha256:digest(data)};
}
