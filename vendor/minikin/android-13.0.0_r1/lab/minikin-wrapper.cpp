// APK Web Lab adaptor for AOSP Minikin (android-13.0.0_r1) compiled to wasm32.
//
// Minikin, HarfBuzz and ICU run unmodified. This file stands where Android's hwui sits around Minikin:
//  - LabMinikinFont is the MinikinFont of the virtual device, in the place of hwui's MinikinFontSkia
//    (libs/hwui/hwui/MinikinSkia.cpp). The lab's module has no Skia/FreeType, so the metrics Skia would ask
//    FreeType for are computed here from the font tables with HarfBuzz, following FreeType's arithmetic:
//    advances are FreeType's linear advances (FT_DivFix / FT_MulDiv in 16.16 at a 26.6 character size), glyph
//    bounds are the 26.6 control box rounded out to whole pixels, and the font extent is Skia's
//    SkScalerContext_FreeType::generateFontMetrics choice (OS/2 typo metrics when USE_TYPO_METRICS is set,
//    else the hhea values FreeType reports). Hinted advances are not modelled: the lab measures unhinted
//    advances, as measured on a device (see docs/ANDROID-GRAPHICS-NATIVES.md).
//  - lab_paint_prepare is MinikinUtils::prepareMinikinPaint (libs/hwui/hwui/MinikinUtils.cpp) over the flags
//    of hwui's Paint (PaintImpl.cpp applyLegacyFlagsToFont, MinikinSkia.cpp packFontFlags).
//  - the mk_* exports mirror the JNI functions of libs/hwui/jni/text/MeasuredText.cpp and LineBreaker.cpp, and
//    the Paint text measurement of libs/hwui/jni/Paint.cpp (MinikinUtils::measureText / getBounds /
//    getFontExtent), with handles in place of Java longs.
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include <hb.h>
#include <hb-ot.h>
#include <unicode/uclean.h>
#include <unicode/udata.h>

#include <minikin/AndroidLineBreakerHelper.h>
#include <minikin/Font.h>
#include <minikin/FontCollection.h>
#include <minikin/FontFamily.h>
#include <minikin/Layout.h>
#include <minikin/LineBreaker.h>
#include <minikin/LocaleList.h>
#include <minikin/MeasuredText.h>
#include <minikin/Measurement.h>
#include <minikin/MinikinExtent.h>
#include <minikin/MinikinFont.h>
#include <minikin/MinikinPaint.h>
#include <minikin/MinikinRect.h>

#define EXPORT extern "C" __attribute__((used, visibility("default")))

