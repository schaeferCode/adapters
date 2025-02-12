import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand
} from '@aws-sdk/client-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'

import { DynamoDBAdapter, TEN_MINUTES_IN_SECONDS } from '.'

const dbMock = mockClient(DynamoDBClient)

describe('DynamoDBAdapter', () => {
  const mockConfig = {
    endpoint: 'http://localhost:8000', // default mock endpoint
    accessKeyId: 'accessKeyId',
    secretAccessKey: 'secretAccessKey',
    region: 'region',
    tableName: 'testTable'
  }

  let DBAdapter: DynamoDBAdapter

  beforeEach(() => {
    DBAdapter = new DynamoDBAdapter(mockConfig)
    dbMock.reset()
    vi.useFakeTimers()
    const date = new Date(2000, 1, 1, 13)
    vi.setSystemTime(date)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('saveRecord', () => {
    it('should save a record successfully', async () => {
      const record = {
        displayName: 'testUser',
        s3Key: 'testKey'
      }

      dbMock.on(PutItemCommand).resolves({})

      await DBAdapter.saveRecord(record)

      expect(dbMock.calls()).toHaveLength(1)
      const input = dbMock.calls()[0].args[0].input as PutItemCommand['input']
      expect(input).toEqual({
        TableName: mockConfig.tableName,
        Item: {
          displayName: { S: record.displayName },
          s3Key: { S: record.s3Key },
          timestamp: { N: String(Math.floor(Date.now() / 1000)) },
          dontReturnUntil: {
            N: String(Math.floor(Date.now() / 1000) + TEN_MINUTES_IN_SECONDS)
          }
        }
      })
    })

    it('should throw an error if hasVerifiedX is true and xLink is not provided', async () => {
      const record = {
        displayName: 'testUser',
        s3Key: 'testKey',
        hasVerifiedX: true
      }

      await expect(DBAdapter.saveRecord(record)).rejects.toThrow(
        'xLink must be provided if hasVerifiedX is true'
      )
    })

    it('should throw an error if xLink is provided and hasVerifiedX is false', async () => {
      const record = {
        displayName: 'testUser',
        s3Key: 'testKey',
        xLink: 'testLink'
      }

      await expect(DBAdapter.saveRecord(record)).rejects.toThrow(
        'hasVerifiedX must be true if xLink is provided'
      )
    })

    it('should set dontReturnUntil to at least 10 minutes from now if not provided', async () => {
      const record = {
        displayName: 'testUser',
        s3Key: 'testKey'
      }

      await DBAdapter.saveRecord(record)

      const input = dbMock.calls()[0].args[0].input as PutItemCommand['input']
      const dontReturnUntil = Number(input.Item?.dontReturnUntil.N) || 0
      const currentTimePlus10Minutes =
        Math.floor(Date.now() / 1000) + TEN_MINUTES_IN_SECONDS

      expect(dontReturnUntil === currentTimePlus10Minutes).toBe(true)
    })

    it('should use provided dontReturnUntil if it is at least 10 minutes from now', async () => {
      const record = {
        displayName: 'testUser',
        s3Key: 'testKey',
        dontReturnUntil:
          Math.floor(Date.now() / 1000) + TEN_MINUTES_IN_SECONDS + 60 // plus 60 seconds
      }

      await DBAdapter.saveRecord(record)

      const input = dbMock.calls()[0].args[0].input as PutItemCommand['input']
      const dontReturnUntil = Number(input.Item?.dontReturnUntil.N)

      expect(dontReturnUntil).toBe(record.dontReturnUntil)
    })

    it('should overwrite dontReturnUntil if it is less than 10 min from now', async () => {
      const record = {
        displayName: 'testUser',
        s3Key: 'testKey',
        dontReturnUntil:
          Math.floor(Date.now() / 1000) + TEN_MINUTES_IN_SECONDS + 120 // minus 120 seconds
      }

      await DBAdapter.saveRecord(record)

      const input = dbMock.calls()[0].args[0].input as PutItemCommand['input']
      const expectedDontReturnUntil = Number(input.Item?.dontReturnUntil.N)

      expect(expectedDontReturnUntil).toBe(record.dontReturnUntil)
    })
  })

  describe('queryRecords', () => {
    it('should query records based on displayName', async () => {
      const date = new Date(2000, 1, 1, 13, 0)
      vi.setSystemTime(date)

      const query = {
        displayName: 'testUser'
      }

      dbMock.on(QueryCommand).resolves({
        Items: [
          {
            displayName: { S: 'testUser' },
            s3Key: { S: 'testKey' },
            timestamp: { N: String(Math.floor(Date.now() / 1000)) },
            dontReturnUntil: {
              N: String(Math.floor(Date.now() / 1000) + TEN_MINUTES_IN_SECONDS)
            },
            hasVerifiedX: { BOOL: false },
            isVerifiedUser: { BOOL: false }
          }
        ]
      })

      const futureQueryDate = new Date(2000, 1, 1, 13, 10) // 10 min after time of item timestamp
      vi.setSystemTime(futureQueryDate)

      const records = await DBAdapter.queryRecords(query)

      expect(records).toHaveLength(1)
      expect(records[0].displayName).toBe('testUser')
    })

    it('should filter out records that should not be returned yet', async () => {
      const date = new Date(2000, 1, 1, 13, 0)
      vi.setSystemTime(date)

      const query = {
        displayName: 'testUser'
      }

      dbMock.on(QueryCommand).resolves({
        Items: [
          {
            displayName: { S: 'testUser' },
            s3Key: { S: 'testKey' },
            timestamp: { N: String(Math.floor(Date.now() / 1000)) },
            dontReturnUntil: {
              N: String(
                Math.floor(Date.now() / 1000) + 2 * TEN_MINUTES_IN_SECONDS // 20 min after current time
              )
            },
            hasVerifiedX: { BOOL: false },
            isVerifiedUser: { BOOL: false }
          }
        ]
      })

      const futureQueryDate = new Date(2000, 1, 1, 13, 10) // 10 min after time of item timestamp
      vi.setSystemTime(futureQueryDate)

      const records = await DBAdapter.queryRecords(query)

      expect(records).toHaveLength(0)
    })

    it('should query records with hasVerifiedX filter', async () => {
      const query = {
        displayName: 'testUser',
        hasVerifiedX: true
      }

      dbMock.on(QueryCommand).resolves({
        Items: [
          {
            displayName: { S: 'testUser' },
            s3Key: { S: 'testKey' },
            timestamp: { S: new Date().toISOString() },
            dontReturnUntil: { S: new Date().toISOString() },
            hasVerifiedX: { BOOL: true },
            isVerifiedUser: { BOOL: false }
          }
        ]
      })

      const records = await DBAdapter.queryRecords(query)

      expect(records).toHaveLength(1)
      expect(records[0].hasVerifiedX).toBe(true)
    })

    it('should filter out unverified users if isVerifiedUser is true', async () => {
      const query = {
        displayName: 'testUser',
        isVerifiedUser: true
      }

      dbMock.on(QueryCommand).resolves({
        Items: [
          {
            displayName: { S: 'testUser' },
            s3Key: { S: 'testKey' },
            timestamp: { S: new Date().toISOString() },
            dontReturnUntil: { S: new Date().toISOString() },
            hasVerifiedX: { BOOL: false },
            isVerifiedUser: { BOOL: false }
          }
        ]
      })

      const records = await DBAdapter.queryRecords(query)

      expect(records).toHaveLength(0)
    })
  })
})

//       await DBAdapter.saveRecord(record)

//       const params = mockClient.send.mock.calls[0][0].input
//       const dontReturnUntil = params.Item.dontReturnUntil.S

//       expect(dontReturnUntil).toBe(record.dontReturnUntil)
//     })
//   })
// })
