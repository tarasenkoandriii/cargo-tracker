import { describe, it, expect, beforeEach } from 'vitest';
import { Pier2PierConnector } from './pier2pier.connector';

/**
 * Minimal HTML fixtures — just enough markup to exercise each parser's
 * selectors and dispatch path. Real pages are far larger; these capture the
 * structural contract each parser depends on.
 */

const KENDO = `
  <div class="timeline--item"><span class="capsule">POL</span>
    <div class="timeline--item-description"><strong>INCHEON</strong></div></div>
  <div class="timeline--item"><span class="capsule">POD</span>
    <div class="timeline--item-description"><strong>GDANSK</strong></div></div>
  <div class="timeline--item-eta">Tue 11-AUG-2026 08:00 PM</div>
  <table><tbody>
    <tr>
      <td class="date"><span class="calendar">Friday, 22-MAY-2026</span><span class="time">02:40 PM</span></td>
      <td><span class="capsule">Vessel Departure</span></td>
      <td class="location"><div><span>INCHEON</span></div><div class="terminal-name">ICT</div></td>
      <td class="vesselVoyage"><a>KUO LONG</a><a>(0XSQ5)</a></td>
    </tr>
  </tbody></table>`;

const MSC = `
  <div class="msc-flow-tracking">
    <div class="msc-flow-tracking__details">
      <span class="msc-flow-tracking__details-heading">Port of Load</span>
      <span class="msc-flow-tracking__details-value">NINGBO</span>
      <span class="msc-flow-tracking__details-heading">Port of Discharge</span>
      <span class="msc-flow-tracking__details-value">GDANSK</span>
    </div>
    <div class="msc-flow-tracking__step">
      <div class="msc-flow-tracking__cell--two"><span class="data-value">10/06/2026</span></div>
      <div class="msc-flow-tracking__cell--three"><span class="data-value">NINGBO</span></div>
      <div class="msc-flow-tracking__cell--four"><span class="data-value">Export received at CY</span></div>
      <div class="msc-flow-tracking__cell--five"><span class="data-value">MSC VESSEL</span></div>
      <div class="msc-flow-tracking__cell--six"><span class="data-value">Terminal A</span></div>
    </div>
    <div class="msc-flow-tracking__step">
      <div class="msc-flow-tracking__cell--two"><span class="data-value">03/08/2026</span></div>
      <div class="msc-flow-tracking__cell--three"><span class="data-value">GDANSK</span></div>
      <div class="msc-flow-tracking__cell--four"><span class="data-value">Estimated Time of Arrival</span></div>
      <div class="msc-flow-tracking__cell--five"><span class="data-value">MSC VESSEL</span></div>
      <div class="msc-flow-tracking__cell--six"><span class="data-value">Terminal B</span></div>
    </div>
  </div>`;

const HAPAG = `
  <table class="hl-tbl"><tbody>
    <tr>
      <td class="strong"><span class="nonEditableContent">Vessel departed</span></td>
      <td><span class="nonEditableContent">NANSHA</span></td>
      <td><span class="nonEditableContent">2026-06-01</span></td>
      <td><span class="nonEditableContent">08:00</span></td>
      <td><span class="nonEditableContent">HL VESSEL</span></td>
      <td><span class="nonEditableContent">V123</span></td>
    </tr>
    <tr>
      <td><span class="nonEditableContent">Vessel arrival</span></td>
      <td><span class="nonEditableContent">GDYNIA</span></td>
      <td><span class="nonEditableContent">2026-08-10</span></td>
      <td><span class="nonEditableContent">06:00</span></td>
      <td><span class="nonEditableContent">HL VESSEL</span></td>
      <td><span class="nonEditableContent">V123</span></td>
    </tr>
  </tbody></table>`;

const MAERSK = `
  <div data-test="track-from-value">NINGBO</div>
  <div data-test="track-to-value">GDANSK</div>
  <ul class="transport-plan__list">
    <li class="transport-plan__list__item" data-test="milestone-complete">
      <div data-test="location-name"><strong>NINGBO</strong></div>
      <div data-test="milestone">Vessel departure<span data-test="milestone-date">10 Mar 2026 08:00</span></div>
    </li>
    <li class="transport-plan__list__item" data-test="milestone-complete">
      <div data-test="location-name"><strong>GDANSK</strong></div>
      <div data-test="milestone">Empty container return<span data-test="milestone-date">26 May 2026 14:00</span></div>
    </li>
  </ul>`;

describe('Pier2PierConnector — markup parsers', () => {
  let c: Pier2PierConnector;
  beforeEach(() => {
    c = new Pier2PierConnector();
  });

  it('Kendo (CMA): parses moves, POL/POD and ETA', () => {
    const r = c.parseForTest(KENDO, 'CMDU');
    expect(r.found).toBe(true);
    expect(r.current_status).toBe('departed');
    expect(r.origin).toBe('INCHEON');
    expect(r.destination).toBe('GDANSK');
    expect(r.eta).toBe('2026-08-11T20:00:00');
    expect(r.carrier?.code).toBe('CMDU');
    expect(r.events.length).toBeGreaterThan(0);
  });

  it('MSC: parses steps, header POL/POD and the estimated-arrival ETA', () => {
    const r = c.parseForTest(MSC);
    expect(r.found).toBe(true);
    expect(r.current_status).toBe('in_origin_terminal');
    expect(r.origin).toBe('NINGBO');
    expect(r.destination).toBe('GDANSK');
    expect(r.eta).toBe('2026-08-03T00:00:00');
    expect(r.carrier).toMatchObject({ name: 'MSC', code: 'MSCU' });
  });

  it('Hapag-Lloyd: actual vs planned rows, origin/destination, ETA', () => {
    const r = c.parseForTest(HAPAG);
    expect(r.found).toBe(true);
    expect(r.current_status).toBe('departed'); // last ACTUAL (bold) move
    expect(r.origin).toBe('NANSHA');
    expect(r.destination).toBe('GDYNIA');
    expect(r.eta).toBe('2026-08-10T06:00:00');
    expect(r.carrier).toMatchObject({ name: 'Hapag-Lloyd', code: 'HLCU' });
  });

  it('Maersk: milestones, carry-forward location, from/to summary', () => {
    const r = c.parseForTest(MAERSK);
    expect(r.found).toBe(true);
    expect(r.current_status).toBe('container_returned');
    expect(r.origin).toBe('NINGBO');
    expect(r.destination).toBe('GDANSK');
    expect(r.carrier).toMatchObject({ name: 'Maersk', code: 'MAEU' });
    expect(r.events).toHaveLength(2);
  });

  it('dispatches to the right parser by iframe markers (carrier identity)', () => {
    expect(c.parseForTest(MSC).carrier?.code).toBe('MSCU');
    expect(c.parseForTest(HAPAG).carrier?.code).toBe('HLCU');
    expect(c.parseForTest(MAERSK).carrier?.code).toBe('MAEU');
  });

  it('returns PARSING_FAILED when no moves can be parsed', () => {
    const r = c.parseForTest('<div class="msc-flow-tracking"></div>');
    expect(r.found).toBe(false);
    expect(r.error?.code).toBe('PARSING_FAILED');
  });
});
