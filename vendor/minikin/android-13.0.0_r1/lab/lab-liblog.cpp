// APK Web Lab: the few liblog entry points Minikin calls (system/logging/liblog declarations, android-13.0.0_r1).
// Debug and info logs are dropped. A fatal assertion (LOG_ALWAYS_FATAL, MINIKIN_ASSERT) keeps its message for the
// JavaScript side (mk_fatal_message) and traps, as abort() ends the process on a device.
#include <cstdarg>
#include <cstdio>
#include <cstring>

#define EXPORT extern "C" __attribute__((used, visibility("default")))

static char gFatal[512];

extern "C" int __android_log_print(int, const char*, const char*, ...) { return 0; }
extern "C" int __android_log_buf_print(int, int, const char*, const char*, ...) { return 0; }
extern "C" int __android_log_write(int, const char*, const char*) { return 0; }
extern "C" int __android_log_error_write(int, const char*, int, const char*, unsigned int) { return 0; }
extern "C" int __android_log_is_loggable(int, const char*, int) { return 0; }
extern "C" [[noreturn]] void __android_log_assert(const char* cond, const char* tag, const char* fmt, ...) {
    int used = snprintf(gFatal, sizeof gFatal, "%s: %s: ", tag ? tag : "minikin", cond ? cond : "assertion");
    if (used < 0) used = 0;
    if (fmt && (size_t)used < sizeof gFatal) {
        va_list args;
        va_start(args, fmt);
        vsnprintf(gFatal + used, sizeof gFatal - used, fmt, args);
        va_end(args);
    }
    __builtin_trap();
}
EXPORT const char* mk_fatal_message() { return gFatal; }
