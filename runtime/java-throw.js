// Throws a Java exception of a framework (DEX) or platform class from a native binding, constructing it through its (String) constructor like jniThrowException.
export function throwNew(runtime, type, message = null) {
  if (type.startsWith('Ljava/lang/') && !runtime.classes.has(type)) runtime.throwJava(type, message);
  const reference = runtime.allocate(type);
  runtime.dispatch({ owner: type, name: '<init>', parameters: ['Ljava/lang/String;'], result: 'V', signature: '(Ljava/lang/String;)V' }, [reference, message], 'direct');
  runtime.throwJavaReference(reference, message);
}
