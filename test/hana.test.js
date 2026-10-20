'use strict'

const fs = require('fs')
const path = require('path')

// Opt-in. SQLite treats SELECT FOR UPDATE as a no-op, so the cross-process
// lock is only meaningful on HANA. Without HANA_TEST=1 and a service binding
// this file does not boot a server.
const BINDING = path.resolve(__dirname, '../sample/xflights/default-env.json')
const enabled = process.env.HANA_TEST === '1' && fs.existsSync(BINDING)

if (!enabled) {
  test.skip('HANA lock: set HANA_TEST=1 and provide sample/xflights/default-env.json', () => {})
} else {
  const cds = require('@sap/cds')
  cds.test(__dirname + '/../sample/xflights')
  const { syncSnapshot } = require('../dist/sync')

  test('two writers keep the newer snapshot', async () => {
    const ams = {
      async getAuthorizations({ policies }) {
        return {
          getPotentialActions: () => new Set(policies),
          checkPrivilege: () => ({ isGranted: () => true }),
        }
      },
    }
    const tenant = 'hana-lock'
    await Promise.all([
      syncSnapshot({
        ams,
        assignments: { [tenant]: { u: ['old'] } },
        dcnToken: 'a',
        fetchedAt: new Date('2020-01-01T00:00:00Z'),
      }),
      syncSnapshot({
        ams,
        assignments: { [tenant]: { u: ['new'] } },
        dcnToken: 'b',
        fetchedAt: new Date('2020-01-02T00:00:00Z'),
      }),
    ])
    const rows = await cds.run(SELECT.from('sap.ams.mirror.UserPolicies').where({ tenant }))
    expect(rows.map(r => r.policy)).toEqual(['new'])
  })
}
