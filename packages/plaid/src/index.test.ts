import { describe, it, expect, vi, beforeEach } from 'vitest'
import PlaidAdapter from '.'
import { PlaidApi } from 'plaid'

vi.mock('plaid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('plaid')>()
  return {
    ...actual,
    PlaidApi: vi.fn().mockImplementation(() => ({
      linkTokenCreate: vi.fn().mockResolvedValue({
        data: { link_token: 'mocked-link-token' }
      }),
      itemPublicTokenExchange: vi.fn().mockResolvedValue({
        data: { access_token: 'mocked-access-token' }
      }),
      investmentsHoldingsGet: vi.fn().mockResolvedValue({
        data: {
          holdings: [
            {
              security_id: '1',
              iso_currency_code: 'USD',
              quantity: 10,
              cost_basis: 150
            }
          ],
          securities: [
            {
              security_id: '1',
              ticker_symbol: 'AAPL'
            }
          ]
        }
      })
    })) as Partial<PlaidApi>
  }
})

describe('PlaidAdapter', () => {
  let plaidAdapter: PlaidAdapter

  beforeEach(() => {
    plaidAdapter = new PlaidAdapter({
      clientId: 'mock-client-id',
      clientSecret: 'mock-client-secret'
    })
  })

  it('should create a link token', async () => {
    const linkToken = await plaidAdapter.getLinkToken({
      userId: 'test-user-id'
    })
    expect(linkToken).toBe('mocked-link-token')
  })

  it('should exchange a public token for an access token', async () => {
    const accessToken = await plaidAdapter.getAccessToken({
      publicToken: 'mock-public-token'
    })
    expect(accessToken).toBe('mocked-access-token')
  })

  it('should fetch holdings', async () => {
    const holdings = await plaidAdapter.getHoldings({
      accessToken: 'mock-access-token'
    })
    expect(holdings).toEqual([
      {
        ticker: 'AAPL',
        quantity: 10,
        costBasis: 150,
        currencyCode: 'USD'
      }
    ])
  })

  it('should handle missing securities in holdings gracefully', async () => {
    // Override the `investmentsHoldingsGet` mock
    const mockedPlaidApi = plaidAdapter['plaidClient'] as unknown as {
      investmentsHoldingsGet: ReturnType<typeof vi.fn>
    }

    mockedPlaidApi.investmentsHoldingsGet.mockResolvedValueOnce({
      data: {
        holdings: [
          {
            security_id: '2',
            iso_currency_code: 'EUR',
            quantity: 5,
            cost_basis: 200
          }
        ],
        securities: []
      }
    })

    const holdings = await plaidAdapter.getHoldings({
      accessToken: 'mock-access-token'
    })
    expect(holdings).toEqual([
      {
        ticker: undefined,
        quantity: 5,
        costBasis: 200,
        currencyCode: 'EUR'
      }
    ])
  })
})
