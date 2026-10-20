'use strict'

const cds = require('@sap/cds')

const { GET } = cds.test(__dirname + '/../sample/xflights')
const { syncSnapshot } = require('../dist/sync')
const { rememberPrincipal, resetPrincipalCache } = require('../dist/principals')

const POLICIES = 'sap.ams.mirror.UserPolicies'
const ROLES = 'sap.ams.mirror.UserRoles'
const PRINCIPALS = 'sap.ams.mirror.Principals'
const TENANT = 'undefined'

function fakeAms() {
  return {
    async getAuthorizations({ policies }) {
      const roles = policies.map(p => (p.startsWith('cond.') ? p.slice(5) : p))
      return {
        getPotentialActions: () => new Set(roles),
        checkPrivilege: (role) => ({ isGranted: () => !policies.some(p => p.startsWith('cond.') && p.endsWith(role)) }),
      }
    },
  }
}

async function rolesOf(scimId, tenant = TENANT) {
  const rows = await cds.run(SELECT.from(ROLES).where({ tenant, scimId }))
  return rows.map(r => r.role).sort()
}

async function waitFor(fn, timeout = 15000) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    last = await fn()
    if (last) return last
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('timed out waiting for ' + last)
}

function auth(username) {
  return { auth: { username, password: '' } }
}

