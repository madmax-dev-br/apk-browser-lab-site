/* Classic Worker: the verified official Emscripten script uses importScripts. */
self.onmessage = async event => {
  if (event.data?.type !== 'run-public-proof') return;
  try {
    const { HermesProofProvider } = await import('./hermes-provider.js');
    const provider = new HermesProofProvider();
    self.postMessage({ type: 'progress', message: 'Verificando e inicializando a VM Hermes oficial…' });
    const [engine, bytecode] = await Promise.all([provider.load(), provider.verifiedAsset('public-proof.hbc')]);
    const started = performance.now(), result = engine.runBytecode(bytecode);
    self.postMessage({ type: 'result', result: { ...result, ...engine.metadata, elapsedMs: Math.round(performance.now() - started) } });
  } catch (error) {
    self.postMessage({ type: 'error', error: { name: error.name, message: error.message } });
  }
};
