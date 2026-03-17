## 0. Table of Contents

- [0. Table of Contents](#0-table-of-contents)
- [1. Overview](#1-overview)
- [2. System Architecture](#2-system-architecture)
- [3. Database Schema](#3-database-schema)
- [4. Services](#4-services)
- [5. Build \& Deployments](#5-build--deployments)
  - [5.1 Lambda](#51-lambda)
  - [5.2 Database Migrations](#52-database-migrations)


## 1. Overview

Setup analytics in RDS for Paypal Requests as forwarded by PPCP

1. Save in RDS (Batch Processing)
    - Batch Queue accumulates paypal request logs
      - Lambda triggered on: 100 messages OR 1 minute (whichever comes first)
    - Lambda writes logs to RDS (PostgreSQL) in batch
      - ~1 minute latency for analytics data

2. Analytics & Monitoring (Metabase)
   - Metabase connects to RDS (read-only user, SSL encrypted)
   - Provides dashboards for paypal requests analytics
   - Used by business and customer support team
  
Note: 
- RDS is publically accessible with IP restriction at security group level
- Why? 
  - Because Metabase VPS is hosted outside AWS, and cannot directly access RDS
- Alternative:
  - We can have a jumpbox/bastion EC2 in front of RDS and Metabase connects to RDS via the bastion host.
  - But that also introduces another service, and is only in 1 AZ (while RDS being in 2 AZ)
  - Would increase complexity to have it handle with 2 AZ + handling redundency
- Thus, kept it simple, by directly accessing RDS from Metabase VPS while having /32 CIDR IP restriction, allowing only Metabase VPS
- This means, security group for RDS is our only line of defense, and is critical to not modify unless absolutely sure about the changes

## 2. System Architecture

<img width="1317" height="995" alt="angelleye-paypal-analytics" src="https://github.com/user-attachments/assets/ffa7dd54-82a2-4eeb-a72f-b3b064f52d79" />

## 3. Database Schema

<img width="250" alt="Lean Software Dev - 2026-03-11 at 11 08 15@2x" src="https://github.com/user-attachments/assets/13c82d76-b55e-4b36-a75b-d5cc4fa0f501" />

## 4. Services

- Lambda (2 instance):
  - Cleanup old DB records/requests logs cron
  - Batch DB Push cron (receives batch data from SQS and pushes to RDS)
- Event Bridge Rules (1 instance):
  - Cron for cleanup old DB records (runs once a day)
- SQS (1 instance):
  - For Batch queue (this is for batch insert/upsert in the RDS via lambda)
- RDS (PostgreSQL) (1 instance):
  - For read-only analytics purposes to store paypal request logs
- Cloudwatch:
  - Logs (2 lambda)
  - Metrics (basic/default) (for services)

## 5. Build & Deployments

Since these are just deploy and forget (with rare changes), and working independantly, we can do manual deployments (no CI/CD needed)

### 5.1 Lambda

- Enter the corressponding lambda dir `lambda/batch-db-push` / `lambda/cleanup-db-cron`
- Build the .zip file for upload to AWS (2 ways)

1. Script: `npm run build:zip`

2. Manual:
    ```bash
    # 1. Install dependencies
    npm install

    # 2. Build
    npx tsc

    # 3. Remove devDependencies
    npm prune --production

    # 3. Copy additional files in /dist
    cp rds-us-east-2-bundle.pem dist/rds-us-east-2-bundle.pem
    cp -r node_modules dist/node_modules

    # 4. Zip file
    cd dist
    zip -r ../function.zip . && cd ..
    ```


### 5.2 Database Migrations

```bash

# 1. After making the changes in schema.prisma, generate new types
npm run prisma:generate

# 2. Update .env file with the database url

# 3. Run migrations (skip name for migration, to keep it default with timstamp)
npm run prisma:migrate

```

```bash

# Sample Migration run script

npm run prisma:migrate

> analytics@1.0.0 prisma:migrate
> prisma migrate dev

Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "db-name", schema "public" at "db-url:5432"

✔ Enter a name for the new migration: … 
Applying migration `20260317162930`

The following migration(s) have been created and applied from new schema changes:

prisma/migrations/
  └─ 20260317162930/
    └─ migration.sql

Your database is now in sync with your schema.

✔ Generated Kysely types (2.3.0) to ./prisma/generated/types in 11ms

```