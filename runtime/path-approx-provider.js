import { APKError } from './apk-runtime.js?v=f2127a72f766';
const LIMIT=1024*1024;
const defaultAssetURL=()=>new URL('../framework-aosp/native-path-approx/path-approx.wasm'+new URL(import.meta.url).search,import.meta.url);
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
async function read(fetchImpl,url){
 if(new URL(url).protocol==='file:'&&typeof process==='object'&&process.versions?.node){const{readFile}=await import('node:fs/promises');const data=new Uint8Array(await readFile(url));if(data.length>LIMIT)throw new APKError('AOSP Path asset exceeds 1 MiB');return data;}
 if(typeof fetchImpl!=='function')throw new APKError('AOSP Path assets require static fetch or injected bytes');
 const response=await fetchImpl(url);if(!response.ok)throw new APKError('AOSP Path asset HTTP '+response.status);if(Number(response.headers?.get('content-length'))>LIMIT)throw new APKError('AOSP Path asset exceeds 1 MiB');
 if(!response.body?.getReader){const data=new Uint8Array(await response.arrayBuffer());if(data.length>LIMIT)throw new APKError('AOSP Path asset exceeds 1 MiB');return data;}
 const reader=response.body.getReader(),chunks=[];let size=0;while(true){const{value,done}=await reader.read();if(done)break;size+=value.length;if(size>LIMIT){await reader.cancel();throw new APKError('AOSP Path asset exceeds 1 MiB');}chunks.push(value);}const data=new Uint8Array(size);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length;}return data;
}
/** Original Android Path.cpp Bezier approximation running as C++ Wasm, without JNI/syscalls. */
export class PathApproxProvider{
 constructor({bytes=null,metadata=null,url=defaultAssetURL(),provenanceURL=new URL('provenance.json'+new URL(url).search,url),fetchImpl=globalThis.fetch}={}){this.bytes=bytes;this.metadata=metadata;this.url=url;this.provenanceURL=provenanceURL;this.fetch=typeof fetchImpl==='function'?fetchImpl.bind(globalThis):null;this.pending=null;}
 load(){return this.pending??=this.loadOnce().catch(error=>{this.pending=null;throw error;});}
 async loadOnce(){
  if(!globalThis.crypto?.subtle)throw new APKError('AOSP Path Wasm integrity requires Web Crypto');
  const metadata=this.metadata??JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await read(this.fetch,this.provenanceURL))),bytes=this.bytes?new Uint8Array(this.bytes):await read(this.fetch,this.url);
  if(metadata.source!=='original-AOSP-Path-approximation-C++/Skia-point-math'||bytes.length>LIMIT||bytes.length!==metadata.bytes||await digest(bytes)!==metadata.sha256)throw new APKError('AOSP Path approximation integrity mismatch');
  const module=await WebAssembly.compile(bytes);if(WebAssembly.Module.imports(module).length)throw new APKError('AOSP Path approximation requires an import-free Wasm module');const instance=await WebAssembly.instantiate(module,{}),api=instance.exports;api._initialize?.();
  if(!(api.memory instanceof WebAssembly.Memory)||api.memory.buffer.byteLength!==metadata.memoryBytes||!['path_input','path_output','path_approximate'].every(name=>typeof api[name]==='function'))throw new APKError('Invalid AOSP Path Wasm interface');
  let calls=0;
  return {metadata:{...metadata,enabled:true,backend:'original-AOSP-C++/standalone-Wasm',imports:[]},stats:()=>({calls}),approximate(commands,error){
   if(!(commands instanceof Float32Array)&&!Array.isArray(commands))throw new APKError('Path approximation requires Skia float commands');if(commands.length>65536||commands.some(n=>!Number.isFinite(n)||!Number.isFinite(Math.fround(n))))throw new APKError('Path approximation commands exceed bounded finite geometry');
   if(error<0)throw new APKError('Negative Path approximation error must be rejected by the Java boundary');
   const input=api.path_input(),output=api.path_output(),memory=api.memory.buffer;if(input<0||output<0||input%4||output%4||input+commands.length*4>memory.byteLength||output+1200000>memory.byteLength)throw new APKError('AOSP Path Wasm transport bounds error');new Float32Array(memory,input,commands.length).set(commands);
   let count;calls++;try{count=api.path_approximate(commands.length,error);}catch(cause){throw new APKError('AOSP Path approximation exceeded its fixed native memory/stack limit',{kind:'path-approx-native-limit',cause:String(cause)});}
   if(count<0)throw new APKError(count===-3?'Conic Path approximation requires the original Skia conic converter; this backend supports move/line/quad/cubic/close':`AOSP Path approximation safety guard (${count}): refinement/geometry exceeds bounded backend`,{kind:'path-approx-native-limit',nativeStatus:count});
   if(count>300000||count%3)throw new APKError('Invalid AOSP Path approximation output size');return new Float32Array(memory,output,count).slice();
  }};
 }
}
