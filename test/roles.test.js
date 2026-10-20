'use strict'

const { deriveRoles } = require('../dist/roles')

function fakeAms() {
  const calls = []
  return {
    calls,
    async getAuthorizations({ policies, tenant }) {
      calls.push({ policies: [...policies], tenant })
      return {
        getPotentialActions: () => new Set(['BookingAgent', 'any', 'Viewer']),
        checkPrivilege: (role) => ({ isGranted: () => role !== 'BookingAgent' }),
      }
    },
  }
}

describe('deriveRoles', () => {
  test('drops pseudo roles and marks conditional grants', async () => {
    const ams = fakeAms()
    const memo = new Map()
    const roles = await deriveRoles(ams, 'tid', ['cap.B', 'cap.A'], memo)
    expect(roles).toEqual([
      { role: 'BookingAgent', conditional: true },
      { role: 'Viewer', conditional: false },
    ])
    expect(ams.calls[0].policies).toEqual(['cap.A', 'cap.B'])
  })

  test('evaluates one policy set once', async () => {
    const ams = fakeAms()
    const memo = new Map()
    await deriveRoles(ams, undefined, ['cap.A'], memo)
    await deriveRoles(ams, undefined, ['cap.A'], memo)
    expect(ams.calls).toHaveLength(1)
  })
})