namespace {

// ---- FreeType fixed-point arithmetic (freetype/src/base/ftcalc.c, the 64-bit paths) ----
int32_t ftDivFix(int32_t a, int32_t b) {
    int s = 1;
    uint64_t ua = a < 0 ? (s = -s, (uint64_t)(-(int64_t)a)) : (uint64_t)a;
    uint64_t ub = b < 0 ? (s = -s, (uint64_t)(-(int64_t)b)) : (uint64_t)b;
    uint64_t q = ub > 0 ? ((ua << 16) + (ub >> 1)) / ub : 0x7FFFFFFFUL;
    return s < 0 ? -(int32_t)q : (int32_t)q;
}
int32_t ftMulDiv(int32_t a, int32_t b, int32_t c) {
    int s = 1;
    uint64_t ua = a < 0 ? (s = -s, (uint64_t)(-(int64_t)a)) : (uint64_t)a;
    uint64_t ub = b < 0 ? (s = -s, (uint64_t)(-(int64_t)b)) : (uint64_t)b;
    uint64_t uc = c < 0 ? (s = -s, (uint64_t)(-(int64_t)c)) : (uint64_t)c;
    uint64_t d = uc > 0 ? (ua * ub + (uc >> 1)) / uc : 0x7FFFFFFFUL;
    return s < 0 ? -(int32_t)d : (int32_t)d;
}
int32_t ftMulFix(int32_t a, int32_t b) {   // (a * b + 0x8000) >> 16 with the sign of the product
    int64_t ab = (int64_t)a * (int64_t)b;
    return (int32_t)((ab + 0x8000 + (ab < 0 ? -1 : 0)) >> 16);
}
// SkScalarToFDot6: (SkFDot6)(x * 64), a truncation.
int32_t toFDot6(float x) { return (int32_t)(x * 64); }
int32_t fdot6Floor(int32_t x) { return x >> 6; }
int32_t fdot6Ceil(int32_t x) { return (x + 63) >> 6; }

std::string gLastError;
void setError(const std::string& message) { gLastError = message; }

// The bytes of one font file: shared by every variation instance made from it (Typeface.createFromTypefaceWithVariation, the weights of a variable font).
struct FontData {
    uint8_t* bytes;
    uint32_t size;
    hb_blob_t* blob;
    FontData(uint8_t* b, uint32_t s) : bytes(b), size(s) {
        blob = hb_blob_create(reinterpret_cast<const char*>(bytes), size, HB_MEMORY_MODE_READONLY, nullptr, nullptr);
    }
    ~FontData() { hb_blob_destroy(blob); free(bytes); }
};

uint16_t be16(const uint8_t* p) { return (uint16_t)((p[0] << 8) | p[1]); }
int16_t sbe16(const uint8_t* p) { return (int16_t)be16(p); }

class LabMinikinFont : public minikin::MinikinFont {
public:
    LabMinikinFont(std::shared_ptr<FontData> data, int ttcIndex, std::vector<minikin::FontVariation> axes)
            : mData(std::move(data)), mIndex(ttcIndex), mAxes(std::move(axes)) {
        mFace = hb_face_create(mData->blob, mIndex);
        mUpem = (int32_t)hb_face_get_upem(mFace);
        mFont = hb_font_create(mFace);
        hb_font_set_scale(mFont, mUpem, mUpem);   // font units: the advances / extents are scaled below, as FreeType scales them
        std::vector<hb_variation_t> variations;
        for (const minikin::FontVariation& v : mAxes) variations.push_back({v.axisTag, v.value});
        if (!variations.empty()) hb_font_set_variations(mFont, variations.data(), variations.size());
        readVerticalMetrics();
    }
    ~LabMinikinFont() override { hb_font_destroy(mFont); hb_face_destroy(mFace); }

