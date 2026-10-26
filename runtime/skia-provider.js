import {APKError} from './apk-runtime.js?v=8749e43f476b';
import {PathApproxProvider} from './path-approx-provider.js?v=8749e43f476b';
import {createSkiaCanvasHost,rasterizeSkiaCanvas,measureSkiaText} from './skia-canvas-host.js?v=8749e43f476b';
const MAX_WASM=16*1024*1024,MAX_FONT=4*1024*1024,MAX_MODULE=1024*1024;
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
async function read(fetchImpl,url,limit){
 if(new URL(url).protocol==='file:'&&typeof process==='object'&&process.versions?.node){const{readFile}=await import('node:fs/promises');const bytes=new Uint8Array(await readFile(url));if(bytes.length>limit)throw new APKError('Skia asset exceeds VM limit');return bytes;}
 if(typeof fetchImpl!=='function')throw new APKError('Skia assets require a fetch implementation');
 const response=await fetchImpl(url);if(!response.ok)throw new APKError(`Skia asset HTTP ${response.status}: ${url}`);if(Number(response.headers?.get('content-length'))>limit)throw new APKError('Skia asset exceeds VM limit');
 if(!response.body?.getReader){const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>limit)throw new APKError('Skia asset exceeds VM limit');return bytes;}
 const reader=response.body.getReader(),chunks=[];let count=0;while(true){const{value,done}=await reader.read();if(done)break;count+=value.length;if(count>limit){await reader.cancel();throw new APKError('Skia asset exceeds VM limit');}chunks.push(value);}const result=new Uint8Array(count);let at=0;for(const b of chunks){result.set(b,at);at+=b.length;}return result;
}
/** Official, pinned Skia CPU backend. Initialization is async; every drawing call is synchronous. */
export class SkiaProvider{
 constructor({baseURL=new URL('../vendor/canvaskit/0.42.0/',import.meta.url),metadata=null,wasmBytes=null,fontBytes=null,moduleBytes=null,fetchImpl=globalThis.fetch,initialize=null,pathApproxProvider=null}={}){
  this.baseURL=baseURL;this.metadata=metadata;this.wasmBytes=wasmBytes;this.fontBytes=fontBytes;this.moduleBytes=moduleBytes;this.fetch=typeof fetchImpl==='function'?fetchImpl.bind(globalThis):null;this.initialize=initialize;this.pathApproxProvider=pathApproxProvider;this.pending=null;
 }
 load({onProgress=null}={}){return this.pending??=this.loadOnce(onProgress).catch(error=>{this.pending=null;throw error;});}
 async loadOnce(onProgress){
  await onProgress?.({phase:'skia',completed:0,total:3,message:'Loading official Skia CPU WebAssembly'});
  const metadata=this.metadata??JSON.parse(new TextDecoder().decode(await read(this.fetch,new URL('provenance.json',this.baseURL),1024*1024)));
  if(metadata.package!=='canvaskit-wasm'||metadata.version!=='0.42.0')throw new APKError('Unexpected pinned Skia package metadata');
  if(!globalThis.crypto?.subtle)throw new APKError('Pinned Skia asset integrity requires Web Crypto');
  const fonts=metadata.fonts??[{file:'Roboto-Regular.ttf',family:'Roboto',style:0,weight:400,italic:false}];if(fonts.length>12||fonts.some(f=>!/^Roboto-[A-Za-z]+\.ttf$/.test(f.file)))throw new APKError('Invalid pinned font manifest');
  const assets={};let totalFontBytes=0;
  for(const[name,injected,limit]of [['canvaskit.wasm',this.wasmBytes,MAX_WASM],['canvaskit.mjs',this.moduleBytes,MAX_MODULE],...fonts.map(f=>[f.file,f.file==='Roboto-Regular.ttf'?this.fontBytes:null,MAX_FONT])]){
   const bytes=injected?new Uint8Array(injected):await read(this.fetch,new URL(name,this.baseURL),limit);
   if(bytes.length>limit||bytes.length!==metadata.files[name]?.bytes||await hash(bytes)!==metadata.files[name]?.sha256)throw new APKError(`Pinned Skia asset integrity mismatch: ${name}`);
   assets[name]=bytes;if(name.endsWith('.ttf')){totalFontBytes+=bytes.length;if(totalFontBytes>16*1024*1024)throw new APKError('Pinned font data exceeds16MiB');}
  }
  await onProgress?.({phase:'skia',completed:1,total:3,message:'Initializing Skia CPU rasterizer'});
  const init=this.initialize??(await import(new URL('canvaskit.mjs',this.baseURL).href)).default;
  // CanvasKit0.42 deliberately accepts locateFile, not wasmBinary/instantiateWasm.
  // Browser Workers execute the verified bytes via a Blob URL rather than fetching
  // a location inferred from apk-worker.js. Node's official loader uses fs paths.
  const node=typeof globalThis.process==='object'&&!!globalThis.process.versions?.node;
  let wasmURL,revoke=false;
  if(node){const {fileURLToPath}=await import('node:url');wasmURL=fileURLToPath(new URL('canvaskit.wasm',this.baseURL));}
  else{wasmURL=URL.createObjectURL(new Blob([assets['canvaskit.wasm']],{type:'application/wasm'}));revoke=true;}
  let CK;
  try{CK=await init({locateFile:name=>name==='canvaskit.wasm'?wasmURL:new URL(name,this.baseURL).href});}
  finally{if(revoke)URL.revokeObjectURL(wasmURL);}
  const typeface=CK.Typeface.MakeFreeTypeFaceFromData(assets['Roboto-Regular.ttf']);if(!typeface)throw new APKError('Original Roboto font could not be decoded by Skia');
  const fontManager=CK.FontMgr.FromData(...fonts.map(f=>assets[f.file]));if(!fontManager)throw new APKError('Skia FontMgr could not parse pinned fonts');
  const selectedFaces=new Map([['400:false',typeface]]);
  // Requested weights are resolved by the original Skia FontMgr against the
  // installed, verified faces. This preserves native nearest-style matching;
  // it does not invent a new font file or synthesize a 600-weight outline.
  const selectTypeface=(weight=400,italic=false)=>{if(!Number.isInteger(weight)||weight<0||weight>1000)throw new APKError('Roboto font weight must be0..1000',{kind:'font-unavailable'});const key=weight+':'+italic;if(!selectedFaces.has(key)){const face=fontManager.matchFamilyStyle('Roboto',{weight,width:5,slant:italic?1:0});if(!face)throw new APKError('Skia FontMgr did not find an installed Roboto face');selectedFaces.set(key,face);}return selectedFaces.get(key);};
  const pathApprox=await(this.pathApproxProvider??new PathApproxProvider({fetchImpl:this.fetch})).load();
  const result={pathApprox,CanvasKit:CK,typeface,fontManager,selectTypeface,metadata:{...metadata,enabled:true,backend:'official-Skia-Wasm/CPU-MakeSurface',integrity:'verified-SHA-256',wasmTransport:node?'verified-local-file':'verified-Blob-URL',heapBytes:CK.HEAPU8.buffer.byteLength,font:'Roboto Regular',fontMatching:'original-Skia-FontMgr/nearest-installed-style',domRequired:false,webGLRequired:false,pathApproximation:pathApprox.metadata,textShaping:'simple Latin glyph runs; unsupported shaping/fallback fails explicitly'},createHost:runtime=>createSkiaCanvasHost(runtime,result),measureText:(text,state={})=>measureSkiaText(result,text,state),rasterizeCanvas:(runtime,graphics,receiver,width,height)=>rasterizeSkiaCanvas(runtime,result,graphics,receiver,width,height)};
  await onProgress?.({phase:'skia',completed:3,total:3,message:'Skia CPU rasterizer ready'});return result;
 }
}
