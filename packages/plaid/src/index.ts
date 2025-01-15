import { randomUUID } from 'crypto'
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products
} from 'plaid'

export type Holding = {
  ticker?: string
  quantity: number
  costBasis?: number
  currencyCode: string
}

export interface FinTechAdapter {
  getHoldings: ({ accessToken }: { accessToken: string }) => Promise<Holding[]>
}

export interface IPlaidAdapter extends FinTechAdapter {
  getLinkToken: ({ userId }: { userId?: string }) => Promise<string>
  getAccessToken: ({ publicToken }: { publicToken: string }) => Promise<string>
}

class PlaidAdapter implements IPlaidAdapter {
  private plaidClient: PlaidApi
  private appName = 'YOST'

  constructor({
    basePath,
    clientId,
    clientSecret
  }: {
    basePath?: string
    clientId: string
    clientSecret: string
  }) {
    const config = new Configuration({
      basePath: PlaidEnvironments[basePath || 'sandbox'], // Use "development" or "production" for live
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': clientId,
          'PLAID-SECRET': clientSecret
        }
      }
    })

    this.plaidClient = new PlaidApi(config)
  }

  async getLinkToken({ userId = randomUUID() }: { userId?: string }) {
    const linkTokenResponse = await this.plaidClient.linkTokenCreate({
      user: {
        client_user_id: userId
      },
      client_name: this.appName,
      products: [Products.Investments],
      language: 'en',
      country_codes: [CountryCode.Us]
    })
    return linkTokenResponse.data.link_token
  }

  async getAccessToken({ publicToken }: { publicToken: string }) {
    const tokenResponse = await this.plaidClient.itemPublicTokenExchange({
      public_token: publicToken
    })
    return tokenResponse.data.access_token
  }

  async getHoldings({
    accessToken
  }: {
    accessToken: string
  }): Promise<Holding[]> {
    const {
      data: { holdings, securities }
    } = await this.plaidClient.investmentsHoldingsGet({
      access_token: accessToken
    })

    return holdings.map(
      ({
        security_id,
        iso_currency_code,
        unofficial_currency_code,
        quantity,
        cost_basis
      }) => {
        const security = securities.find(
          (sec) => sec.security_id === security_id
        )
        // should never be undefined or null
        const currencyCode = iso_currency_code
          ? iso_currency_code
          : unofficial_currency_code
        return {
          ticker: security?.ticker_symbol || undefined,
          quantity: quantity,
          costBasis: cost_basis || undefined,
          currencyCode: currencyCode!
        }
      }
    )
  }
}

export default PlaidAdapter