    float GetHorizontalAdvance(uint32_t glyph, const minikin::MinikinPaint& paint, const minikin::FontFakery&) const override {
        return linearAdvance(hb_font_get_glyph_h_advance(mFont, glyph), paint);
    }
    void GetHorizontalAdvances(uint16_t* glyphs, uint32_t count, const minikin::MinikinPaint& paint, const minikin::FontFakery&, float* out) const override {
        for (uint32_t i = 0; i < count; i++) out[i] = linearAdvance(hb_font_get_glyph_h_advance(mFont, glyphs[i]), paint);
    }
    void GetBounds(minikin::MinikinRect* bounds, uint32_t glyph, const minikin::MinikinPaint& paint, const minikin::FontFakery& fakery) const override {
        hb_glyph_extents_t e;
        if (!hb_font_get_glyph_extents(mFont, glyph, &e) || e.width == 0 || e.height == 0) { *bounds = minikin::MinikinRect(); return; }
        // the outline's control box in 26.6 pixels at FreeType's size (x scaled by scaleX), y up
        const int32_t xScale = ftDivFix(toFDot6(paint.size * paint.scaleX), mUpem), yScale = ftDivFix(toFDot6(paint.size), mUpem);
        int32_t xMin = ftMulFix(e.x_bearing, xScale), xMax = ftMulFix(e.x_bearing + e.width, xScale);
        int32_t yMax = ftMulFix(e.y_bearing, yScale), yMin = ftMulFix(e.y_bearing + e.height, yScale);
        float skew = paint.skewX - (const_cast<minikin::FontFakery&>(fakery).isFakeItalic() ? 0.25f : 0.0f);
        if (skew != 0) {   // the skew matrix applied to the box corners (Skia skews the outline points; the corners bound them)
            const int32_t a = (int32_t)std::lround(skew * yMax), b = (int32_t)std::lround(skew * yMin);
            xMin += std::min(-a, -b); xMax += std::max(-a, -b);
        }
        if (const_cast<minikin::FontFakery&>(fakery).isFakeBold() || (paint.fontFlags & minikin::Embolden_Flag)) {
            // FT_Outline_Embolden as Skia calls it (SkFontHost_FreeType_common emboldenOutline): strength = upem * y_scale / 24, the outline grows by half of it on every side
            const int32_t strength = ftMulFix(mUpem, yScale) / 24;
            xMin -= strength / 2; xMax += strength / 2; yMin -= strength / 2; yMax += strength / 2;
        }
        bounds->mLeft = (float)fdot6Floor(xMin);
        bounds->mTop = (float)-fdot6Ceil(yMax);
        bounds->mRight = (float)fdot6Ceil(xMax);
        bounds->mBottom = (float)-fdot6Floor(yMin);
    }
    void GetFontExtent(minikin::MinikinExtent* extent, const minikin::MinikinPaint& paint, const minikin::FontFakery&) const override {
        extent->ascent = -mAscent / (float)mUpem * paint.size;
        extent->descent = -mDescent / (float)mUpem * paint.size;
    }
    const std::string& GetFontPath() const override { return mPath; }
    const void* GetFontData() const override { return mData->bytes; }
    size_t GetFontSize() const override { return mData->size; }
    int GetFontIndex() const override { return mIndex; }
    const std::vector<minikin::FontVariation>& GetAxes() const override { return mAxes; }
    std::shared_ptr<minikin::MinikinFont> createFontWithVariation(const std::vector<minikin::FontVariation>& variations) const override {
        return std::make_shared<LabMinikinFont>(mData, mIndex, variations);
    }

private:
    float linearAdvance(hb_position_t units, const minikin::MinikinPaint& paint) const {
        // FreeType: x_scale = FT_DivFix(char width 26.6, upem); linearHoriAdvance = FT_MulDiv(units, x_scale, 64) in 16.16 pixels (Skia: SkFT_FixedToScalar)
        const int32_t xScale = ftDivFix(toFDot6(paint.size * paint.scaleX), mUpem);
        return (float)ftMulDiv(units, xScale, 64) / 65536.0f;
    }
    // SkScalerContext_FreeType::generateFontMetrics: OS/2 typo values when fsSelection USE_TYPO_METRICS (bit 7) is set, else FreeType's
    // face->ascender / descender (hhea; OS/2 typo, then win, when hhea has neither), with the MVAR deltas FreeType applies to a variable instance.
    void readVerticalMetrics() {
        hb_blob_t* os2 = hb_face_reference_table(mFace, HB_TAG('O', 'S', '/', '2'));
        hb_blob_t* hhea = hb_face_reference_table(mFace, HB_TAG('h', 'h', 'e', 'a'));
        unsigned osLength = 0, hheaLength = 0;
        const uint8_t* o = reinterpret_cast<const uint8_t*>(hb_blob_get_data(os2, &osLength));
        const uint8_t* h = reinterpret_cast<const uint8_t*>(hb_blob_get_data(hhea, &hheaLength));
        const bool hasOs2 = osLength >= 78, typo = hasOs2 && (be16(o + 62) & (1 << 7));
        float hheaAscent = hheaLength >= 8 ? sbe16(h + 4) : 0, hheaDescent = hheaLength >= 8 ? sbe16(h + 6) : 0;
        float typoAscent = hasOs2 ? sbe16(o + 68) : 0, typoDescent = hasOs2 ? sbe16(o + 70) : 0;
        float winAscent = hasOs2 ? be16(o + 74) : 0, winDescent = hasOs2 ? -(float)be16(o + 76) : 0;
        if (!mAxes.empty()) {
            hheaAscent += hb_ot_metrics_get_variation(mFont, HB_OT_METRICS_TAG_HORIZONTAL_ASCENDER);
            hheaDescent += hb_ot_metrics_get_variation(mFont, HB_OT_METRICS_TAG_HORIZONTAL_DESCENDER);
        }
        if (typo) { mAscent = typoAscent; mDescent = typoDescent; }
        else if (hheaAscent != 0 || hheaDescent != 0) { mAscent = hheaAscent; mDescent = hheaDescent; }
        else if (typoAscent != 0 || typoDescent != 0) { mAscent = typoAscent; mDescent = typoDescent; }
        else { mAscent = winAscent; mDescent = winDescent; }
        hb_blob_destroy(os2); hb_blob_destroy(hhea);
    }
    std::shared_ptr<FontData> mData;
    int mIndex;
    std::vector<minikin::FontVariation> mAxes;
    hb_face_t* mFace;
    hb_font_t* mFont;
    int32_t mUpem;
    float mAscent = 0, mDescent = 0;
    std::string mPath;
};

// Paint state the JavaScript Paint host hands over (src/minikin-text.js writes it in this layout).
struct LabPaint {
    int32_t collection;     // handle of a FontCollection
    float size;
    float scaleX;
    float skewX;
    float letterSpacing;
    float wordSpacing;
    uint32_t javaFlags;     // Paint.getFlags()
    int32_t hinting;        // Paint.getHinting(): 0 HINTING_OFF, 1 HINTING_ON
    uint32_t localeListId;
    int32_t familyVariant;
    int32_t weight;         // the Typeface's style (Typeface fStyle)
    int32_t italic;
    int32_t startHyphenEdit;
    int32_t endHyphenEdit;
    const char* fontFeatureSettings;   // may be null
};

template <typename T> struct Table {
    std::vector<std::shared_ptr<T>> items;
    int32_t add(std::shared_ptr<T> value) {
        for (size_t i = 1; i < items.size(); i++) if (!items[i]) { items[i] = std::move(value); return (int32_t)i; }
        if (items.empty()) items.emplace_back();
        items.push_back(std::move(value));
        return (int32_t)items.size() - 1;
    }
    std::shared_ptr<T> get(int32_t h) const { return h > 0 && (size_t)h < items.size() ? items[h] : nullptr; }
    void remove(int32_t h) { if (h > 0 && (size_t)h < items.size()) items[h].reset(); }
};
Table<FontData> gData;
Table<minikin::Font> gFonts;
Table<minikin::FontFamily> gFamilies;
Table<minikin::FontCollection> gCollections;

// hwui PaintImpl.cpp applyLegacyFlagsToFont + MinikinSkia.cpp packFontFlags: hinting << 16 | edging << 8 | the five font bits.
uint32_t packFontFlags(uint32_t javaFlags, int32_t hinting) {
    const uint32_t skHinting = hinting == 0 ? 0 /* SkFontHinting::kNone */ : 2 /* kNormal */;
    const uint32_t edging = (javaFlags & 0x01) ? 1 /* kAntiAlias */ : 0 /* kAlias */;
    uint32_t flags = skHinting << 16 | edging << 8;
    if (javaFlags & 0x020) flags |= minikin::Embolden_Flag;
    if (javaFlags & 0x040) flags |= minikin::LinearMetrics_Flag;
    if (javaFlags & 0x080) flags |= minikin::Subpixel_Flag;
    if (javaFlags & 0x400) flags |= minikin::EmbeddedBitmaps_Flag;
    if (javaFlags & 0x800) flags |= minikin::ForceAutoHinting_Flag;
    return flags;
}

// MinikinUtils::prepareMinikinPaint
bool preparePaint(const LabPaint* p, minikin::MinikinPaint* out) {
    std::shared_ptr<minikin::FontCollection> collection = gCollections.get(p->collection);
    if (!collection) { setError("invalid font collection handle"); return false; }
    minikin::MinikinPaint paint(collection);
    const bool linear = (p->javaFlags & 0x040) != 0;
    paint.size = linear ? p->size : static_cast<int>(p->size);
    paint.scaleX = p->scaleX;
    paint.skewX = p->skewX;
    paint.letterSpacing = p->letterSpacing;
    paint.wordSpacing = p->wordSpacing;
    paint.fontFlags = packFontFlags(p->javaFlags, p->hinting);
    paint.localeListId = p->localeListId;
    paint.familyVariant = static_cast<minikin::FamilyVariant>(p->familyVariant);
    paint.fontStyle = minikin::FontStyle(static_cast<uint16_t>(p->weight), p->italic ? minikin::FontStyle::Slant::ITALIC : minikin::FontStyle::Slant::UPRIGHT);
    if (p->fontFeatureSettings) paint.fontFeatureSettings = p->fontFeatureSettings;
    *out = std::move(paint);
    return true;
}

}  // namespace

