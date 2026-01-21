# AWS Image Processing Pipeline - Architecture Diagram

## Interactive Mermaid Diagram

```mermaid
graph TB
    Client[👤 Client/Browser]
    
    subgraph "API Gateway"
        API[HTTP API Gateway<br/>POST /upload<br/>GET /status]
    end
    
    subgraph "Lambda Functions"
        L1[⚡ Lambda 1<br/>GetUploadUrl<br/>Node.js 20.x]
        L2[⚡ Lambda 2<br/>ProcessUpload<br/>Node.js 20.x]
        L3[⚡ Lambda 3<br/>ResizeImage<br/>Node.js 20.x<br/>Sharp Library]
        L4[⚡ Lambda 4<br/>GetStatus<br/>Node.js 20.x]
    end
    
    subgraph "Storage"
        S3Upload[🪣 S3 Bucket 1<br/>Upload Bucket<br/>Private<br/>Encrypted]
        S3Processed[🪣 S3 Bucket 2<br/>Processed Bucket<br/>Private<br/>Encrypted]
    end
    
    subgraph "Queue"
        SQS[📬 SQS Queue<br/>ImageProcessingQueue<br/>Visibility: 300s]
    end
    
    subgraph "Database"
        DDB[(🗄️ DynamoDB<br/>ImageProcessingTable<br/>PK: imageId)]
    end
    
    %% Flow 1: Get Upload URL
    Client -->|1. POST /upload| API
    API -->|Invoke| L1
    L1 -->|Generate presigned URL<br/>300s TTL| S3Upload
    L1 -->|Return uploadUrl + imageId| Client
    
    %% Flow 2: Upload Image
    Client -->|2. PUT image<br/>to presigned URL| S3Upload
    
    %% Flow 3: Process Upload
    S3Upload -->|3. S3 Event<br/>ObjectCreated| L2
    L2 -->|Create record<br/>status: pending| DDB
    L2 -->|Send message<br/>imageId, bucket, key| SQS
    
    %% Flow 4: Resize Image
    SQS -->|4. Trigger<br/>batchSize: 1| L3
    L3 -->|Read original| S3Upload
    L3 -->|Resize 400x400<br/>Sharp| L3
    L3 -->|Store processed| S3Processed
    L3 -->|Update status: ok<br/>processedKey| DDB
    
    %% Flow 5: Get Status
    Client -->|5. GET /status?imageId=xxx| API
    API -->|Invoke| L4
    L4 -->|Query by imageId| DDB
    DDB -->|Return record| L4
    L4 -->|Generate presigned URL<br/>600s TTL| S3Processed
    L4 -->|Return status + downloadUrl| Client
    
    %% Flow 6: Download
    Client -->|6. GET downloadUrl| S3Processed
    S3Processed -->|Return processed image| Client
    
    style Client fill:#e1f5ff
    style L1 fill:#fff4e6
    style L2 fill:#fff4e6
    style L3 fill:#fff4e6
    style L4 fill:#fff4e6
    style S3Upload fill:#e8f5e9
    style S3Processed fill:#e8f5e9
    style SQS fill:#f3e5f5
    style DDB fill:#fce4ec
    style API fill:#e3f2fd
```

## Sequence Diagram

```mermaid
sequenceDiagram
    participant C as Client
    participant API as API Gateway
    participant L1 as Lambda 1<br/>GetUploadUrl
    participant S3U as S3 Upload<br/>Bucket
    participant L2 as Lambda 2<br/>ProcessUpload
    participant DDB as DynamoDB
    participant SQS as SQS Queue
    participant L3 as Lambda 3<br/>ResizeImage
    participant S3P as S3 Processed<br/>Bucket
    participant L4 as Lambda 4<br/>GetStatus
    
    Note over C,L4: Step 1: Get Upload URL
    C->>+API: POST /upload
    API->>+L1: Invoke
    L1->>L1: Generate UUID
    L1->>S3U: Create presigned PUT URL (300s)
    L1-->>-API: uploadUrl, imageId, key
    API-->>-C: Response
    
    Note over C,L4: Step 2: Upload Image
    C->>+S3U: PUT image (presigned URL)
    S3U-->>-C: 200 OK
    
    Note over C,L4: Step 3: Process Upload Event
    S3U->>+L2: S3 Event (ObjectCreated)
    L2->>+DDB: PutItem (status: pending)
    DDB-->>-L2: Success
    L2->>+SQS: SendMessage (imageId, bucket, key)
    SQS-->>-L2: Success
    L2-->>-S3U: Complete
    
    Note over C,L4: Step 4: Resize Image
    SQS->>+L3: Trigger (batchSize: 1)
    L3->>+S3U: GetObject (original)
    S3U-->>-L3: Image buffer
    L3->>L3: Sharp resize (400x400)
    L3->>+S3P: PutObject (processed)
    S3P-->>-L3: Success
    L3->>+DDB: UpdateItem (status: ok, processedKey)
    DDB-->>-L3: Success
    L3-->>-SQS: Delete message
    
    Note over C,L4: Step 5: Check Status (Polling)
    C->>+API: GET /status?imageId=xxx
    API->>+L4: Invoke
    L4->>+DDB: GetItem (imageId)
    DDB-->>-L4: Record (status: ok)
    L4->>S3P: Create presigned GET URL (600s)
    L4-->>-API: status, downloadUrl, timestamps
    API-->>-C: Response
    
    Note over C,L4: Step 6: Download Processed Image
    C->>+S3P: GET downloadUrl (presigned)
    S3P-->>-C: Processed image (400x400)
```

