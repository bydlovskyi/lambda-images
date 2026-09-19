# Architecture diagrams

All diagrams are Mermaid and render natively on GitHub. Values (timeouts, retention, limits) mirror
`lib/image-processing-stack.ts` and are pinned by `test/stack.test.ts`.

## System overview

```mermaid
graph TB
    Client[Browser / API client]

    subgraph API["API Gateway (HTTP API)"]
        Upload[POST /upload]
        Status[GET /status]
    end

    subgraph Compute["Lambda · Node.js 22 · arm64"]
        L1[GetUploadUrl]
        L2[ProcessUpload]
        L3["ResizeImage<br/>Sharp · 1024 MB · 60 s"]
        L4[GetStatus]
    end

    subgraph Storage
        S3U["S3 upload bucket<br/>private · SSE-S3 · TLS only<br/>expires after 7 days"]
        S3P["S3 processed bucket<br/>private · SSE-S3 · TLS only<br/>expires after 7 days"]
        DDB[("DynamoDB<br/>PK imageId · TTL expiresAt")]
    end

    subgraph Queue
        SQS["SQS ImageProcessingQueue<br/>visibility 360 s · batch 1"]
        DLQ["SQS ImageProcessingDLQ<br/>after 3 failed receives"]
        Alarm["CloudWatch alarm → SNS<br/>DLQ not empty"]
    end

    Client -->|1. contentType + size| Upload --> L1
    L1 -->|presigned PUT, 5 min<br/>type + length signed| Client
    Client -->|2. PUT image| S3U
    S3U -->|3. ObjectCreated uploads/| L2
    L2 -->|PutItem status=pending| DDB
    L2 -->|SendMessage| SQS
    SQS -->|4.| L3
    SQS -.->|retries exhausted| DLQ -.-> Alarm
    L3 -->|GetObject| S3U
    L3 -->|PutObject 400×400| S3P
    L3 -->|UpdateItem ok / error| DDB
    Client -->|5. poll| Status --> L4
    L4 -->|GetItem| DDB
    L4 -->|presigned GET, 10 min| Client
    Client -->|6. download| S3P
```

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant API as API Gateway
    participant L1 as GetUploadUrl
    participant S3U as S3 upload
    participant L2 as ProcessUpload
    participant DDB as DynamoDB
    participant Q as SQS
    participant L3 as ResizeImage
    participant S3P as S3 processed
    participant L4 as GetStatus

    C->>API: POST /upload {contentType, contentLength}
    API->>L1: invoke
    L1-->>C: {uploadUrl, imageId, key, expiresIn: 300}
    C->>S3U: PUT uploads/{imageId} (Content-Type + Content-Length must match signature)
    S3U->>L2: ObjectCreated
    L2->>DDB: PutItem {status: pending, expiresAt: now + 7d}
    L2->>Q: SendMessage {imageId, bucket, key}
    Q->>L3: receive (batch 1)
    L3->>S3U: GetObject
    L3->>L3: sharp.rotate().resize(400, 400, cover)
    alt image decodes
        L3->>S3P: PutObject processed/{imageId}
        L3->>DDB: UpdateItem {status: ok, processedKey, processedAt}
    else corrupt / unsupported / too many pixels
        L3->>DDB: UpdateItem {status: error, errorMessage}
        Note over L3,Q: message acknowledged — retrying cannot help
    else S3 / DynamoDB failure
        L3->>DDB: UpdateItem {status: error} (best effort)
        L3-->>Q: throw → redelivered, DLQ after 3 attempts
    end
    loop every 2 s
        C->>API: GET /status?imageId=…
        API->>L4: invoke
        L4->>DDB: GetItem
        L4-->>C: {status, downloadUrl?, errorMessage?}
    end
    C->>S3P: GET downloadUrl (presigned, 10 min)
```

## Record lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending: ProcessUpload · PutItem
    pending --> ok: ResizeImage · image stored
    pending --> error: ResizeImage · decode failed or infra failure
    ok --> [*]: TTL (7 days) · DynamoDB deletes item,<br/>S3 lifecycle deletes both objects
    error --> [*]: TTL (7 days)
```

## IAM grants (least privilege)

| Function       | S3 upload bucket        | S3 processed bucket       | DynamoDB      | SQS            |
| -------------- | ----------------------- | ------------------------- | ------------- | -------------- |
| GetUploadUrl   | `PutObject uploads/*`   | —                         | —             | —              |
| ProcessUpload  | — (event source only)   | —                         | write         | `SendMessage`  |
| ResizeImage    | `GetObject uploads/*`   | `PutObject processed/*`   | write         | consume        |
| GetStatus      | —                       | `GetObject processed/*`   | read          | —              |