// ---- module ----
/** `icuData`: the ICU 70.1 common data the lab shares between its ICU modules (vendor/icu/70.1/icudt70l.dat); `extraData`: the items only Minikin
 *  asks for (likely subtags, emoji properties, BCP 47 keys, locale aliases), a second common-data package ICU searches after the first. */
EXPORT int32_t mk_initialize(const void* icuData, const void* extraData) {
    UErrorCode status = U_ZERO_ERROR;
    udata_setCommonData(icuData, &status);
    if (U_SUCCESS(status) && extraData) udata_setCommonData(extraData, &status);
    if (U_SUCCESS(status)) u_init(&status);
    return status;
}
EXPORT const char* mk_last_error() { return gLastError.c_str(); }
EXPORT uint32_t mk_locale_list(const char* tags) { return minikin::registerLocaleList(tags ? tags : ""); }

// ---- fonts (hwui jni/fonts/Font.cpp, FontFamily.cpp; Typeface.cpp) ----
/** Takes ownership of `bytes` (malloc'd by the caller). */
EXPORT int32_t mk_data_new(uint8_t* bytes, uint32_t size) { return gData.add(std::make_shared<FontData>(bytes, size)); }
EXPORT void mk_data_free(int32_t h) { gData.remove(h); }
EXPORT int32_t mk_font_new(int32_t data, int32_t ttcIndex, const uint32_t* tags, const float* values, int32_t axisCount, int32_t weight, int32_t italic) {
    std::shared_ptr<FontData> bytes = gData.get(data);
    if (!bytes) { setError("invalid font data handle"); return 0; }
    std::vector<minikin::FontVariation> axes;
    for (int32_t i = 0; i < axisCount; i++) axes.emplace_back(tags[i], values[i]);
    auto typeface = std::make_shared<LabMinikinFont>(bytes, ttcIndex, std::move(axes));
    minikin::Font::Builder builder(typeface);
    if (weight > 0) builder.setWeight(static_cast<uint16_t>(weight));
    if (italic >= 0) builder.setSlant(italic ? minikin::FontStyle::Slant::ITALIC : minikin::FontStyle::Slant::UPRIGHT);
    return gFonts.add(builder.build());
}
EXPORT void mk_font_free(int32_t h) { gFonts.remove(h); }
EXPORT int32_t mk_family_new(const int32_t* fonts, int32_t count, uint32_t localeListId, int32_t variant, int32_t isCustomFallback) {
    std::vector<std::shared_ptr<minikin::Font>> list;
    for (int32_t i = 0; i < count; i++) {
        std::shared_ptr<minikin::Font> font = gFonts.get(fonts[i]);
        if (!font) { setError("invalid font handle"); return 0; }
        list.push_back(std::move(font));
    }
    if (list.empty()) { setError("a font family needs at least one font"); return 0; }
    return gFamilies.add(std::make_shared<minikin::FontFamily>(localeListId, static_cast<minikin::FamilyVariant>(variant), std::move(list), isCustomFallback != 0));
}
EXPORT void mk_family_free(int32_t h) { gFamilies.remove(h); }
EXPORT int32_t mk_collection_new(const int32_t* families, int32_t count) {
    std::vector<std::shared_ptr<minikin::FontFamily>> list;
    for (int32_t i = 0; i < count; i++) {
        std::shared_ptr<minikin::FontFamily> family = gFamilies.get(families[i]);
        if (!family) { setError("invalid font family handle"); return 0; }
        list.push_back(std::move(family));
    }
    if (list.empty()) { setError("a font collection needs at least one family"); return 0; }
    return gCollections.add(std::make_shared<minikin::FontCollection>(list));
}
EXPORT void mk_collection_free(int32_t h) { gCollections.remove(h); }
/** FontFamily::hasGlyph / FontCollection::hasVariationSelector (Paint.hasGlyph). */
EXPORT int32_t mk_collection_has_variation_selector(int32_t h, uint32_t codepoint, uint32_t vs) {
    std::shared_ptr<minikin::FontCollection> c = gCollections.get(h);
    return c && c->hasVariationSelector(codepoint, vs) ? 1 : 0;
}

