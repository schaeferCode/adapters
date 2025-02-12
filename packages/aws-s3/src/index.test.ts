import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  PutObjectCommandOutput,
  GetObjectCommandOutput
} from '@aws-sdk/client-s3'
import { mockClient } from 'aws-sdk-client-mock'

import S3Adapter, { UploadResult } from '.'

// Mock the S3Client
const s3Mock = mockClient(S3Client)

describe('S3Adapter', () => {
  const mockConfig = {
    endpoint: 'http://localhost:9000', // mock endpoint (e.g., MinIO)
    accessKeyId: 'accessKeyId',
    secretAccessKey: 'secretAccessKey',
    forcePathStyle: true,
    bucket: 'test-bucket'
  }

  let s3Adapter: S3Adapter

  beforeEach(() => {
    s3Adapter = new S3Adapter(mockConfig)
    s3Mock.reset() // Reset the mock before each test
  })

  describe('upload', () => {
    it('should upload a file and return the correct ETag', async () => {
      // Arrange
      const key = 'test-file.txt'
      const body = 'Hello, World!'
      const expectedETag = '"etagValue"' // Mocked value of ETag

      s3Mock
        .on(PutObjectCommand)
        .resolves({ ETag: expectedETag } as PutObjectCommandOutput) // Ensure proper type casting

      // Act
      const result: UploadResult = await s3Adapter.upload({ key, body })

      // Assert
      expect(result.etag).toBe(expectedETag)
      expect(s3Mock.calls()).toHaveLength(1)
      const input = s3Mock.calls()[0].args[0].input as PutObjectCommand['input']
      expect(input.Bucket).toBe(mockConfig.bucket)
      expect(input.Key).toBe(key)
      expect(input.Body).toBe(body)
    })

    it('should throw an error if upload fails', async () => {
      // Arrange
      const key = 'test-file.txt'
      const body = 'Hello, World!'
      const errorMessage = 'Upload failed'
      s3Mock.on(PutObjectCommand).rejects(new Error(errorMessage))

      // Act & Assert
      await expect(s3Adapter.upload({ key, body })).rejects.toThrow(
        errorMessage
      )
    })
  })

  describe('get', () => {
    it('should retrieve a file successfully', async () => {
      // Arrange
      const key = 'test-file.txt'
      const fileContent = 'File content'
      const transformToStringMock = vi.fn()
      transformToStringMock.mockResolvedValue(fileContent)
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: transformToStringMock
        }
      } as unknown as GetObjectCommandOutput) // Ensure proper type casting

      // Act
      const result = await s3Adapter.get({ key })

      // Assert
      expect(result).toBe(fileContent)
      expect(s3Mock.calls()).toHaveLength(1)
      const input = s3Mock.calls()[0].args[0].input as GetObjectCommand['input']
      expect(input.Bucket).toBe(mockConfig.bucket)
      expect(input.Key).toBe(key)
    })

    it('should return undefined if file not found', async () => {
      // Arrange
      const key = 'nonexistent-file.txt'
      s3Mock.on(GetObjectCommand).resolves({
        Body: undefined
      } as unknown as GetObjectCommandOutput)

      // Act
      const result = await s3Adapter.get({ key })

      // Assert
      expect(result).toBeUndefined()
    })
  })
})
