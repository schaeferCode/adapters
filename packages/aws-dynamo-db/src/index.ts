import {
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
  hasVerifiedX: boolean
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
export class DynamoDBAdapter implements IDBAdapter {
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
      params.IndexName = 'HasVerifiedXIndex'
      params.KeyConditionExpression =
        params.KeyConditionExpression + ' AND hasVerifiedX = :hasVerifiedX'
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