// ---- MeasuredText (hwui jni/text/MeasuredText.cpp) ----
EXPORT minikin::MeasuredTextBuilder* mk_mt_builder_new() { return new minikin::MeasuredTextBuilder(); }
EXPORT void mk_mt_builder_free(minikin::MeasuredTextBuilder* b) { delete b; }
EXPORT int32_t mk_mt_add_style_run(minikin::MeasuredTextBuilder* b, const LabPaint* p, int32_t lbStyle, int32_t lbWordStyle, int32_t start, int32_t end, int32_t isRtl) {
    minikin::MinikinPaint paint(nullptr);
    if (!preparePaint(p, &paint)) return 0;
    b->addStyleRun(start, end, std::move(paint), lbStyle, lbWordStyle, isRtl != 0);
    return 1;
}
EXPORT void mk_mt_add_replacement_run(minikin::MeasuredTextBuilder* b, uint32_t localeListId, int32_t start, int32_t end, float width) {
    b->addReplacementRun(start, end, width, localeListId);
}
EXPORT minikin::MeasuredText* mk_mt_build(minikin::MeasuredTextBuilder* b, const uint16_t* text, int32_t length, int32_t hyphenation, int32_t layout, int32_t fast, minikin::MeasuredText* hint) {
    const minikin::U16StringPiece buffer(text, length);
    return b->build(buffer, hyphenation != 0, layout != 0, fast != 0, hint).release();
}
EXPORT void mk_mt_free(minikin::MeasuredText* mt) { delete mt; }
EXPORT const float* mk_mt_widths(minikin::MeasuredText* mt) { return mt->widths.data(); }
/** nGetWidth: the float sum of the widths. */
EXPORT float mk_mt_width(minikin::MeasuredText* mt, int32_t start, int32_t end) {
    float r = 0.0f;
    for (int32_t i = start; i < end; ++i) r += mt->widths[i];
    return r;
}
/** nGetExtent: ascent and descent rounded (SkScalarRoundToInt) into out[0], out[1]. */
EXPORT void mk_mt_extent(minikin::MeasuredText* mt, const uint16_t* text, int32_t length, int32_t start, int32_t end, int32_t* out) {
    const minikin::MinikinExtent extent = mt->getExtent(minikin::U16StringPiece(text, length), minikin::Range(start, end));
    out[0] = (int32_t)std::floor(extent.ascent + 0.5f);
    out[1] = (int32_t)std::floor(extent.descent + 0.5f);
}
/** nGetBounds: the rectangle rounded out (SkRect::roundOut) into out[0..3]. */
EXPORT void mk_mt_bounds(minikin::MeasuredText* mt, const uint16_t* text, int32_t length, int32_t start, int32_t end, int32_t* out) {
    const minikin::MinikinRect rect = mt->getBounds(minikin::U16StringPiece(text, length), minikin::Range(start, end));
    out[0] = (int32_t)std::floor(rect.mLeft); out[1] = (int32_t)std::floor(rect.mTop);
    out[2] = (int32_t)std::ceil(rect.mRight); out[3] = (int32_t)std::ceil(rect.mBottom);
}
EXPORT int32_t mk_mt_memory(minikin::MeasuredText* mt) { return (int32_t)mt->getMemoryUsage(); }

