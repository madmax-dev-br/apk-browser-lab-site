import { APKError } from './apk-runtime.js?v=00979d36e5ab';
const PARSER = 'Landroid/content/res/XmlBlock$Parser;', PULL = 'Lorg/xmlpull/v1/XmlPullParser;', ATTRS = 'Landroid/util/AttributeSet;', RES_PARSER = 'Landroid/content/res/XmlResourceParser;';
const ANDROID = 'http://schemas.android.com/apk/res/android';
const methods = [
  'close()V', 'next()I', 'nextToken()I', 'getEventType()I', 'getDepth()I', 'getName()Ljava/lang/String;', 'getText()Ljava/lang/String;', 'getNamespace()Ljava/lang/String;', 'getNamespace(Ljava/lang/String;)Ljava/lang/String;', 'getPrefix()Ljava/lang/String;', 'getNamespaceCount(I)I', 'getNamespacePrefix(I)Ljava/lang/String;', 'getNamespaceUri(I)Ljava/lang/String;', 'isWhitespace()Z', 'isEmptyElementTag()Z', 'getPositionDescription()Ljava/lang/String;', 'getLineNumber()I', 'getColumnNumber()I', 'getInputEncoding()Ljava/lang/String;', 'nextTag()I', 'nextText()Ljava/lang/String;', 'require(ILjava/lang/String;Ljava/lang/String;)V',
  'getAttributeCount()I', 'getAttributeName(I)Ljava/lang/String;', 'getAttributeNamespace(I)Ljava/lang/String;', 'getAttributePrefix(I)Ljava/lang/String;', 'getAttributeType(I)Ljava/lang/String;', 'isAttributeDefault(I)Z', 'getAttributeNameResource(I)I', 'getAttributeValue(I)Ljava/lang/String;', 'getAttributeValue(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;', 'getAttributeResourceValue(II)I', 'getAttributeResourceValue(Ljava/lang/String;Ljava/lang/String;I)I', 'getAttributeIntValue(II)I', 'getAttributeIntValue(Ljava/lang/String;Ljava/lang/String;I)I', 'getAttributeUnsignedIntValue(II)I', 'getAttributeUnsignedIntValue(Ljava/lang/String;Ljava/lang/String;I)I', 'getAttributeFloatValue(IF)F', 'getAttributeFloatValue(Ljava/lang/String;Ljava/lang/String;F)F', 'getAttributeBooleanValue(IZ)Z', 'getAttributeBooleanValue(Ljava/lang/String;Ljava/lang/String;Z)Z', 'getIdAttribute()Ljava/lang/String;', 'getClassAttribute()Ljava/lang/String;', 'getIdAttributeResourceValue(I)I', 'getStyleAttribute()I', 'getPooledString(I)Ljava/lang/CharSequence;'
];
export const XML_METHODS = new Set();
for (const owner of [PARSER, PULL, ATTRS, RES_PARSER]) for (const signature of methods) XML_METHODS.add(`${owner}->${signature}`);
XML_METHODS.add('Landroid/content/res/Resources;->getXml(I)Landroid/content/res/XmlResourceParser;');
XML_METHODS.add('Landroid/content/res/Resources;->getLayout(I)Landroid/content/res/XmlResourceParser;');
XML_METHODS.add('Landroid/content/res/Resources;->getAttributeSetSourceResId(Landroid/util/AttributeSet;)I');
XML_METHODS.add('Landroid/util/Xml;->asAttributeSet(Lorg/xmlpull/v1/XmlPullParser;)Landroid/util/AttributeSet;');
const fail = message => { throw new APKError(`Binary XML parser: ${message}`, { kind: 'xml-parser-unsupported' }); };
function floatBits(value) { const data = new DataView(new ArrayBuffer(4)); data.setFloat32(0, value, true); return data.getInt32(0, true); }

