'use strict'

const { flattenAssignments, snapshotHash, stableStringify } = require('../dist/hash')

describe('canonical hash', () => {
  test('key order and policy order do not change the hash', () => {
    const a = flattenAssignments({
      t1: { bob: ['cap.Viewer', 'cap.BookingAgent'], alice: ['cap.Viewer'] },
    })
    const b = flattenAssignments({
      t1: { alice: ['cap.Viewer'], bob: ['cap.BookingAgent', 'cap.Viewer'] },
    })
    expect(stableStringify(a)).toBe(stableStringify(b))
    expect(snapshotHash({ assignments: a, dcnToken: 'dcn', extras: [] }))
      .toBe(snapshotHash({ assignments: b, dcnToken: 'dcn', extras: [] }))
  })

  test('a different policy or DCN changes the hash', () => {
    const base = flattenAssignments({ t1: { alice: ['cap.Viewer'] } })
    const other = flattenAssignments({ t1: { alice: ['cap.BookingAgent'] } })
    const h = snapshotHash({ assignments: base, dcnToken: 'dcn', extras: [] })
    expect(snapshotHash({ assignments: other, dcnToken: 'dcn', extras: [] })).not.toBe(h)
    expect(snapshotHash({ assignments: base, dcnToken: 'other', extras: [] })).not.toBe(h)
  })

  test('a Symbol tenant key becomes the undefined-tenant sentinel', () => {
    const raw = Object.create(null)
    raw[Symbol('no-tenant')] = { alice: ['cap.Viewer'] }
    expect(flattenAssignments(raw)).toEqual([
      { tenant: 'undefined', scimId: 'alice', policies: ['cap.Viewer'] },
    ])
  })
})
