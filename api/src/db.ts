import { MongoClient, type Db } from 'mongodb'

export interface MongoConnection {
  client: MongoClient
  db: Db
}

export async function connectMongo(uri: string, dbName: string): Promise<MongoConnection> {
  const client = new MongoClient(uri)
  await client.connect()
  return { client, db: client.db(dbName) }
}
