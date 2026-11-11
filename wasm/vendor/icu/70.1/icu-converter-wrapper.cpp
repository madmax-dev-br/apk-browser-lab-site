// Web ABI adapter for the converter half of libcore's com.android.icu.charset.NativeConverter (external/icu android-13.0.0_r1,
// android_icu4j/libcore_bridge/src/native/com_android_icu_charset_NativeConverter.cpp). The conversion itself is the unmodified ICU4C 70.1 ucnv
// implementation; the callback tables (REPORT / IGNORE / REPLACE) and the offset/invalid-length bookkeeping below are that file's logic with the JNI array
// access replaced by plain buffers. Licence of the ported logic: Apache-2.0 (The Android Open Source Project); ICU: Unicode-3.0 / ICU licence.
#include <unicode/ucnv.h>
#include <unicode/ucnv_cb.h>
#include <unicode/udata.h>
#include <unicode/uclean.h>
#include <unicode/utypes.h>
#include <unicode/ustring.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>

#define NativeConverter_REPORT 0
#define NativeConverter_IGNORE 1
#define NativeConverter_REPLACE 2
#define MAX_REPLACEMENT_LENGTH 32

struct DecoderCallbackContext {
    UChar replacementChars[MAX_REPLACEMENT_LENGTH];
    size_t replacementCharCount;
    UConverterToUCallback onUnmappableInput;
    UConverterToUCallback onMalformedInput;
};
struct EncoderCallbackContext {
    char replacementBytes[MAX_REPLACEMENT_LENGTH];
    size_t replacementByteCount;
    UConverterFromUCallback onUnmappableInput;
    UConverterFromUCallback onMalformedInput;
};

static UConverter* toUConverter(uintptr_t address) { return reinterpret_cast<UConverter*>(address); }
static bool shouldCodecThrow(int32_t flush, UErrorCode error) {
    if (flush) return (error != U_BUFFER_OVERFLOW_ERROR && error != U_TRUNCATED_CHAR_FOUND);
    return (error != U_BUFFER_OVERFLOW_ERROR && error != U_INVALID_CHAR_FOUND && error != U_ILLEGAL_CHAR_FOUND);
}

static void encoderReplaceCallback(const void* rawContext, UConverterFromUnicodeArgs* fromArgs, const UChar*, int32_t, UChar32, UConverterCallbackReason, UErrorCode* err) {
    if (rawContext == NULL) return;
    const EncoderCallbackContext* context = reinterpret_cast<const EncoderCallbackContext*>(rawContext);
    *err = U_ZERO_ERROR;
    ucnv_cbFromUWriteBytes(fromArgs, context->replacementBytes, context->replacementByteCount, 0, err);
}
static UConverterFromUCallback getFromUCallback(int32_t mode) {
    switch (mode) {
    case NativeConverter_IGNORE: return UCNV_FROM_U_CALLBACK_SKIP;
    case NativeConverter_REPLACE: return encoderReplaceCallback;
    case NativeConverter_REPORT: return UCNV_FROM_U_CALLBACK_STOP;
    }
    abort();
}
static void CHARSET_ENCODER_CALLBACK(const void* rawContext, UConverterFromUnicodeArgs* args, const UChar* codeUnits, int32_t length, UChar32 codePoint, UConverterCallbackReason reason, UErrorCode* status) {
    if (!rawContext) return;
    const EncoderCallbackContext* ctx = reinterpret_cast<const EncoderCallbackContext*>(rawContext);
    switch (reason) {
    case UCNV_UNASSIGNED: ctx->onUnmappableInput(ctx, args, codeUnits, length, codePoint, reason, status); return;
    case UCNV_ILLEGAL:
    case UCNV_IRREGULAR: ctx->onMalformedInput(ctx, args, codeUnits, length, codePoint, reason, status); return;
    case UCNV_CLOSE: delete ctx; return;
    default: *status = U_ILLEGAL_ARGUMENT_ERROR; return;
    }
}
static void decoderIgnoreCallback(const void*, UConverterToUnicodeArgs*, const char*, int32_t, UConverterCallbackReason, UErrorCode* err) { *err = U_ZERO_ERROR; }
static void decoderReplaceCallback(const void* rawContext, UConverterToUnicodeArgs* toArgs, const char*, int32_t, UConverterCallbackReason, UErrorCode* err) {
    if (!rawContext) return;
    const DecoderCallbackContext* context = reinterpret_cast<const DecoderCallbackContext*>(rawContext);
    *err = U_ZERO_ERROR;
    ucnv_cbToUWriteUChars(toArgs, context->replacementChars, context->replacementCharCount, 0, err);
}
static UConverterToUCallback getToUCallback(int32_t mode) {
    switch (mode) {
    case NativeConverter_IGNORE: return decoderIgnoreCallback;
    case NativeConverter_REPLACE: return decoderReplaceCallback;
    case NativeConverter_REPORT: return UCNV_TO_U_CALLBACK_STOP;
    }
    abort();
}
static void CHARSET_DECODER_CALLBACK(const void* rawContext, UConverterToUnicodeArgs* args, const char* codeUnits, int32_t length, UConverterCallbackReason reason, UErrorCode* status) {
    if (!rawContext) return;
    const DecoderCallbackContext* ctx = reinterpret_cast<const DecoderCallbackContext*>(rawContext);
    switch (reason) {
    case UCNV_UNASSIGNED: ctx->onUnmappableInput(ctx, args, codeUnits, length, reason, status); return;
    case UCNV_ILLEGAL:
    case UCNV_IRREGULAR: ctx->onMalformedInput(ctx, args, codeUnits, length, reason, status); return;
    case UCNV_CLOSE: delete ctx; return;
    default: *status = U_ILLEGAL_ARGUMENT_ERROR; return;
    }
}