## Component Diagram

```mermaid
graph LR
    subgraph "Client Layer"
        Browser[Web Browser<br/>HTML + JavaScript<br/>TailwindCSS]
    end
    
    subgraph "API Layer"
        APIGW[API Gateway HTTP API<br/>CORS Enabled<br/>Endpoints: /upload, /status]
    end
    
    subgraph "Compute Layer"
        Lambda1[Lambda 1: GetUploadUrl<br/>Runtime: Node.js 20.x<br/>Timeout: 30s<br/>Memory: 128 MB]
        Lambda2[Lambda 2: ProcessUpload<br/>Runtime: Node.js 20.x<br/>Timeout: 30s<br/>Memory: 128 MB]
        Lambda3[Lambda 3: ResizeImage<br/>Runtime: Node.js 20.x<br/>Timeout: 300s<br/>Memory: 1024 MB<br/>Library: Sharp]
        Lambda4[Lambda 4: GetStatus<br/>Runtime: Node.js 20.x<br/>Timeout: 30s<br/>Memory: 128 MB]
    end
    
    subgraph "Storage Layer"
        S3Upload[S3 Upload Bucket<br/>Private + Encrypted<br/>Lifecycle: 7 days<br/>CORS: PUT, POST]
        S3Processed[S3 Processed Bucket<br/>Private + Encrypted<br/>Lifecycle: 90 days]
    end
    
    subgraph "Queue Layer"
        Queue[SQS Queue<br/>Visibility: 300s<br/>Retention: 4 days<br/>Batch: 1]
    end
    
    subgraph "Database Layer"
        Table[DynamoDB Table<br/>PK: imageId<br/>Billing: On-Demand<br/>Attributes: status, keys, timestamps]
    end
    
    Browser <--> APIGW
    APIGW --> Lambda1
    APIGW --> Lambda4
    Lambda1 --> S3Upload
    S3Upload --> Lambda2
    Lambda2 --> Table
    Lambda2 --> Queue
    Queue --> Lambda3
    Lambda3 --> S3Upload
    Lambda3 --> S3Processed
    Lambda3 --> Table
    Lambda4 --> Table
    Lambda4 --> S3Processed
```

## State Diagram (Image Processing Status)

```mermaid
stateDiagram-v2
    [*] --> Uploading: User requests upload URL
    Uploading --> Pending: Image uploaded to S3
    Pending --> Processing: SQS triggers Lambda3
    Processing --> OK: Resize successful
    Processing --> Error: Resize failed
    OK --> Downloaded: User downloads processed image
    Error --> [*]: Manual intervention required
    Downloaded --> [*]: Complete
    
    note right of Uploading
        Lambda1: Generate presigned URL
        Client: PUT to S3
    end note
    
    note right of Pending
        Lambda2: Create DynamoDB record
        Status: "pending"
    end note
    
    note right of Processing
        Lambda3: Resize to 400x400
        Sharp library processing
    end note
    
    note right of OK
        DynamoDB: status = "ok"
        Lambda4: Return downloadUrl
    end note
    
    note right of Error
        DynamoDB: status = "error"
        errorMessage stored
    end note
```

## Infrastructure as Code (CDK Resources)

```mermaid
graph TB
    subgraph "CDK Stack: ImageProcessingStack"
        App[CDK App<br/>bin/app.ts]
        Stack[Stack Definition<br/>lib/image-processing-stack.ts]
        
        App --> Stack
        
        Stack --> S3_1[S3 Bucket: Upload<br/>RemovalPolicy: RETAIN]
        Stack --> S3_2[S3 Bucket: Processed<br/>RemovalPolicy: RETAIN]
        Stack --> DDB_Table[DynamoDB Table<br/>RemovalPolicy: DESTROY]
        Stack --> SQS_Queue[SQS Queue<br/>visibilityTimeout: 300s]
        Stack --> Lambda_1[Lambda: GetUploadUrl<br/>NodejsFunction]
        Stack --> Lambda_2[Lambda: ProcessUpload<br/>NodejsFunction]
        Stack --> Lambda_3[Lambda: ResizeImage<br/>NodejsFunction]
        Stack --> Lambda_4[Lambda: GetStatus<br/>NodejsFunction]
        Stack --> API_GW[API Gateway HTTP API<br/>CORS enabled]
        
        Lambda_1 -.->|grantPut| S3_1
        Lambda_2 -.->|grantRead| S3_1
        Lambda_2 -.->|grantWriteData| DDB_Table
        Lambda_2 -.->|grantSendMessages| SQS_Queue
        Lambda_3 -.->|grantRead| S3_1
        Lambda_3 -.->|grantPut| S3_2
        Lambda_3 -.->|grantReadWriteData| DDB_Table
        Lambda_4 -.->|grantReadData| DDB_Table
        Lambda_4 -.->|grantRead| S3_2
        
        S3_1 -->|S3EventSource| Lambda_2
        SQS_Queue -->|SqsEventSource| Lambda_3
        API_GW -->|POST /upload| Lambda_1
        API_GW -->|GET /status| Lambda_4
    end
    
    style App fill:#ff9800
    style Stack fill:#ff9800
    style S3_1 fill:#4caf50
    style S3_2 fill:#4caf50
    style DDB_Table fill:#e91e63
    style SQS_Queue fill:#9c27b0
    style Lambda_1 fill:#2196f3
    style Lambda_2 fill:#2196f3
    style Lambda_3 fill:#2196f3
    style Lambda_4 fill:#2196f3
    style API_GW fill:#00bcd4
```

