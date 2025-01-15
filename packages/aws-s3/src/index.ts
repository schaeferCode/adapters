import AWS from 'aws-sdk'
const s3 = new AWS.S3()

export function uploadFile(bucket: string, key: string, body: string) {
  return s3.upload({ Bucket: bucket, Key: key, Body: body }).promise()
}