extern "C" {
int32_t icu_cnv_initialize(const void* data) {
    UErrorCode status = U_ZERO_ERROR;
    udata_setCommonData(data, &status);
    if (U_SUCCESS(status)) u_init(&status);
    return status;
}
const char* icu_cnv_error_name(int32_t status) { return u_errorName(static_cast<UErrorCode>(status)); }
// ucnv_open; returns 0 and sets *status on failure
uintptr_t icu_cnv_open(const char* name, int32_t* status) {
    UErrorCode error = U_ZERO_ERROR;
    UConverter* cnv = ucnv_open(name, &error);
    *status = error;
    return U_SUCCESS(error) ? reinterpret_cast<uintptr_t>(cnv) : 0;
}
void icu_cnv_close(uintptr_t address) { ucnv_close(toUConverter(address)); }
void icu_cnv_reset_to_unicode(uintptr_t address) { UConverter* cnv = toUConverter(address); if (cnv) ucnv_resetToUnicode(cnv); }
void icu_cnv_reset_from_unicode(uintptr_t address) { UConverter* cnv = toUConverter(address); if (cnv) ucnv_resetFromUnicode(cnv); }
int32_t icu_cnv_max_char_size(uintptr_t address) { UConverter* cnv = toUConverter(address); return cnv ? ucnv_getMaxCharSize(cnv) : -1; }
int32_t icu_cnv_min_char_size(uintptr_t address) { UConverter* cnv = toUConverter(address); return cnv ? ucnv_getMinCharSize(cnv) : -1; }
// NativeConverter_encode: data[0] = start of input (in) / chars consumed (out), data[1] = start of output (in) / bytes written (out), data[2] = invalid char count.
int32_t icu_cnv_encode(uintptr_t address, const UChar* source, int32_t sourceEnd, char* target, int32_t targetEnd, int32_t* data, int32_t flush, int32_t* shouldThrow) {
    UConverter* cnv = toUConverter(address);
    int32_t* sourceOffset = &data[0]; int32_t* targetOffset = &data[1];
    const UChar* mySource = source + *sourceOffset;
    const UChar* mySourceLimit = source + sourceEnd;
    char* cTarget = target + *targetOffset;
    const char* cTargetLimit = target + targetEnd;
    UErrorCode errorCode = U_ZERO_ERROR;
    ucnv_fromUnicode(cnv, &cTarget, cTargetLimit, &mySource, mySourceLimit, NULL, (UBool) flush, &errorCode);
    *sourceOffset = (mySource - source) - *sourceOffset;
    *targetOffset = (cTarget - target);
    if (errorCode == U_ILLEGAL_CHAR_FOUND || errorCode == U_INVALID_CHAR_FOUND || errorCode == U_TRUNCATED_CHAR_FOUND) {
        int8_t invalidUCharCount = 32; UChar invalidUChars[32]; UErrorCode minorErrorCode = U_ZERO_ERROR;
        ucnv_getInvalidUChars(cnv, invalidUChars, &invalidUCharCount, &minorErrorCode);
        if (U_SUCCESS(minorErrorCode)) data[2] = invalidUCharCount;
    }
    *shouldThrow = shouldCodecThrow(flush, errorCode) ? 1 : 0;
    return errorCode;
}
// NativeConverter_decode: data[0] = start of input / bytes consumed, data[1] = start of output / chars written, data[2] = invalid byte count.
int32_t icu_cnv_decode(uintptr_t address, const char* source, int32_t sourceEnd, UChar* target, int32_t targetEnd, int32_t* data, int32_t flush, int32_t* shouldThrow) {
    UConverter* cnv = toUConverter(address);
    int32_t* sourceOffset = &data[0]; int32_t* targetOffset = &data[1];
    const char* mySource = source + *sourceOffset;
    const char* mySourceLimit = source + sourceEnd;
    UChar* cTarget = target + *targetOffset;
    const UChar* cTargetLimit = target + targetEnd;
    UErrorCode errorCode = U_ZERO_ERROR;
    ucnv_toUnicode(cnv, &cTarget, cTargetLimit, &mySource, mySourceLimit, NULL, flush, &errorCode);
    *sourceOffset = mySource - source - *sourceOffset;
    *targetOffset = cTarget - target - *targetOffset;
    if (errorCode == U_ILLEGAL_CHAR_FOUND || errorCode == U_INVALID_CHAR_FOUND || errorCode == U_TRUNCATED_CHAR_FOUND) {
        int8_t invalidByteCount = 32; char invalidBytes[32] = {'\0'}; UErrorCode minorErrorCode = U_ZERO_ERROR;
        ucnv_getInvalidChars(cnv, invalidBytes, &invalidByteCount, &minorErrorCode);
        if (U_SUCCESS(minorErrorCode)) data[2] = invalidByteCount;
    }
    *shouldThrow = shouldCodecThrow(flush, errorCode) ? 1 : 0;
    return errorCode;
}
int32_t icu_cnv_set_callback_decode(uintptr_t address, int32_t onMalformedInput, int32_t onUnmappableInput, const UChar* replacement, int32_t replacementLength) {
    UConverter* cnv = toUConverter(address);
    UConverterToUCallback oldCallback; const void* oldCallbackContext;
    ucnv_getToUCallBack(cnv, &oldCallback, &oldCallbackContext);
    DecoderCallbackContext* callbackContext = const_cast<DecoderCallbackContext*>(reinterpret_cast<const DecoderCallbackContext*>(oldCallbackContext));
    bool created = false;
    if (callbackContext == NULL) { callbackContext = new DecoderCallbackContext; created = true; }
    callbackContext->onMalformedInput = getToUCallback(onMalformedInput);
    callbackContext->onUnmappableInput = getToUCallback(onUnmappableInput);
    if (replacementLength < 0 || (size_t) replacementLength > MAX_REPLACEMENT_LENGTH) { if (created) delete callbackContext; return U_ILLEGAL_ARGUMENT_ERROR; }
    u_strncpy(callbackContext->replacementChars, replacement, replacementLength);
    callbackContext->replacementCharCount = replacementLength;
    UErrorCode errorCode = U_ZERO_ERROR;
    ucnv_setToUCallBack(cnv, CHARSET_DECODER_CALLBACK, callbackContext, NULL, NULL, &errorCode);
    return errorCode;
}
int32_t icu_cnv_set_callback_encode(uintptr_t address, int32_t onMalformedInput, int32_t onUnmappableInput, const char* replacement, int32_t replacementLength) {
    UConverter* cnv = toUConverter(address);
    UConverterFromUCallback oldCallback = NULL; const void* oldCallbackContext = NULL;
    ucnv_getFromUCallBack(cnv, &oldCallback, const_cast<const void**>(&oldCallbackContext));
    EncoderCallbackContext* callbackContext = const_cast<EncoderCallbackContext*>(reinterpret_cast<const EncoderCallbackContext*>(oldCallbackContext));
    bool created = false;
    if (callbackContext == NULL) { callbackContext = new EncoderCallbackContext; created = true; }
    callbackContext->onMalformedInput = getFromUCallback(onMalformedInput);
    callbackContext->onUnmappableInput = getFromUCallback(onUnmappableInput);
    if (replacementLength < 0 || (size_t) replacementLength > MAX_REPLACEMENT_LENGTH) { if (created) delete callbackContext; return U_ILLEGAL_ARGUMENT_ERROR; }
    memcpy(callbackContext->replacementBytes, replacement, replacementLength);
    callbackContext->replacementByteCount = replacementLength;
    UErrorCode errorCode = U_ZERO_ERROR;
    ucnv_setFromUCallBack(cnv, CHARSET_ENCODER_CALLBACK, callbackContext, NULL, NULL, &errorCode);
    return errorCode;
}
// ucnv_getSubstChars into out[MAX_REPLACEMENT_LENGTH]; returns the length or -1 on failure
int32_t icu_cnv_subst_chars(uintptr_t address, char* out) {
    UConverter* cnv = toUConverter(address); UErrorCode status = U_ZERO_ERROR; int8_t len = MAX_REPLACEMENT_LENGTH;
    ucnv_getSubstChars(cnv, out, &len, &status);
    return U_SUCCESS(status) ? len : -1;
}
}
