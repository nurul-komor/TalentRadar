# Local Setup

## Prerequisites
- Node.js 22+
- Docker (for local MongoDB)

## Install

    npm install

## Local MongoDB

    docker compose up -d mongo

## API

    cp api/.env.example api/.env
    # edit api/.env: set JWT_SECRET to any random string;
    # MONGODB_URI can stay as mongodb://localhost:27017 for local dev
    npm run dev --workspace=api

API runs at http://localhost:8787.

## Dashboard

    npm run dev --workspace=dashboard

Dashboard runs at http://localhost:5173 and talks to the API at
http://localhost:8787 by default (override with VITE_API_BASE_URL).

## Tests

    npm test
