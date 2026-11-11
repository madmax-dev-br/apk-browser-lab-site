// Reference executable uses the same unmodified ICU70.1 source built natively.
// This is a development proof only, never the browser execution engine.
#include <unicode/utypes.h>
#include <unicode/ubrk.h>
#include <fstream>
#include <vector>
#include <iostream>
extern "C" int32_t icu_initialize(const void*);
extern "C" int32_t icu_boundaries(const UChar*,int32_t,const char*,int32_t,int32_t*,int32_t);
struct Case {const char* name;const char16_t* text;const char* locale;int32_t type;};
int main(int argc,char**argv){
 if(argc!=2)return 2;std::ifstream input(argv[1],std::ios::binary);std::vector<char> data((std::istreambuf_iterator<char>(input)),{});
 if(icu_initialize(data.data())>0)return 3;
 Case cases[]={ {"line-vs-word-line",u"Hello, world!","en_US",UBRK_LINE},{"line-vs-word-word",u"Hello, world!","en_US",UBRK_WORD},{"utf16-grapheme",u"A😀e\u0301","en_US",UBRK_CHARACTER},{"hard-breaks",u"a\r\nb\n","en_US",UBRK_LINE},{"portuguese",u"Olá, mundo.","pt_BR",UBRK_LINE},{"thai-dictionary",u"ภาษาไทยยินดีต้อนรับ","th",UBRK_WORD},{"sentence",u"One. Two!\nThree?","en_US",UBRK_SENTENCE} };
 std::cout<<"{";bool first=true;for(const auto&c:cases){int32_t length=0;while(c.text[length])length++;std::vector<int32_t> out(length+1);const auto count=icu_boundaries(reinterpret_cast<const UChar*>(c.text),length,c.locale,c.type,out.data(),length+1);if(count<0)return 4;if(!first)std::cout<<",";first=false;std::cout<<"\""<<c.name<<"\":[";for(int32_t i=0;i<count;i++){if(i)std::cout<<",";std::cout<<out[i];}std::cout<<"]";}std::cout<<"}\n";
}
