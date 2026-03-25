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

<img width="1383" height="1232" alt="angelleye-paypal-analytics-2" src="https://github.com/user-attachments/assets/c4ca7065-ecae-4f73-b1d7-ee7b1e56744e" />

## 3. Database Schema

<img width="1502" height="1094" alt="db-schema" src="https://github.com/user-attachments/assets/3b96e265-2874-406f-ace3-ca72a9addb0b" />

## 4. Services

- Lambda (3 instances):
  - Cleanup old DB records/requests logs cron
  - Batch DB Push PPCP (receives batch data from SQS and pushes to RDS)
  - Batch DB Push All Payments (receives batch data from SQS and pushes to RDS)
- Event Bridge Rules (1 instance):
  - Cron for cleanup old DB records (runs once a day)
- SQS (4 instances): (all of them are for batch insert/upsert in the RDS via lambda)
  - For PPCP Batch queue
  - For PPCP Batch queue DLQ
  - For All Payments Batch queue
  - For All Payments Batch queue DLQ
- RDS (PostgreSQL) (1 instance):
  - For analytics purposes to store paypal request logs
- Cloudwatch:
  - Logs (3 lambda)
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

- Generate a new password for postgres / use existing user
- Update the security group to temporarily allow access from your IP only with /32 CIDR block (this is very very critical, as RDS is publically exposed)
- You can also select `My Ip` in the security group inbound rules when added a new rule, which automatically uses /32 CIDR block. Example of /32 CIDR block: `192.168.1.100/32`
- Once migrations are done, delete your ip from the security group inbound

Note: Since our RDS is publically accessible, security groups are the only line of defence, so be very very careful when updating the inbound access rules

```bash

# 1. After making the changes in schema.prisma, generate new types
npm run prisma:generate

# 2. Generate and update .env file with the database url
cp .env.example .env

# 3. Run migrations (skip name for migration, to keep it default with timstamp)
npm run prisma:migrate:dev # for dev
npm run prisma:migrate:deploy # for prod

```

```bash

# Sample Migration run script (dev mode)

npm run prisma:migrate:dev

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