# Public Hermes HBC96 → Wasm proof

Open `hermes-proof/index.html` from a local HTTP origin. The page loads a dedicated classic Worker, verifies the shipped JavaScript/Wasm/HBC SHA-256 hashes, then executes `public-proof.hbc` in the **original Hermes C++ VM**. Expected output: `sumSquares: 87`, `closure: 42`, `caught: "source-catch"`.

Hermes source: [official v0.13.0](https://github.com/facebook/hermes/tree/v0.13.0), commit `4b3bf912cc0f705b51b71ce1a5b8bd79b93a451b`. This version declares HBC96. `official-source.zip` contains the unchanged source tree and its original third-party licenses. The VM algorithms have no patches. `provenance.json` records compiler, build settings and artifact hashes; `LICENSE` and `NOTICE` describe attribution.

Rebuild from the repository root with CMake, Ninja, Emscripten3.1.74 and the platform C++ compiler available:

```sh
export EMSDK="/path/to/emsdk"
export CMAKE="/path/to/cmake"
export NINJA="/path/to/ninja"
python3 scripts/build-hermes-proof.py
node --test tests/hermes-proof.test.mjs
```

The native `hermesc` build is a development compiler for the public fixture; browser execution uses only JavaScript and WebAssembly. `runBytecode` writes input to the Emscripten **memory** filesystem and unlinks it after execution. No computer filesystem is mounted, and no Java/Android/native-module/network bridge is installed. The page terminates its Worker after 30 seconds. Wasm memory starts at16MiB and is capped at256MiB; the C++ stack is1MiB. `wasm-interface.json` records all37 imports and their original glue functions (MEMFS, clock/timezone/timers, WebCrypto randomness, browser collation). No socket/network imports exist.

This is an experimental engine proof, not a complete React Native APK runtime. The upstream v0.13.0 Emscripten Unicode port has unfinished casing/normalization/date-format paths; they are documented limitations, not compatibility guarantees. React Native still needs its actual module configuration, asynchronous/synchronous method bridge, callbacks, scheduler and UI mounting. No empty module configuration or generic JNI success is supplied.

Only the project-created public source and HBC fixture are redistributed. No private application's APK, bundle, native libraries or extracted code is present.
