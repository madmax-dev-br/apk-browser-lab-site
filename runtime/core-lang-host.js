import { createHostRegistry } from './host-contract.js?v=ccd10c551257';

// java.lang.System.getProperties / setProperties / getenv() and the reflection queries of java.lang.Class that the VM's class table can answer (libcore System.java, Class.java, android-13.0.0_r1).
//  - getProperties() returns the process's one Properties object, filled from the property table the VM keeps for System.getProperty; from then on System.getProperty / setProperty /
//    clearProperty go through that object, so an app that edits it sees its edits (apk-runtime.js consults runtime.systemPropertiesObject).
//  - getenv() is the unmodifiable map of the environment System.getenv(String) and Os.environ report.
const SYSTEM = 'Ljava/lang/System;', PROPERTIES = 'Ljava/util/Properties;', MAP = 'Ljava/util/Map;', STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;';

export function createCoreLangHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  const call = (r, receiver, owner, name, parameters = [], result = 'V', values = [], mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, mode === 'static' ? values : [receiver, ...values], mode);
  const create = (r, owner, parameters = [], values = []) => { const ref = r.allocate(owner); call(r, ref, owner, '<init>', parameters, 'V', values, 'direct'); return ref; };

  def(SYSTEM, 'getProperties', `()${PROPERTIES}`, r => {
    if (!r.systemPropertiesObject) {
      const properties = create(r, PROPERTIES);
      for (const [key, value] of r.javaProperties) call(r, properties, PROPERTIES, 'setProperty', [STRING, STRING], OBJECT, [key, value]);
      r.systemPropertiesObject = properties;
    }
    return r.systemPropertiesObject;
  }, { static: true });
  def(SYSTEM, 'setProperties', `(${PROPERTIES})V`, (r, _m, [properties]) => {   // null restores the defaults (System.initUnchangeableSystemProperties + the changeable ones)
    if (properties === null || properties === 0) { r.systemPropertiesObject = null; r.javaProperties.clear(); platform.systemServices.initializeSystemProperties(r); return; }
    r.systemPropertiesObject = properties;
  }, { static: true });
  def(SYSTEM, 'getenv', `()${MAP}`, r => {
    const map = create(r, 'Ljava/util/HashMap;');
    for (const [key, value] of Object.entries(platform.environment ?? {})) call(r, map, MAP, 'put', [OBJECT, OBJECT], OBJECT, [key, String(value)]);
    return call(r, null, 'Ljava/util/Collections;', 'unmodifiableMap', [MAP], MAP, [map], 'static');
  }, { static: true });
  return { ...registry };
}
