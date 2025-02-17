import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  QueryCommandInput
} from '@aws-sdk/client-dynamodb'

export type DBRecord = {
  displayName: string
  s3Key: string
  timestamp: number // unix in seconds
  dontReturnUntil: number // unix in seconds
  hasVerifiedX?: boolean
  isVerifiedUser?: boolean
  xLink?: string
}

export const TEN_MINUTES_IN_SECONDS = 10 * 60

type SaveRecordParams = {
  displayName: string
  s3Key: string
  hasVerifiedX?: boolean
  dontReturnUntil?: number
  isVerifiedUser?: boolean
  xLink?: string
}

type QueryRecordsParams = {
  displayName: string
  isVerifiedUser?: boolean
  hasVerifiedX?: boolean
}

interface IDBAdapter {
  saveRecord: (record: SaveRecordParams) => Promise<void>

  queryRecords: (query: QueryRecordsParams) => Promise<DBRecord[]>
}

/**
 * Adapter for DynamoDB
 */
export default class DynamoDBAdapter implements IDBAdapter {
  private client: DynamoDBClient
  private tableName: string

  constructor({
    accessKeyId,
    secretAccessKey,
    region,
    tableName,
    endpoint
  }: {
    tableName: string
    accessKeyId: string
    secretAccessKey: string
    region: string
    endpoint: string
  }) {
    this.client = new DynamoDBClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      },
      endpoint
    })
    this.tableName = tableName
  }

  /**
   * Checks if the DynamoDB table exists, and creates it if it doesn't.
   *
   * TODO: create tests for this
   * TODO: add try/catch or let the consumer catch and process errors? Maybe add try/catches here and normalize them before throwing them again
   */
  async checkAndCreateTable() {
    // Check if table exists
    try {
      const { Table } = await this.client.send(
        new DescribeTableCommand({ TableName: this.tableName })
      )
      console.log(`Table ${this.tableName} already exists.`)
      return Table
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'ResourceNotFoundException'
      ) {
        // Create the table if it doesn't exist
        console.log(`Table ${this.tableName} not found. Creating it...`)

        await this.client.send(
          new CreateTableCommand({
            TableName: this.tableName,
            AttributeDefinitions: [
              { AttributeName: 'displayName', AttributeType: 'S' },
              { AttributeName: 'timestamp', AttributeType: 'N' }
            ],
            KeySchema: [
              { AttributeName: 'displayName', KeyType: 'HASH' },
              { AttributeName: 'timestamp', KeyType: 'RANGE' }
            ],
            BillingMode: 'PAY_PER_REQUEST' // Use on-demand for more flexibility
          })
        )
        console.log(`Table ${this.tableName} created successfully.`)

        // Return the newly created table info (optional)
        return this.client.send(
          new DescribeTableCommand({ TableName: this.tableName })
        )
      }
      throw error
    }
  }

  /**
   * Saves a record to DynamoDB
   */
  async saveRecord({
    displayName,
    s3Key,
    dontReturnUntil,
    hasVerifiedX = false,
    isVerifiedUser = false,
    xLink = undefined
  }: SaveRecordParams) {
    if (hasVerifiedX && !xLink) {
      throw new Error('xLink must be provided if hasVerifiedX is true')
    }
    if (xLink && !hasVerifiedX) {
      throw new Error('hasVerifiedX must be true if xLink is provided')
    }

    const currentTimeInSeconds = Math.floor(Date.now() / 1000)
    const minDontReturnUntil = currentTimeInSeconds + TEN_MINUTES_IN_SECONDS

    // ensure dontReturnUntil is at least 10 minutes from now
    if (!dontReturnUntil || dontReturnUntil < minDontReturnUntil) {
      dontReturnUntil = minDontReturnUntil
    }

    const params = {
      TableName: this.tableName,
      Item: {
        displayName: { S: displayName },
        s3Key: { S: s3Key },
        timestamp: { N: String(currentTimeInSeconds) },
        dontReturnUntil: { N: String(dontReturnUntil) },
        ...(isVerifiedUser && {
          isVerifiedUser: { BOOL: isVerifiedUser }
        }),
        ...(hasVerifiedX && {
          hasVerifiedX: { BOOL: hasVerifiedX }
        }),
        ...(xLink && { xLink: { S: xLink } })
      }
    }

    await this.client.send(new PutItemCommand(params))
  }

  /**
   * Queries records based on displayName and optional verification filters.
   */
  async queryRecords({
    displayName,
    isVerifiedUser,
    hasVerifiedX
  }: QueryRecordsParams): Promise<DBRecord[]> {
    const currentTimeInSeconds = Math.floor(Date.now() / 1000)

    // dontreturnuntil > currenttime
    const params: QueryCommandInput = {
      TableName: this.tableName,
      KeyConditionExpression: 'displayName = :displayName',
      // TODO: use FilterExpression; not working right now
      // FilterExpression: 'dontReturnUntil >= :currentTime', // filter out records that should not be returned yet
      ExpressionAttributeValues: {
        // ':currentTime': { N: String(currentTimeInSeconds) },
        ':displayName': { S: displayName }
      }
    }

    if (hasVerifiedX) {
      // params.IndexName = 'HasVerifiedXIndex'
      params.FilterExpression = 'hasVerifiedX = :hasVerifiedX'
      params.ExpressionAttributeValues = params.ExpressionAttributeValues || {} // make TS happy
      params.ExpressionAttributeValues[':hasVerifiedX'] = { BOOL: true }
    }

    // Perform the query
    const data = await this.client.send(new QueryCommand(params))

    const records = (data.Items || [])
      .map((item) => ({
        displayName: item.displayName.S || '',
        s3Key: item.s3Key.S || '',
        timestamp: Number(item.timestamp?.N) || 0,
        dontReturnUntil: Number(item.dontReturnUntil?.N) || 0,
        hasVerifiedX: item.hasVerifiedX?.BOOL ?? false,
        isVerifiedUser: item.isVerifiedUser?.BOOL ?? false,
        xLink: item.xLink?.S || ''
      }))
      .filter((item) => item.dontReturnUntil <= currentTimeInSeconds)

    return isVerifiedUser ? records.filter((r) => r.isVerifiedUser) : records
  }
}