describe('xflights role mirror', () => {
  test('mocked users are mirrored, including roles that bypass AMS', async () => {
    await waitFor(async () => (await rolesOf('alice')).includes('BookingAgent'))
    const alice = await rolesOf('alice')
    expect(alice).toContain('BookingAgent')
    expect(alice).toContain('DutyManager')
    expect(alice).not.toContain('Viewer')
    const bob = await rolesOf('bob')
    expect(bob).toContain('Viewer')
    expect(bob).not.toContain('BookingAgent')

    const carol = await cds.run(SELECT.one.from(ROLES).where({ tenant: TENANT, scimId: 'carol', role: 'BookingAgent' }))
    expect(carol).toBeTruthy()
    expect(Boolean(carol.conditional)).toBe(true)

    const alicePrincipal = await cds.run(SELECT.one.from(PRINCIPALS).where({ tenant: TENANT, scimId: 'alice' }))
    expect(alicePrincipal.userId).toBe('alice')
  })

  test('hideBook is a joined flag for the current user', async () => {
    await waitFor(async () => (await rolesOf('alice')).includes('BookingAgent'))

    const alice = await GET('/flights/Flights?$select=carrid,connid,hideBook&$orderby=carrid', auth('alice'))
    expect(alice.status).toBe(200)
    expect(alice.data.value).toHaveLength(2)
    expect(alice.data.value.every(f => f.hideBook === false)).toBe(true)

    const bob = await GET('/flights/Flights?$filter=hideBook eq true&$select=carrid', auth('bob'))
    expect(bob.status).toBe(200)
    expect(bob.data.value.map(f => f.carrid).sort()).toEqual(['LH', 'UA'])

    const grouped = await GET('/flights/Flights?$apply=groupby((hideBook),aggregate($count as n))', auth('bob'))
    expect(grouped.status).toBe(200)
    expect(grouped.data.value).toEqual([{ hideBook: true, n: 2 }])
  })

  test('an older snapshot does not overwrite a newer one', async () => {
    const ams = fakeAms()
    const tenant = 't-stale'
    const newer = new Date('2024-02-02T00:00:00Z')
    const older = new Date('2024-01-01T00:00:00Z')

    const first = await syncSnapshot({
      ams,
      assignments: { [tenant]: { u: ['keep'] } },
      dcnToken: 'new',
      fetchedAt: newer,
    })
    expect(first[0].skipped).toBeUndefined()

    const second = await syncSnapshot({
      ams,
      assignments: { [tenant]: { u: ['drop-me'] } },
      dcnToken: 'old',
      fetchedAt: older,
    })
    expect(second.find(r => r.tenant === tenant).skipped).toBe('stale')

    const rows = await cds.run(SELECT.from(POLICIES).where({ tenant }))
    expect(rows.map(r => r.policy)).toEqual(['keep'])
  })

  test('a newer identical snapshot blocks an older different one', async () => {
    const ams = fakeAms()
    const tenant = 't-bump'
    await syncSnapshot({
      ams,
      assignments: { [tenant]: { u: ['v1'] } },
      dcnToken: 'same',
      fetchedAt: new Date('2024-01-01T00:00:00Z'),
    })
    const again = await syncSnapshot({
      ams,
      assignments: { [tenant]: { u: ['v1'] } },
      dcnToken: 'same',
      fetchedAt: new Date('2024-03-03T00:00:00Z'),
    })
    expect(again.find(r => r.tenant === tenant).skipped).toBe('hash')

    await syncSnapshot({
      ams,
      assignments: { [tenant]: { u: ['v-between'] } },
      dcnToken: 'other',
      fetchedAt: new Date('2024-02-02T00:00:00Z'),
    })
    const rows = await cds.run(SELECT.from(POLICIES).where({ tenant }))
    expect(rows.map(r => r.policy)).toEqual(['v1'])
  })

  test('parallel writers leave the newer snapshot', async () => {
    const ams = fakeAms()
    const tenant = 't-parallel'
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
    const rows = await cds.run(SELECT.from(POLICIES).where({ tenant }))
    expect(rows.map(r => r.policy)).toEqual(['new'])
  })

  test('diff removes policies that left the bundle and keeps the rest', async () => {
    const ams = fakeAms()
    const tenant = 't-diff'
    await syncSnapshot({
      ams,
      assignments: { [tenant]: { a: ['p1', 'p2'], b: ['p3'] } },
      dcnToken: '1',
      fetchedAt: new Date('2024-01-01T00:00:00Z'),
    })
    await syncSnapshot({
      ams,
      assignments: { [tenant]: { a: ['p2'] } },
      dcnToken: '1',
      fetchedAt: new Date('2024-01-02T00:00:00Z'),
    })
    const rows = await cds.run(SELECT.from(POLICIES).where({ tenant }))
    expect(rows.map(r => r.scimId + ':' + r.policy).sort()).toEqual(['a:p2'])
  })

  test('an assignment refresh re-syncs through the plugin', async () => {
    await waitFor(async () => (await rolesOf('bob')).includes('Viewer'))
    const runtime = require(require.resolve('@sap/ams/src/cap/env/amsPluginRuntime.js', {
      paths: [__dirname + '/../sample/xflights', __dirname + '/..'],
    }))
    const next = Object.create(null)
    next[Symbol.for('ams-roles-test')] = { alice: ['cap.Viewer'] }
    runtime.ams.bundleLoader.emit('assignmentsChanged', next)

    await waitFor(async () => {
      const policies = await cds.run(SELECT.from(POLICIES).where({ tenant: TENANT }))
      return policies.length === 1 && policies[0].scimId === 'alice' && policies[0].policy === 'cap.Viewer'
    })
    const alice = await rolesOf('alice')
    expect(alice).toContain('Viewer')
    expect(alice).toContain('DutyManager')
    expect(alice).not.toContain('BookingAgent')
  })

  test('principal capture writes a new pair once', async () => {
    resetPrincipalCache()
    const user = { id: 'sub-1', authInfo: { token: { scimId: 'scim-1', appTid: 'tid-1' } } }
    expect(await rememberPrincipal(user, 60 * 60 * 1000)).toBe(true)
    await cds.run(UPDATE(PRINCIPALS).set({ lastSeen: new Date(0) }).where({ tenant: 'tid-1', scimId: 'scim-1' }))
    expect(await rememberPrincipal(user, 60 * 60 * 1000)).toBe(false)
    const row = await cds.run(SELECT.one.from(PRINCIPALS).where({ tenant: 'tid-1', scimId: 'scim-1' }))
    expect(row.userId).toBe('sub-1')
    expect(new Date(row.lastSeen).getTime()).toBe(0)

    expect(await rememberPrincipal({ id: 'anonymous' }, 1)).toBe(false)
  })
})