// ---- LineBreaker (hwui jni/text/LineBreaker.cpp) ----
EXPORT minikin::android::StaticLayoutNative* mk_lb_new(int32_t strategy, int32_t frequency, int32_t justified, const int32_t* indents, int32_t count) {
    std::vector<float> list(indents, indents + (indents ? count : 0));   // jintArrayToFloatVector
    return new minikin::android::StaticLayoutNative(static_cast<minikin::BreakStrategy>(strategy), static_cast<minikin::HyphenationFrequency>(frequency), justified != 0, std::move(list));
}
EXPORT void mk_lb_free(minikin::android::StaticLayoutNative* lb) { delete lb; }
EXPORT minikin::LineBreakResult* mk_lb_compute(minikin::android::StaticLayoutNative* lb, const uint16_t* text, int32_t length, minikin::MeasuredText* mt, float firstWidth, int32_t firstWidthLineCount,
                                              float restWidth, const float* tabStops, int32_t tabStopCount, float defaultTabStop, int32_t indentsOffset) {
    return new minikin::LineBreakResult(lb->computeBreaks(minikin::U16StringPiece(text, length), *mt, firstWidth, firstWidthLineCount, restWidth, indentsOffset, tabStops, tabStopCount, defaultTabStop));
}
EXPORT void mk_result_free(minikin::LineBreakResult* r) { delete r; }
EXPORT int32_t mk_result_count(minikin::LineBreakResult* r) { return (int32_t)r->breakPoints.size(); }
EXPORT const int32_t* mk_result_offsets(minikin::LineBreakResult* r) { return r->breakPoints.data(); }
EXPORT const float* mk_result_widths(minikin::LineBreakResult* r) { return r->widths.data(); }
EXPORT const float* mk_result_ascents(minikin::LineBreakResult* r) { return r->ascents.data(); }
EXPORT const float* mk_result_descents(minikin::LineBreakResult* r) { return r->descents.data(); }
EXPORT const int32_t* mk_result_flags(minikin::LineBreakResult* r) { return r->flags.data(); }

