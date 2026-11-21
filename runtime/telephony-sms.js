import { APKError } from './apk-error.js?v=d826b7643adc';

// An incoming SMS on the virtual device (the Device panel's "Incoming SMS", the Node API platform.telephony.receiveSms). The device plays the radio and the network: it builds the
// 3GPP TS 23.040 SMS-DELIVER PDUs a network would deliver (no service-centre address, TP-OA the sender, TP-DCS 0x08 = UCS-2 so any text is carried as it is typed, the
// service-centre timestamp of the device clock in the device time zone, a concatenation header when the text needs more than one PDU) and hands them to the framework the way
// InboundSmsHandler does: an ordered SMS_RECEIVED_ACTION broadcast from the system, receivable only by the holders of RECEIVE_SMS (receiverPermission), with the extras "pdus"
// (Object[] of byte[]), "format" ("3gpp") and the phone/slot/subscription ids (the device has no subscription: -1). The receivers decode them with the original
// android.telephony.SmsMessage / Telephony.Sms.Intents.getMessagesFromIntent (framework-aosp/profiles/telephony). The device has no default SMS app, so no SMS_DELIVER is sent
// and nothing is written to the SMS provider.
export const SMS_RECEIVED_ACTION = 'android.provider.Telephony.SMS_RECEIVED';
const MAX_SINGLE_UNITS = 70, MAX_PART_UNITS = 67;   // UCS-2: 140 octets of user data; a concatenated part loses 6 octets to its header (UDHL + IEI 0x00, length 3, ref, total, seq)
const FLAG_RECEIVER_INCLUDE_BACKGROUND = 0x01000000;

/** The semi-octet (swapped BCD) form of a two-digit value: 23 -> 0x32 (IccUtils.gsmBcdByteToInt reads it back). */
const swappedBcd = value => ((value % 10) << 4) | Math.floor(value / 10) % 10;
/** TP-OA: the digit count, the type of address (0x91 international when the number starts with "+", else 0x81) and the digits as swapped semi-octets, an odd count filled with F. */
export function encodeAddress(number) {
  const text = String(number ?? '').trim(), international = text.startsWith('+'), digits = text.replace(/^\+/, '');
  if (!/^[0-9*#]{1,20}$/.test(digits)) throw new APKError(`Incoming SMS: the sender must be a phone number (digits, optionally starting with +), got "${text}"`, { kind: 'sms-sender' });
  const nibble = c => c === '*' ? 0xa : c === '#' ? 0xb : c.charCodeAt(0) - 48, bytes = [digits.length, international ? 0x91 : 0x81];
  for (let i = 0; i < digits.length; i += 2) bytes.push(nibble(digits[i]) | ((i + 1 < digits.length ? nibble(digits[i + 1]) : 0xf) << 4));
  return bytes;
}
/** TP-SCTS: year, month, day, hour, minute, second of the local time and the offset in quarter hours (sign in bit 3 of the last octet). */
export function encodeTimestamp(epochMs, offsetMinutes) {
  const local = new Date(epochMs + offsetMinutes * 60000), quarters = Math.round(Math.abs(offsetMinutes) / 15);
  return [local.getUTCFullYear() % 100, local.getUTCMonth() + 1, local.getUTCDate(), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds()].map(swappedBcd)
    .concat(swappedBcd(quarters) | (offsetMinutes < 0 ? 0x08 : 0));
}
/** The SMS-DELIVER PDUs (Uint8Array each) of `body` from `sender`, as the network delivers them: one PDU, or a concatenated series sharing reference `reference`. */
export function deliverPdus({ sender, body, epochMs, offsetMinutes = 0, reference = 1 }) {
  const text = String(body ?? '');
  if (!text.length) throw new APKError('Incoming SMS: the message text is empty', { kind: 'sms-body' });
  const units = []; for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i));
  const parts = [];
  if (units.length <= MAX_SINGLE_UNITS) parts.push(units);
  else for (let at = 0; at < units.length;) { let end = Math.min(units.length, at + MAX_PART_UNITS); if (end < units.length && units[end - 1] >= 0xd800 && units[end - 1] < 0xdc00) end--; parts.push(units.slice(at, end)); at = end; }   // a surrogate pair stays in one part
  if (parts.length > 255) throw new APKError('Incoming SMS: the text needs more than 255 parts', { kind: 'sms-body' });
  const address = encodeAddress(sender), timestamp = encodeTimestamp(epochMs, offsetMinutes);
  return parts.map((part, index) => {
    const header = parts.length > 1 ? [5, 0x00, 3, reference & 0xff, parts.length, index + 1] : [];
    const data = []; for (const unit of part) data.push(unit >> 8, unit & 0xff);
    const userData = [...header, ...data];
    return Uint8Array.from([0x00, 0x04 | (header.length ? 0x40 : 0), ...address, 0x00, 0x08, ...timestamp, userData.length, ...userData]);   // SMSC length 0; MTI deliver, no more messages, UDHI; PID 0; DCS UCS-2
  });
}

export function createTelephonySms(platform) {
  let reference = 0;
  const offsetMinutes = epochMs => {   // the device time zone's offset at that instant (the panel's time zone, else the host's)
    const zone = platform.device?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(epochMs)).map(p => [p.type, Number(p.value)]));
      return Math.round((Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(epochMs / 1000) * 1000) / 60000);
    } catch { return 0; }
  };
  /**
   * The radio received an SMS: `from` (the sender's number) and `body`. Returns { pdus, receivers } once the broadcast is queued (the receivers run as main-thread messages).
   * Callers outside a VM event (the Worker's message handler) go through platform.queueTask so no Java runs inside the page's message.
   */
  const receiveSms = (r, { from, body, time = null }) => {
    const epochMs = time ?? platform.clock?.wall?.() ?? Date.now(), pdus = deliverPdus({ sender: from, body, epochMs, offsetMinutes: offsetMinutes(epochMs), reference: ++reference });
    const array = r.newArray('[Ljava/lang/Object;', pdus.length); r.array(array).elements = pdus.map(pdu => r.arrayOf('[B', pdu));
    const intent = r.makeObject('Landroid/content/Intent;'); platform.intentInvoke(r, { owner: 'Landroid/content/Intent;', name: '<init>', parameters: ['Ljava/lang/String;'] }, [intent, SMS_RECEIVED_ACTION]);
    r.object(intent).flags = FLAG_RECEIVER_INCLUDE_BACKGROUND;   // SMS_RECEIVED is exempt from the implicit-broadcast limit: manifest receivers hear it
    platform.put(r, intent, 'pdus', 'Ljava/io/Serializable;', array); platform.put(r, intent, 'format', 'Ljava/lang/String;', '3gpp');
    for (const key of ['phone', 'slot', 'android.telephony.extra.SLOT_INDEX']) platform.put(r, intent, key, 'I', 0);
    for (const key of ['subscription', 'android.telephony.extra.SUBSCRIPTION_INDEX']) platform.put(r, intent, key, 'I', -1);
    r.record(`DEVICE SMS received from ${from}: ${body.length} characters in ${pdus.length} PDU${pdus.length === 1 ? '' : 's'} (3GPP, UCS-2); SMS_RECEIVED to the holders of RECEIVE_SMS`);
    platform.broadcasts.send(r, null, intent, { ordered: true, receiverPermissions: ['android.permission.RECEIVE_SMS'] });
    return { pdus: pdus.length };
  };
  return { receiveSms };
}
