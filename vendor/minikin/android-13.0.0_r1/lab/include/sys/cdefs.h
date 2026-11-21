// APK Web Lab: the bionic <sys/cdefs.h> macros the liblog and libutils headers use, for the musl sysroot of Emscripten
// (bionic/libc/include/sys/cdefs.h declares them on a device). Declarations only; no code.
#pragma once
#ifdef __cplusplus
#define __BEGIN_DECLS extern "C" {
#define __END_DECLS }
#else
#define __BEGIN_DECLS
#define __END_DECLS
#endif
#define __INTRODUCED_IN(api_level)
#define __INTRODUCED_IN_32(api_level)
#define __INTRODUCED_IN_64(api_level)
#define __REMOVED_IN(api_level)
#define __DEPRECATED_IN(api_level)
#define __printflike(x, y) __attribute__((__format__(printf, x, y)))
#define __scanflike(x, y) __attribute__((__format__(scanf, x, y)))
#ifndef __unused
#define __unused __attribute__((__unused__))
#endif
#ifndef __predict_true
#define __predict_true(exp) __builtin_expect((exp) != 0, 1)
#define __predict_false(exp) __builtin_expect((exp) != 0, 0)
#endif
#define __ANDROID_API__ 33
