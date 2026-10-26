// Member inventory of boot classes whose implementation is a host bridge (no DEX), so reflection can tell a member ART does not have (NoSuchMethodException /
// NoSuchFieldException) from one the VM merely does not implement (an explicit error). The lists are the java.lang.Class / java.lang.Object members of Android's libcore
// (OpenJDK 8 API plus the Android additions) as of API 28: there is no java.lang.Module and no Class.getModule(), no Class.isRecord/isSealed/getNestHost/arrayType...
// Only names are needed: the reflective lookup is by name and parameter types, and every listed name has bridge or native support or fails explicitly.
const names = text => new Set(text.split(/\s+/).filter(Boolean));
const CLASS = names(`forName newInstance isInstance isAssignableFrom isInterface isArray isPrimitive isAnnotation isSynthetic getName getClassLoader getTypeParameters
  getSuperclass getGenericSuperclass getPackage getInterfaces getGenericInterfaces getComponentType getModifiers getSigners getEnclosingMethod getEnclosingConstructor
  getDeclaringClass getEnclosingClass getSimpleName getTypeName getCanonicalName isAnonymousClass isLocalClass isMemberClass getClasses getFields getMethods getConstructors
  getField getMethod getConstructor getDeclaredClasses getDeclaredFields getDeclaredMethods getDeclaredConstructors getDeclaredField getDeclaredMethod getDeclaredConstructor
  getResourceAsStream getResource getProtectionDomain desiredAssertionStatus isEnum getEnumConstants cast asSubclass getAnnotation isAnnotationPresent getAnnotationsByType
  getAnnotations getDeclaredAnnotation getDeclaredAnnotationsByType getDeclaredAnnotations toString toGenericString getDex getInnerClassName getDexClassDef getDexTypeIndex
  isProxy getAccessFlags getDexCache getClassFlags getEnumConstantsShared isLocalOrAnonymousClass getInnerClassFlags getPrimitiveClass getPublicMethodRecursive
  getPublicFieldRecursive getPrimitiveClassName getAnnotationsByTypeInternal
  getClass hashCode equals notify notifyAll wait clone finalize`);
const OBJECT = names('getClass hashCode equals clone toString notify notifyAll wait finalize');
const CLOSED = new Map([['Ljava/lang/Class;', CLASS], ['Ljava/lang/Object;', OBJECT]]);
/** true when `owner` has a complete name inventory and `name` is not one of its members; constructors are never public for these classes. */
export const bootClassLacksMember = (owner, kind, name) => {
  const set = CLOSED.get(owner); if (!set) return false;
  return kind === 'constructor' ? true : !set.has(name);
};