## Data Flow Diagram

```mermaid
flowchart TD
    Start([User starts upload]) --> GetURL[POST /upload]
    GetURL --> GenURL[Lambda1: Generate presigned URL]
    GenURL --> ReturnURL[Return: uploadUrl + imageId]
    ReturnURL --> Upload[User uploads image to S3]
    Upload --> S3Event[S3 triggers ObjectCreated event]
    S3Event --> CreateRecord[Lambda2: Create DynamoDB record]
    CreateRecord --> SetPending[Set status: 'pending']
    SetPending --> SendSQS[Send message to SQS]
    SendSQS --> TriggerL3[SQS triggers Lambda3]
    TriggerL3 --> Download[Download from S3 Upload]
    Download --> Resize[Resize to 400x400 with Sharp]
    Resize --> UploadProcessed[Upload to S3 Processed]
    UploadProcessed --> UpdateDB[Update DynamoDB status: 'ok']
    UpdateDB --> Poll{User polls status}
    Poll -->|GET /status| CheckDB[Lambda4: Query DynamoDB]
    CheckDB -->|status: pending| Wait[Wait 2 seconds]
    Wait --> Poll
    CheckDB -->|status: ok| GenDownload[Generate download URL]
    GenDownload --> ReturnDownload[Return downloadUrl]
    ReturnDownload --> DownloadImage[User downloads processed image]
    DownloadImage --> End([Complete])
    
    Resize -->|Error| SetError[Update status: 'error']
    SetError --> CheckDB
    
    style Start fill:#4caf50
    style End fill:#4caf50
    style SetError fill:#f44336
    style Resize fill:#ff9800
    style Poll fill:#2196f3
```

## AWS Services Used

```mermaid
mindmap
  root((Image Processing<br/>Pipeline))
    Compute
      Lambda Functions
        GetUploadUrl
        ProcessUpload
        ResizeImage
        GetStatus
      Runtime: Node.js 20.x
      Language: TypeScript
    Storage
      S3 Buckets
        Upload Bucket
        Processed Bucket
      Encryption: S3-Managed
      Access: Private
    Database
      DynamoDB
        Table: ImageProcessingTable
        Billing: On-Demand
        TTL: Optional
    Queue
      SQS
        Queue: ImageProcessingQueue
        Visibility: 300s
        DLQ: Optional
    API
      API Gateway
        Type: HTTP API
        CORS: Enabled
        Routes
          POST /upload
          GET /status
    Monitoring
      CloudWatch
        Logs
        Metrics
        Alarms
      X-Ray
        Tracing
    Security
      IAM
        Roles
        Policies
      Encryption
        S3: SSE
        DynamoDB: At rest
      Network
        Private buckets
        Presigned URLs
```

---

## How to View These Diagrams

### GitHub
These Mermaid diagrams will render automatically on GitHub when viewing this file.

### VS Code
Install the "Markdown Preview Mermaid Support" extension to view diagrams in preview.

### Online
Copy the Mermaid code and paste it into:
- https://mermaid.live/
- https://mermaid-js.github.io/mermaid-live-editor/

### Export as Image
Use Mermaid CLI to export as PNG/SVG:
```bash
npm install -g @mermaid-js/mermaid-cli
mmdc -i architecture-mermaid.md -o architecture.png
```

---

## Architecture Highlights

### ✅ Serverless Architecture
- No servers to manage
- Auto-scaling
- Pay-per-use pricing

### ✅ Event-Driven Design
- S3 events trigger processing
- SQS decouples components
- Asynchronous processing

### ✅ Secure by Default
- Private S3 buckets
- Presigned URLs with expiration
- IAM least privilege
- Encryption at rest

### ✅ Resilient
- Lambda automatic retries
- SQS message persistence
- DynamoDB high availability
- Error tracking in database

### ✅ Observable
- CloudWatch Logs for all Lambdas
- Metrics for monitoring
- X-Ray tracing (optional)
- Status tracking in DynamoDB

### ✅ Cost-Effective
- Serverless pricing model
- On-demand DynamoDB
- S3 lifecycle policies
- Estimated: <$1 for 1000 images/month