// ---- Paint text measurement (hwui jni/Paint.cpp through MinikinUtils) ----
/** MinikinUtils::measureText: the advance of [start, start + count) in its buffer; per-UTF-16 advances into `advances` when given (Paint.getTextWidths / getTextRunAdvances). */
EXPORT float mk_measure_text(const LabPaint* p, int32_t bidiFlags, const uint16_t* text, int32_t start, int32_t count, int32_t bufSize, float* advances) {
    minikin::MinikinPaint paint(nullptr);
    if (!preparePaint(p, &paint)) return NAN;
    return minikin::Layout::measureText(minikin::U16StringPiece(text, bufSize), minikin::Range(start, start + count), static_cast<minikin::Bidi>(bidiFlags), paint,
                                        static_cast<minikin::StartHyphenEdit>(p->startHyphenEdit), static_cast<minikin::EndHyphenEdit>(p->endHyphenEdit), advances);
}
/** MinikinUtils::getBounds (Paint.getTextBounds): the float rectangle into out[0..3]. */
EXPORT int32_t mk_text_bounds(const LabPaint* p, int32_t bidiFlags, const uint16_t* text, int32_t length, float* out) {
    minikin::MinikinPaint paint(nullptr);
    if (!preparePaint(p, &paint)) return 0;
    minikin::MinikinRect rect;
    minikin::getBounds(minikin::U16StringPiece(text, length), minikin::Range(0, length), static_cast<minikin::Bidi>(bidiFlags), paint,
                       static_cast<minikin::StartHyphenEdit>(p->startHyphenEdit), static_cast<minikin::EndHyphenEdit>(p->endHyphenEdit), &rect);
    out[0] = rect.mLeft; out[1] = rect.mTop; out[2] = rect.mRight; out[3] = rect.mBottom;
    return 1;
}
/** MinikinUtils::getFontExtent (Paint.getFontMetricsInt for a text): ascent, descent into out[0..1]. */
EXPORT int32_t mk_font_extent(const LabPaint* p, int32_t bidiFlags, const uint16_t* text, int32_t start, int32_t count, int32_t bufSize, float* out) {
    minikin::MinikinPaint paint(nullptr);
    if (!preparePaint(p, &paint)) return 0;
    const minikin::MinikinExtent extent = minikin::getFontExtent(minikin::U16StringPiece(text, bufSize), minikin::Range(start, start + count), static_cast<minikin::Bidi>(bidiFlags), paint);
    out[0] = extent.ascent; out[1] = extent.descent;
    return 1;
}
EXPORT void* mk_malloc(uint32_t size) { return malloc(size); }
EXPORT void mk_free(void* pointer) { free(pointer); }