/** Pull-parser boundary over actual compiled AXML events. App navigation code is never reconstructed. */
export class AndroidXmlHost {
  constructor(platform) { this.platform = platform; }
  interfaces(type) { return type === PARSER ? [PULL, ATTRS, RES_PARSER, 'Ljava/lang/AutoCloseable;'] : type === RES_PARSER ? [PULL, ATTRS, 'Ljava/lang/AutoCloseable;'] : []; }
  create(runtime, tree, resourceId) {
    const value = runtime.makeObject(PARSER), parser = runtime.object(value), events = [{ type: 0, depth: 0, node: null }], strings = new Map();
    const visit = (node, depth, parentScopes = [[]]) => {
      if (depth > 64 || events.length > 32768) fail('compiled XML event bounds exceeded');
      const scopes = [...parentScopes, node.namespaces || []]; events.push({ type: 2, depth, node, scopes });
      for (const attr of node.attributes) if (attr.dataType === 3) strings.set(attr.rawData, attr.value);
      if (node.text && node.children.length) fail('mixed text/element ordering is not retained by this binary tree profile');
      if (node.text) events.push({ type: 4, depth, node, text: node.text, scopes });
      node.children.forEach(child => visit(child, depth + 1, scopes)); events.push({ type: 3, depth, node, scopes });
    };
    visit(tree, 1); events.push({ type: 1, depth: 0, node: null });
    Object.assign(parser, { events, cursor: 0, node: null, pooledStrings: strings, resourceId, closed: false }); return value;
  }
  event(parser) { if (parser.closed) fail('parser is closed'); return parser.events[parser.cursor]; }
  advance(parser) { if (parser.cursor < parser.events.length - 1) parser.cursor++; const event = this.event(parser); parser.node = event.node; return event.type; }
  attribute(parser, first, second) {
    const event = this.event(parser); if (event.type !== 2) return null;
    return typeof first === 'number' ? event.node.attributes[first] ?? null : event.node.attributes.find(attr => (attr.namespace || '') === (first || '') && attr.name === second) ?? null;
  }
  invoke(runtime, method, args) {
    const name = method.name;
    if (method.owner === 'Landroid/util/Xml;') { const value = args[0]; if (!value || !runtime.object(value).events) fail('asAttributeSet requires the real prepared binary parser'); return value; }
    if (method.owner === 'Landroid/content/res/Resources;' && name === 'getAttributeSetSourceResId') return args[0]?.ref ? runtime.object(args[0]).resourceId || 0 : 0;
    if (method.owner === 'Landroid/content/res/Resources;') return this.create(runtime, this.platform.resources.getXml(args[1]), args[1]);
    const parser = runtime.object(args[0]);
    if (name === 'getPooledString') { const text = parser.pooledStrings?.get(args[1]); if (text === undefined) fail(`pool index ${args[1]} is not prepared`); return text; }
    if (name === 'close') { parser.closed = true; return; }
    const event = this.event(parser), node = event.node;
    if (name === 'getEventType') return event.type;
    if (name === 'next' || name === 'nextToken') return this.advance(parser);
    if (name === 'getDepth') return event.depth;
    if (name === 'getName') return [2, 3].includes(event.type) ? node.name : null;
    if (name === 'getText') return event.type === 4 ? event.text : null;
    if (name === 'getNamespace') return method.parameters.length ? [...(node?.namespaces || [])].reverse().find(ns => (ns.prefix || '') === (args[1] || ''))?.uri ?? null : node?.namespace || '';
    if (name === 'getPrefix') return node?.namespaces.find(ns => ns.uri === node.namespace)?.prefix ?? null;
    if (name === 'getNamespaceCount') { if (args[1] < 0 || args[1] > event.depth) fail('namespace depth out of range'); return event.scopes?.[args[1]]?.length || 0; }
    if (name === 'getNamespacePrefix') return node?.namespaces[args[1]]?.prefix ?? null;
    if (name === 'getNamespaceUri') return node?.namespaces[args[1]]?.uri ?? null;
    if (name === 'isWhitespace') return event.type === 4 && !event.text.trim() ? 1 : 0;
    if (name === 'isEmptyElementTag') return event.type === 2 && parser.events[parser.cursor + 1]?.type === 3 ? 1 : 0;
    if (name === 'getLineNumber') return node?.lineNumber || -1;
    if (name === 'getColumnNumber') return -1;
    if (name === 'getInputEncoding') return null;
    if (name === 'getPositionDescription') return `Compiled XML 0x${(parser.resourceId >>> 0).toString(16)} line ${node?.lineNumber || -1}`;
    if (name === 'require') { if (event.type !== args[1] || args[2] != null && (node?.namespace || '') !== args[2] || args[3] != null && node?.name !== args[3]) fail('require event/name/namespace mismatch'); return; }
    if (name === 'nextTag') { let type = this.advance(parser); while (type === 4 && !this.event(parser).text.trim()) type = this.advance(parser); if (![2, 3].includes(type)) fail('nextTag expected start or end element'); return type; }
    if (name === 'nextText') { if (event.type !== 2) fail('nextText requires start element'); let type = this.advance(parser), text = ''; if (type === 4) { text = this.event(parser).text; type = this.advance(parser); } if (type !== 3) fail('nextText found nested elements'); return text; }
    if (name === 'getAttributeCount') return event.type === 2 ? node.attributes.length : -1;
    if (name === 'getStyleAttribute') return node?.attributes.find(attr => attr.name === 'style')?.reference || 0;
    if (name === 'getIdAttributeResourceValue') return this.attribute(parser, ANDROID, 'id')?.reference ?? args[1];
    if (name === 'getIdAttribute' || name === 'getClassAttribute') { const attr = this.attribute(parser, name === 'getIdAttribute' ? ANDROID : null, name === 'getIdAttribute' ? 'id' : 'class'); return attr ? attr.rawValue ?? (attr.kind === 'reference' ? `@${attr.reference}` : String(attr.value)) : null; }
    const attr = this.attribute(parser, args[1], args[2]);
    if (name === 'getAttributeName') return attr?.name ?? null;
    if (name === 'getAttributeNamespace') return attr?.namespace || '';
    if (name === 'getAttributePrefix') return node?.namespaces.find(ns => ns.uri === attr?.namespace)?.prefix ?? null;
    if (name === 'getAttributeType') return attr ? 'CDATA' : null;
    if (name === 'isAttributeDefault') return 0;
    if (name === 'getAttributeNameResource') return attr?.resourceId || 0;
    if (name === 'getAttributeValue') return attr ? attr.rawValue ?? (attr.kind === 'reference' ? `@${attr.reference}` : attr.kind === 'attribute' ? `?${attr.reference}` : String(attr.value)) : null;
    const fallback = args.at(-1); if (!attr) return fallback;
    if (name === 'getAttributeResourceValue') return attr.kind === 'reference' ? attr.reference : fallback;
    if (name === 'getAttributeBooleanValue') return attr.kind === 'boolean' || attr.kind === 'integer' ? attr.value ? 1 : 0 : fallback;
    if (name === 'getAttributeFloatValue') return attr.dataType === 4 ? attr.rawData | 0 : attr.kind === 'integer' ? floatBits(attr.value) : fallback;
    if (name === 'getAttributeIntValue' || name === 'getAttributeUnsignedIntValue') return ['integer', 'boolean', 'color'].includes(attr.kind) ? attr.rawData | 0 : fallback;
    fail(`unsupported pull method ${method.owner}->${name}${method.signature}`);
  }
}
