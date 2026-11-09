import { createHostRegistry } from './host-contract.js?v=346c3ee9a461';

// java.util.SimpleTimeZone (libcore ojluni SimpleTimeZone.java, android-13.0.0_r1): the rule decoding and the offset computation are a port of the Java code (the same IllegalArgumentException
// messages, the same start/end transition arithmetic including the southern-hemisphere case where start > end). TimeZone objects of the VM are identified by their ID (datetime-host.js:
// Calendar, SimpleDateFormat and Date formatting read the offset of an ID), so a SimpleTimeZone registers its rules under its ID in platform.customZones and every consumer sees them. Two
// SimpleTimeZones with the same ID share the most recently registered rules. Dates before the Gregorian cutover use the proleptic Gregorian calendar here (Java switches to Julian).
const SIMPLE = 'Ljava/util/SimpleTimeZone;', ZONE = 'Ljava/util/TimeZone;', DATE = 'Ljava/util/Date;', STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;';
const HOUR = 3600000, DAY = 24 * HOUR, MONTH_LENGTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DOM = 1, DOW_IN_MONTH = 2, DOW_GE_DOM = 3, DOW_LE_DOM = 4, WALL = 0, UTC_TIME = 2;
const illegal = message => ({ illegal: message });

class Rules {
  constructor(id, rawOffset) { Object.assign(this, { id, rawOffset, dstSavings: HOUR, useDaylight: false, startYear: 0, startMonth: 0, startDay: 0, startDayOfWeek: 0, startTime: 0, startTimeMode: WALL, endMonth: 0, endDay: 0, endDayOfWeek: 0, endTime: 0, endTimeMode: WALL, startMode: 0, endMode: 0 }); }
  copy() { return Object.assign(new Rules(this.id, this.rawOffset), this); }
  decode(side) {   // decodeStartRule / decodeEndRule
    const p = side, day = this[`${p}Day`], dow0 = this[`${p}DayOfWeek`], month = this[`${p}Month`], time = this[`${p}Time`];
    this.useDaylight = this.startDay !== 0 && this.endDay !== 0;
    if (day === 0) return;
    if (month < 0 || month > 11) throw illegal(`Illegal ${p} month ${month}`);
    if (time < 0 || time > DAY) throw illegal(`Illegal ${p} time ${time}`);
    let mode, dow = dow0, dayOfMonth = day;
    if (dow === 0) mode = DOM;
    else {
      if (dow > 0) mode = DOW_IN_MONTH;
      else { dow = -dow; if (dayOfMonth > 0) mode = DOW_GE_DOM; else { dayOfMonth = -dayOfMonth; mode = DOW_LE_DOM; } }
      if (dow > 7) throw illegal(`Illegal ${p} day of week ${dow}`);
    }
    if (mode === DOW_IN_MONTH) { if (dayOfMonth < -5 || dayOfMonth > 5) throw illegal(`Illegal ${p} day of week in month ${dayOfMonth}`); }
    else if (dayOfMonth < 1 || dayOfMonth > MONTH_LENGTH[month]) throw illegal(`Illegal ${p} day ${dayOfMonth}`);
    this[`${p}Mode`] = mode; this[`${p}DayOfWeek`] = dow; this[`${p}Day`] = dayOfMonth;
  }
  // getTransition: the UTC instant (before applying timeOfDay) of a rule in `year`; month is 0-based, dayOfWeek 1 = Sunday
  transition(mode, year, month, dayOfMonth, dayOfWeek, timeOfDay) {
    const length = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), weekday = (y, m, d) => new Date(Date.UTC(y, m, d)).getUTCDay() + 1;
    let day = dayOfMonth;
    if (mode === DOW_IN_MONTH) {
      if (dayOfMonth > 0) { const first = weekday(year, month, 1); day = 1 + ((dayOfWeek - first + 7) % 7) + (dayOfMonth - 1) * 7; }
      else { const last = length(year, month), lastDow = weekday(year, month, last); day = last - ((lastDow - dayOfWeek + 7) % 7) + (dayOfMonth + 1) * 7; }
    } else if (mode === DOW_GE_DOM) day = dayOfMonth + ((dayOfWeek - weekday(year, month, dayOfMonth) + 7) % 7);
    else if (mode === DOW_LE_DOM) day = dayOfMonth - ((weekday(year, month, dayOfMonth) - dayOfWeek + 7) % 7);
    return Date.UTC(year, month, day) + timeOfDay;
  }
  start(year) { let time = this.startTime; if (this.startTimeMode !== UTC_TIME) time -= this.rawOffset; return this.transition(this.startMode, year, this.startMonth, this.startDay, this.startDayOfWeek, time); }
  end(year) { let time = this.endTime; if (this.endTimeMode !== UTC_TIME) time -= this.rawOffset; if (this.endTimeMode === WALL) time -= this.dstSavings; return this.transition(this.endMode, year, this.endMonth, this.endDay, this.endDayOfWeek, time); }
  inDst(year, time) {   // the body of getOffset(cal, cdate, year, time): whether `time` is in daylight time in the rules' year
    const start = this.start(year), end = this.end(year);
    if (start <= end) return time >= start && time < end;
    if (time < end) return time >= this.start(year - 1);
    if (time >= start) return time < this.end(year + 1);
    return false;
  }
  offsetAt(date) {   // getOffsets(date, null)
    if (!this.useDaylight) return this.rawOffset;
    const year = new Date(date + this.rawOffset).getUTCFullYear();
    return year >= this.startYear && this.inDst(year, date) ? this.rawOffset + this.dstSavings : this.rawOffset;
  }
}

