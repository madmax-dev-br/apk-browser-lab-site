// Web ABI adapter only. Boundary rules and iteration execute the unmodified
// ICU4C 70.1 implementation and its original binary data.
#include <unicode/ubrk.h>
#include <unicode/udata.h>
#include <unicode/uclean.h>
#include <unicode/utypes.h>
#include <stdint.h>
extern "C" {
int32_t icu_initialize(const void* data) {
    UErrorCode status = U_ZERO_ERROR;
    udata_setCommonData(data, &status);
    if (U_SUCCESS(status)) u_init(&status);
    return status;
}
int32_t icu_boundaries(const UChar* text, int32_t length, const char* locale,
                       int32_t type, int32_t* offsets, int32_t capacity) {
    if (!text || !offsets || length < 0 || length > 65536 || capacity < length + 1 ||
        type < UBRK_CHARACTER || type > UBRK_SENTENCE) return -U_ILLEGAL_ARGUMENT_ERROR;
    UErrorCode status = U_ZERO_ERROR;
    UBreakIterator* iterator = ubrk_open(static_cast<UBreakIteratorType>(type), locale,
                                         text, length, &status);
    if (U_FAILURE(status) || !iterator) return -static_cast<int32_t>(status ? status : U_INTERNAL_PROGRAM_ERROR);
    int32_t count = 0;
    for (int32_t offset = ubrk_first(iterator); offset != UBRK_DONE; offset = ubrk_next(iterator)) {
        if (count >= capacity) { ubrk_close(iterator); return -U_BUFFER_OVERFLOW_ERROR; }
        offsets[count++] = offset;
    }
    ubrk_close(iterator);
    return count;
}
const char* icu_error_name(int32_t status) { return u_errorName(static_cast<UErrorCode>(status)); }
}

#include <unicode/uregex.h>
namespace {
UErrorCode regexStatus = U_ZERO_ERROR;
UParseError regexParseError;
URegularExpression* expression(uintptr_t pointer) { return reinterpret_cast<URegularExpression*>(pointer); }
void regexBegin() { regexStatus = U_ZERO_ERROR; regexParseError.line = -1; regexParseError.offset = -1; }
void regexLimits(URegularExpression* matcher) {
    // ICU's native processing-step and stack guards, not a JS regex timeout.
    uregex_setTimeLimit(matcher, 1000, &regexStatus);
    uregex_setStackLimit(matcher, 1024 * 1024, &regexStatus);
}
}
extern "C" {
int32_t icu_regex_status() { return regexStatus; }
int32_t icu_regex_error_offset() { return regexParseError.offset; }
int32_t icu_regex_error_line() { return regexParseError.line; }
uintptr_t icu_regex_compile(const UChar* pattern, int32_t length, uint32_t flags) {
    regexBegin();
    if (!pattern || length < 0 || length > 16384) { regexStatus = U_ILLEGAL_ARGUMENT_ERROR; return 0; }
    URegularExpression* result = uregex_open(pattern, length, flags, &regexParseError, &regexStatus);
    if (U_FAILURE(regexStatus)) { if (result) uregex_close(result); return 0; }
    regexLimits(result);
    if (U_FAILURE(regexStatus)) { uregex_close(result); return 0; }
    return reinterpret_cast<uintptr_t>(result);
}
uintptr_t icu_regex_clone(uintptr_t pattern) {
    regexBegin(); URegularExpression* result = uregex_clone(expression(pattern), &regexStatus);
    if (U_FAILURE(regexStatus)) { if (result) uregex_close(result); return 0; }
    regexLimits(result); if (U_FAILURE(regexStatus)) { uregex_close(result); return 0; }
    return reinterpret_cast<uintptr_t>(result);
}
void icu_regex_close(uintptr_t handle) { uregex_close(expression(handle)); }
void icu_regex_input(uintptr_t matcher, const UChar* text, int32_t length, int32_t start, int32_t end) {
    regexBegin(); uregex_setText(expression(matcher), text, length, &regexStatus);
    if (U_SUCCESS(regexStatus)) uregex_setRegion(expression(matcher), start, end, &regexStatus);
}
int32_t icu_regex_find(uintptr_t matcher, int32_t start) { regexBegin(); return uregex_find(expression(matcher), start, &regexStatus); }
int32_t icu_regex_find_next(uintptr_t matcher) { regexBegin(); return uregex_findNext(expression(matcher), &regexStatus); }
int32_t icu_regex_matches(uintptr_t matcher) { regexBegin(); return uregex_matches(expression(matcher), -1, &regexStatus); }
int32_t icu_regex_looking_at(uintptr_t matcher) { regexBegin(); return uregex_lookingAt(expression(matcher), -1, &regexStatus); }
int32_t icu_regex_group_count(uintptr_t matcher) { regexBegin(); return uregex_groupCount(expression(matcher), &regexStatus); }
int32_t icu_regex_groups(uintptr_t matcher, int32_t* offsets, int32_t capacity) {
    regexBegin(); const int32_t groups = uregex_groupCount(expression(matcher), &regexStatus) + 1;
    if (U_FAILURE(regexStatus)) return -1;
    if (groups < 1 || groups > 1025 || capacity < groups * 2) { regexStatus = U_BUFFER_OVERFLOW_ERROR; return -1; }
    for (int32_t i = 0; i < groups && U_SUCCESS(regexStatus); i++) {
        offsets[i * 2] = uregex_start(expression(matcher), i, &regexStatus);
        offsets[i * 2 + 1] = uregex_end(expression(matcher), i, &regexStatus);
    }
    return U_SUCCESS(regexStatus) ? groups * 2 : -1;
}
int32_t icu_regex_named_group(uintptr_t pattern, const UChar* name, int32_t length) { regexBegin(); return uregex_groupNumberFromName(expression(pattern), name, length, &regexStatus); }
int32_t icu_regex_hit_end(uintptr_t matcher) { regexBegin(); return uregex_hitEnd(expression(matcher), &regexStatus); }
int32_t icu_regex_require_end(uintptr_t matcher) { regexBegin(); return uregex_requireEnd(expression(matcher), &regexStatus); }
void icu_regex_anchoring(uintptr_t matcher, int32_t value) { regexBegin(); uregex_useAnchoringBounds(expression(matcher), value != 0, &regexStatus); }
void icu_regex_transparent(uintptr_t matcher, int32_t value) { regexBegin(); uregex_useTransparentBounds(expression(matcher), value != 0, &regexStatus); }
}
