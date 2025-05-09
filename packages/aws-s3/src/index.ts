import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  S3ClientConfig,
  HeadBucketCommand,
  CreateBucketCommand
} from '@aws-sdk/client-s3'

export type UploadResult = {
  etag: string | undefined
}

export interface IBucketAdapter {
  upload: ({
    key,
    body
  }: {
    key: string
    body: string
  }) => Promise<UploadResult>
  get: ({ key }: { key: string }) => Promise<string | undefined>
}

class S3Adapter implements IBucketAdapter {
  private s3: S3Client
  private bucket: string

  constructor({
    endpoint,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
    bucket
  }: {
    endpoint: string
    accessKeyId: string
    secretAccessKey: string
    forcePathStyle: boolean // only 'true' for MinIO use
    bucket: string
  }) {
    const clientConfig: S3ClientConfig = {
      endpoint,
      region: 'us-east-1', // Define your region here or pass it as an argument
      credentials: {
        accessKeyId,
        secretAccessKey
      },
      forcePathStyle
    }

    this.s3 = new S3Client(clientConfig)
    this.bucket = bucket
  }

  // Function to check if the bucket exists
  // TODO: Add tests
  private async checkBucketExists(): Promise<boolean> {
    const headBucketCommand = new HeadBucketCommand({
      Bucket: this.bucket
    })
    await this.s3.send(headBucketCommand)
    return true
  }

  // Function to create the bucket if it doesn't exist
  // TODO: Add tests
  private async createBucket(): Promise<void> {
    const createBucketCommand = new CreateBucketCommand({
      Bucket: this.bucket
    })
    await this.s3.send(createBucketCommand)
    console.log(`Bucket "${this.bucket}" created successfully!`)
  }

  // Function to ensure the bucket exists or create it
  // TODO: Add tests
  async ensureBucketExists() {
    const exists = await this.checkBucketExists()
    if (!exists) {
      await this.createBucket()
    }
  }

  async upload({ body, key }: { key: string; body: string }) {
    const uploadCommand = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body
    })

    const { ETag } = await this.s3.send(uploadCommand)

    return {
      etag: ETag
    }
  }

  async get({ key }: { key: string }) {
    const getCommand = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    })

    const { Body } = await this.s3.send(getCommand)

    return await Body?.transformToString()
  }
}

export default S3Adapter