export function createSimpleTimeZoneHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(SIMPLE, ZONE, ['Ljava/io/Serializable;', 'Ljava/lang/Cloneable;'], { allocatable: true });
  for (const [name, value] of [['WALL_TIME', 0], ['STANDARD_TIME', 1], ['UTC_TIME', 2]]) registry.staticField(SIMPLE, name, 'I', () => value);
  const zones = () => (platform.customZones ??= new Map());
  const rules = (r, self) => r.object(self).stz ?? r.throwJava('Ljava/lang/IllegalStateException;', 'SimpleTimeZone is not initialized');
  const guard = (r, fn) => { try { return fn(); } catch (error) { if (error?.illegal) r.throwJava('Ljava/lang/IllegalArgumentException;', error.illegal); throw error; } };
  const register = (r, self, state) => { r.object(self).stz = state; r.object(self).tzId = state.id; zones().set(state.id, state); };
  const id = (r, value) => { if (value === null) r.throwJava('Ljava/lang/NullPointerException;', null); return r.stringCharacters(value); };   // TimeZone.setID: ID == null -> NullPointerException

  def(SIMPLE, '<init>', `(I${STRING})V`, (r, _m, [self, raw, name]) => register(r, self, new Rules(id(r, name), raw)));
  const full = (r, self, a) => guard(r, () => {
    const [raw, name, sm, sd, sdow, st, stm, em, ed, edow, et, etm, savings] = a, state = new Rules(id(r, name), raw);
    Object.assign(state, { startMonth: sm, startDay: sd, startDayOfWeek: sdow, startTime: st, startTimeMode: stm, endMonth: em, endDay: ed, endDayOfWeek: edow, endTime: et, endTimeMode: etm, dstSavings: savings });
    state.decode('start'); state.decode('end');
    if (savings <= 0) throw illegal(`Illegal daylight saving value: ${savings}`);
    register(r, self, state);
  });
  def(SIMPLE, '<init>', `(I${STRING}IIIIIIII)V`, (r, _m, [self, raw, name, sm, sd, sdow, st, em, ed, edow, et]) => full(r, self, [raw, name, sm, sd, sdow, st, WALL, em, ed, edow, et, WALL, HOUR]));
  def(SIMPLE, '<init>', `(I${STRING}IIIIIIIII)V`, (r, _m, [self, raw, name, sm, sd, sdow, st, em, ed, edow, et, savings]) => full(r, self, [raw, name, sm, sd, sdow, st, WALL, em, ed, edow, et, WALL, savings]));
  def(SIMPLE, '<init>', `(I${STRING}IIIIIIIIIII)V`, (r, _m, [self, raw, name, ...rest]) => full(r, self, [raw, name, ...rest]));

  const setRule = (side, r, self, month, day, dow, time) => guard(r, () => {
    const state = rules(r, self); Object.assign(state, { [`${side}Month`]: month, [`${side}Day`]: day, [`${side}DayOfWeek`]: dow, [`${side}Time`]: time, [`${side}TimeMode`]: WALL }); state.decode(side);
  });
  for (const side of ['start', 'end']) {
    const name = side === 'start' ? 'setStartRule' : 'setEndRule';
    def(SIMPLE, name, '(IIII)V', (r, _m, [self, month, day, dow, time]) => setRule(side, r, self, month, day, dow, time));
    def(SIMPLE, name, '(III)V', (r, _m, [self, month, day, time]) => setRule(side, r, self, month, day, 0, time));
    def(SIMPLE, name, '(IIIIZ)V', (r, _m, [self, month, day, dow, time, after]) => (after ? setRule(side, r, self, month, day, -dow, time) : setRule(side, r, self, month, -day, -dow, time)));
  }
  def(SIMPLE, 'setStartYear', '(I)V', (r, _m, [self, year]) => { rules(r, self).startYear = year; });
  def(SIMPLE, 'setRawOffset', '(I)V', (r, _m, [self, offset]) => { rules(r, self).rawOffset = offset; });
  def(SIMPLE, 'getRawOffset', '()I', (r, _m, [self]) => rules(r, self).rawOffset);
  def(SIMPLE, 'setDSTSavings', '(I)V', (r, _m, [self, savings]) => { if (savings <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', `Illegal daylight saving value: ${savings}`); rules(r, self).dstSavings = savings; });
  def(SIMPLE, 'getDSTSavings', '()I', (r, _m, [self]) => (rules(r, self).useDaylight ? rules(r, self).dstSavings : 0));
  def(SIMPLE, 'useDaylightTime', '()Z', (r, _m, [self]) => (rules(r, self).useDaylight ? 1 : 0));
  def(SIMPLE, 'observesDaylightTime', '()Z', (r, _m, [self]) => (rules(r, self).useDaylight ? 1 : 0));
  def(SIMPLE, 'getOffset', '(J)I', (r, _m, [self, date]) => rules(r, self).offsetAt(Number(date)));
  def(SIMPLE, 'inDaylightTime', `(${DATE})Z`, (r, _m, [self, date]) => {
    const time = r.dispatch({ owner: DATE, name: 'getTime', parameters: [], result: 'J', signature: '()J' }, [date], 'virtual'); const state = rules(r, self);
    return state.offsetAt(Number(time)) !== state.rawOffset ? 1 : 0;
  });
  def(SIMPLE, 'getOffset', '(IIIIII)I', (r, _m, [self, era, year, month, day, dayOfWeek, millis]) => {   // getOffset(era, year, month, day, dayOfWeek, millis)
    const state = rules(r, self), bad = () => r.throwJava('Ljava/lang/IllegalArgumentException;', null);
    if (era !== 0 && era !== 1) r.throwJava('Ljava/lang/IllegalArgumentException;', `Illegal era ${era}`);
    let y = era === 0 ? 1 - year : year;
    if (y >= 292278994) y = 2800 + (y % 2800); else if (y <= -292269054) y = ((y % 28) + 28) % 28;
    const probe = new Date(Date.UTC(2000, 0, 1)); probe.setUTCFullYear(y, month, day);
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== month || probe.getUTCDate() !== day || dayOfWeek < 1 || dayOfWeek > 7 || millis < 0 || millis >= DAY) bad();
    if (!state.useDaylight || year < state.startYear || era !== 1) return state.rawOffset;
    const time = probe.getTime() + millis - state.rawOffset;
    return state.inDst(y, time) ? state.rawOffset + state.dstSavings : state.rawOffset;
  });
  const same = (a, b) => ['rawOffset', 'useDaylight'].every(k => a[k] === b[k]) && (!a.useDaylight || ['dstSavings', 'startMode', 'startMonth', 'startDay', 'startDayOfWeek', 'startTime', 'startTimeMode', 'endMode', 'endMonth', 'endDay', 'endDayOfWeek', 'endTime', 'endTimeMode', 'startYear'].every(k => a[k] === b[k]));
  def(SIMPLE, 'hasSameRules', `(${ZONE})Z`, (r, _m, [self, other]) => (other === null ? 0 : self.ref === other.ref ? 1 : r.object(other).stz && same(rules(r, self), r.object(other).stz) ? 1 : 0));
  def(SIMPLE, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => (other === null ? 0 : self.ref === other.ref ? 1 : r.object(other).stz && r.object(other).tzId === r.object(self).tzId && same(rules(r, self), r.object(other).stz) ? 1 : 0));
  def(SIMPLE, 'hashCode', '()I', (r, _m, [self]) => { const s = rules(r, self); return s.startMonth ^ s.startDay ^ s.startDayOfWeek ^ s.startTime ^ s.endMonth ^ s.endDay ^ s.endDayOfWeek ^ s.endTime ^ s.rawOffset; });
  def(SIMPLE, 'clone', `()${OBJECT}`, (r, _m, [self]) => { const copy = r.allocate(SIMPLE); r.object(copy).stz = rules(r, self).copy(); r.object(copy).tzId = r.object(self).tzId; return copy; });
  def(SIMPLE, 'setID', `(${STRING})V`, (r, _m, [self, name]) => { const state = rules(r, self); state.id = id(r, name); r.object(self).tzId = state.id; zones().set(state.id, state); });
  def(SIMPLE, 'toString', `()${STRING}`, (r, _m, [self]) => {
    const s = rules(r, self);
    return `java.util.SimpleTimeZone[id=${s.id},offset=${s.rawOffset},dstSavings=${s.dstSavings},useDaylight=${s.useDaylight},startYear=${s.startYear},startMode=${s.startMode},startMonth=${s.startMonth},startDay=${s.startDay},startDayOfWeek=${s.startDayOfWeek},startTime=${s.startTime},startTimeMode=${s.startTimeMode},endMode=${s.endMode},endMonth=${s.endMonth},endDay=${s.endDay},endDayOfWeek=${s.endDayOfWeek},endTime=${s.endTime},endTimeMode=${s.endTimeMode}]`;
  });
  return { ...registry };
}
